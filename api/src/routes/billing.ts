import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { stripe } from "../lib/stripe.js";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { verifySession } from "./auth.js";
import { reqId } from "../utils/credits.js";
import { sendPurchaseConfirmation, sendAdminAlert } from "../services/email.js";
import { fireWebhookEvent } from "../services/webhooks.js";
import { safeErr } from "../utils/credits.js";

const router = Router();

/**
 * Auth that accepts EITHER an API key (Authorization/x-api-key, via requireAuth)
 * OR a logged-in browser session (arch_session cookie). Lets the pricing page
 * buy buttons work for users who signed in with email/password and never
 * pasted their API key into localStorage.
 */
async function requireAuthOrSession(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  const hasApiKeyAuth = Boolean(req.headers.authorization?.startsWith("Bearer ") || req.headers["x-api-key"]);
  if (hasApiKeyAuth || (req as unknown as { x402Paid?: boolean }).x402Paid) {
    requireAuth(req, res, next);
    return;
  }
  const token = (req as unknown as { cookies?: Record<string, string> }).cookies?.["arch_session"];
  const payload = token ? verifySession(token) : null;
  if (!payload) {
    res.status(401).json({ ok: false, error: "unauthorized", message: "Sign in or provide an API key (Authorization: Bearer <key>)", request_id: reqId() });
    return;
  }
  const agent = await prisma.agent.findUnique({ where: { id: payload.sub } }).catch(() => null);
  if (!agent) {
    res.status(401).json({ ok: false, error: "unauthorized", message: "Session invalid. Sign in again at /login", request_id: reqId() });
    return;
  }
  // Plaintext keys are no longer stored — session-authenticated requests carry no API key.
  req.agent = { id: agent.id, apiKey: "", email: agent.email ?? "", credits: agent.credits, tier: agent.tier, totalCalls: agent.totalCalls };
  next();
}

// ─── One-time credit packs ──────────────────────────────────────────────────
const CREDIT_PACKS = [
  { id: "starter",  credits: 3000,   amount: 900,   label: "Starter Pack",   priceId: process.env.STRIPE_PRICE_STARTER   ?? "" },
  { id: "pro",      credits: 25000,  amount: 4900,  label: "Medium Pack",    priceId: process.env.STRIPE_PRICE_PRO       ?? "" },
  { id: "business", credits: 125000, amount: 19900, label: "Large Pack",     priceId: process.env.STRIPE_PRICE_BUSINESS  ?? "" },
];

// ─── Monthly subscription plans ────────────────────────────────────────────
const SUBSCRIPTION_PLANS = [
  {
    id: "starter-monthly",
    label: "Starter",
    billing: "monthly",
    credits_per_month: 10000,
    amount: 1900,    // $19/mo
    // Security: price IDs must be set via environment variables — no hardcoded fallbacks.
    // V2 price ($19) created 2026-06-10; old $9 price archived after cutover.
    priceId: process.env.STRIPE_PRICE_SUB_STARTER_MONTHLY_V2 ?? process.env.STRIPE_PRICE_SUB_STARTER_MONTHLY ?? "",
  },
  {
    id: "pro-monthly",
    label: "Pro",
    billing: "monthly",
    credits_per_month: 30000,
    amount: 4900,    // $49/mo
    priceId: process.env.STRIPE_PRICE_SUB_PRO_MONTHLY ?? "",
  },
  {
    id: "growth-monthly",
    label: "Growth",
    billing: "monthly",
    credits_per_month: 75000,
    amount: 9900,    // $99/mo
    priceId: process.env.STRIPE_PRICE_SUB_GROWTH_MONTHLY ?? "",
  },
  {
    id: "business-monthly",
    label: "Business",
    billing: "monthly",
    credits_per_month: 175000,
    amount: 19900,   // $199/mo
    priceId: process.env.STRIPE_PRICE_SUB_BUSINESS_MONTHLY_V2 ?? process.env.STRIPE_PRICE_SUB_BUSINESS_MONTHLY ?? "",
  },
];

// GET /v1/billing/plans — returns all plans (one-time + subscription)
router.get("/plans", (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    one_time_packs: CREDIT_PACKS.map(p => ({
      label: p.label,
      credits: p.credits,
      price_usd: p.amount / 100,
      price_per_credit: (p.amount / p.credits / 100).toFixed(4),
      expires: false,
      auto_renew: false,
    })),
    subscriptions: SUBSCRIPTION_PLANS.map(p => ({
      id: p.id,
      label: p.label,
      billing: p.billing,
      credits_per_month: p.credits_per_month,
      price_usd: p.amount / 100,
      price_monthly_equiv: p.billing === "annual" ? ((p as { amount_monthly_equiv?: number }).amount_monthly_equiv ?? p.amount) / 100 : p.amount / 100,
      savings_vs_monthly: p.billing === "annual" ? "17%" : null,
      auto_renew: true,
      credits_refresh: "monthly",
    })),
    request_id: reqId(),
  });
});

// POST /v1/billing/checkout — one-time pack checkout
router.post("/checkout", requireAuthOrSession, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }
  if (!stripe) { res.status(503).json({ ok: false, error: "not_configured", message: "Stripe not configured", request_id: reqId() }); return; }

  const { pack } = req.body as { pack?: string };
  const packKey = (pack ?? "").toLowerCase().trim();
  const packConfig = packKey
    ? CREDIT_PACKS.find(p => p.id === packKey || p.label.toLowerCase().startsWith(packKey))
    : undefined;
  if (!packConfig) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "pack must be one of: starter, pro, business", request_id: reqId() });
    return;
  }
  if (!packConfig.priceId) {
    res.status(503).json({ ok: false, error: "not_configured", message: "Stripe price not configured", request_id: reqId() });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: packConfig.priceId, quantity: 1 }],
      success_url: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/pricing`,
      metadata: { agent_id: agent.id, credits: String(packConfig.credits) },
      customer_email: agent.email,
    });
    res.json({ ok: true, url: session.url, session_id: session.id, request_id: reqId() });
  } catch (e) {
    console.error("Stripe checkout error:", e);
    res.status(500).json({
      ok: false,
      error: "stripe_error",
      message: "Unable to create checkout session.",
      request_id: reqId(),
    });
  }
});

// POST /v1/billing/subscribe — subscription checkout
router.post("/subscribe", requireAuthOrSession, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }
  if (!stripe) { res.status(503).json({ ok: false, error: "not_configured", message: "Stripe not configured", request_id: reqId() }); return; }

  const { plan } = req.body as { plan?: string };
  const planConfig = SUBSCRIPTION_PLANS.find(p => p.id === plan);
  if (!planConfig) {
    const ids = SUBSCRIPTION_PLANS.map(p => p.id).join(", ");
    res.status(400).json({ ok: false, error: "invalid_request", message: `plan must be one of: ${ids}`, request_id: reqId() });
    return;
  }

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: planConfig.priceId, quantity: 1 }],
      success_url: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/pricing`,
      metadata: {
        agent_id: agent.id,
        credits_per_month: String(planConfig.credits_per_month),
        plan_id: planConfig.id,
        plan_label: planConfig.label,
        billing: planConfig.billing,
      },
      subscription_data: {
        metadata: {
          agent_id: agent.id,
          credits_per_month: String(planConfig.credits_per_month),
          plan_id: planConfig.id,
        },
      },
      customer_email: agent.email,
    });
    res.json({ ok: true, url: session.url, session_id: session.id, plan: planConfig.id, request_id: reqId() });
  } catch (e) {
    console.error("Stripe subscription error:", e);
    res.status(500).json({
      ok: false,
      error: "stripe_error",
      message: "Unable to create subscription session.",
      request_id: reqId(),
    });
  }
});

// POST /webhooks/stripe — Stripe webhook handler
router.post("/stripe", async (req: Request, res: Response): Promise<void> => {
  if (!stripe) { res.status(503).json({ error: "Stripe not configured" }); return; }

  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
  } catch (e) {
    console.error("Webhook signature error:", e);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  // ─── One-time purchase ───────────────────────────────────────────────────
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const agentId = session.metadata?.agent_id;
    const stripeId = session.id;

    if (!agentId) { res.json({ received: true }); return; }

    try {
      const existing = await prisma.purchase.findUnique({ where: { stripeId } });
      if (existing) { res.json({ received: true }); return; }

      // One-time payment
      if (session.mode === "payment") {
        const credits = parseInt(session.metadata?.credits ?? "0", 10);
        if (!credits) { res.json({ received: true }); return; }
        await prisma.$transaction([
          prisma.purchase.create({ data: { agentId, stripeId, credits, amountCents: session.amount_total ?? 0, status: "completed" } }),
          prisma.agent.update({ where: { id: agentId }, data: { credits: { increment: credits } } }),
        ]);
        console.log(`[billing] One-time: +${credits} credits to agent ${agentId}`);
        // Fire webhook event (non-blocking)
        fireWebhookEvent("payment.received", agentId, {
          type: "one_time",
          credits_added: credits,
          amount_usd: ((session.amount_total ?? 0) / 100).toFixed(2),
          stripe_session_id: stripeId,
        }).catch(() => {});
        try {
          const agentRecord = await prisma.agent.findUnique({ where: { id: agentId }, select: { email: true, credits: true } });
          if (agentRecord?.email) {
            const pack = CREDIT_PACKS.find(p => p.credits === credits);
            const amountUsd = ((session.amount_total ?? 0) / 100).toFixed(2);
            sendPurchaseConfirmation(agentRecord.email, credits, pack?.label ?? "Credit Pack", agentRecord.credits).catch(() => {});
            // Admin notification
            sendAdminAlert(
              `💰 New Arch Tools sale — $${amountUsd}`,
              `New one-time purchase!\n\nCustomer: ${agentRecord.email}\nPack: ${pack?.label ?? "Credit Pack"}\nCredits: ${credits.toLocaleString()}\nAmount: $${amountUsd}\nStripe session: ${stripeId}`
            ).catch(() => {});
          }
        } catch { /* non-fatal */ }

      // Subscription — first payment
      } else if (session.mode === "subscription") {
        const creditsPerMonth = parseInt(session.metadata?.credits_per_month ?? "0", 10);
        const planId = session.metadata?.plan_id ?? "";
        const planLabel = session.metadata?.plan_label ?? "Subscription";
        if (!creditsPerMonth) { res.json({ received: true }); return; }
        await prisma.$transaction([
          prisma.purchase.create({ data: { agentId, stripeId, credits: creditsPerMonth, amountCents: session.amount_total ?? 0, status: "completed" } }),
          prisma.agent.update({ where: { id: agentId }, data: { credits: { increment: creditsPerMonth }, tier: planId.replace(/-(monthly|annual)$/, '') } }),
        ]);
        console.log(`[billing] Subscription start: +${creditsPerMonth} credits/month (${planLabel}) to agent ${agentId}`);
        // Fire webhook event (non-blocking)
        fireWebhookEvent("payment.received", agentId, {
          type: "subscription",
          plan: planId,
          credits_added: creditsPerMonth,
          amount_usd: ((session.amount_total ?? 0) / 100).toFixed(2),
          stripe_session_id: stripeId,
        }).catch(() => {});
        try {
          const agentRecord2 = await prisma.agent.findUnique({ where: { id: agentId }, select: { email: true } });
          const amountUsd2 = ((session.amount_total ?? 0) / 100).toFixed(2);
          sendAdminAlert(
            `🔁 New Arch Tools subscription — $${amountUsd2}/mo`,
            `New subscription started!\n\nCustomer: ${agentRecord2?.email ?? "unknown"}\nPlan: ${planLabel}\nCredits/month: ${creditsPerMonth.toLocaleString()}\nAmount: $${amountUsd2}\nStripe session: ${stripeId}`
          ).catch(() => {});
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      console.error("Webhook processing error:", e);
    }
  }

  // ─── Subscription renewal (monthly/annual invoice paid) ──────────────────
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as { subscription?: string; customer?: string; billing_reason?: string; amount_paid?: number; id?: string };
    // Skip the very first invoice (handled by checkout.session.completed above)
    if (invoice.billing_reason === "subscription_create") { res.json({ received: true }); return; }

    const subscriptionId = invoice.subscription as string;
    if (!subscriptionId || !stripe) { res.json({ received: true }); return; }

    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const agentId = subscription.metadata?.agent_id;
      const creditsPerMonth = parseInt(subscription.metadata?.credits_per_month ?? "0", 10);
      if (!agentId || !creditsPerMonth) { res.json({ received: true }); return; }

      // Idempotency: use invoice ID
      const invoiceId = invoice.id ?? subscriptionId;
      const existing = await prisma.purchase.findUnique({ where: { stripeId: invoiceId } });
      if (existing) { res.json({ received: true }); return; }

      await prisma.$transaction([
        prisma.purchase.create({ data: { agentId, stripeId: invoiceId, credits: creditsPerMonth, amountCents: invoice.amount_paid ?? 0, status: "completed" } }),
        prisma.agent.update({ where: { id: agentId }, data: { credits: { increment: creditsPerMonth } } }),
      ]);
      console.log(`[billing] Renewal: +${creditsPerMonth} credits to agent ${agentId}`);
      // Fire webhook event (non-blocking)
      fireWebhookEvent("payment.received", agentId, {
        type: "renewal",
        credits_added: creditsPerMonth,
        amount_usd: ((invoice.amount_paid ?? 0) / 100).toFixed(2),
        subscription_id: subscriptionId,
      }).catch(() => {});
      const agentRenewal = await prisma.agent.findUnique({ where: { id: agentId }, select: { email: true } }).catch(() => null);
      const renewalAmount = ((invoice.amount_paid ?? 0) / 100).toFixed(2);
      sendAdminAlert(
        `🔄 Arch Tools subscription renewal — $${renewalAmount}`,
        `Subscription renewed!\n\nCustomer: ${agentRenewal?.email ?? "unknown"}\nCredits added: ${creditsPerMonth.toLocaleString()}\nAmount: $${renewalAmount}\nSubscription: ${subscriptionId}`
      ).catch(() => {});
    } catch (e) {
      console.error("Subscription renewal error:", e);
    }
  }

  // ─── Subscription cancelled ──────────────────────────────────────────────
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as { metadata?: { agent_id?: string }; id?: string };
    const agentId = subscription.metadata?.agent_id;
    if (agentId) {
      await prisma.agent.update({ where: { id: agentId }, data: { tier: "free" } }).catch(() => {});
      console.log(`[billing] Subscription cancelled for agent ${agentId}`);
    }
  }

  res.json({ received: true });
});

export default router;
