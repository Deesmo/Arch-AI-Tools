import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma.js";
import { stripe } from "../lib/stripe.js";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { verifySession } from "./auth.js";
import { reqId } from "../utils/credits.js";
import { sendPurchaseConfirmation, sendAdminAlert } from "../services/email.js";
import { fireWebhookEvent } from "../services/webhooks.js";
import { safeErr } from "../utils/credits.js";
import { tierFromSubscriptionPlanId } from "../lib/tiers.js";
import { clawbackDelta, proratedClawbackTarget } from "../lib/clawback.js";

const router = Router();

/**
 * Auth that accepts EITHER an API key (Authorization/x-api-key, via requireAuth)
 * OR a logged-in browser session (arch_session cookie). Lets the pricing page
 * buy buttons work for users who signed in with email/password and never
 * pasted their API key into localStorage.
 */
async function requireAuthOrSession(req: AuthedRequest, res: Response, next: NextFunction): Promise<void> {
  // Billing must establish a real account identity (API key or session). An
  // x402 payment proves a payment was made, NOT who the caller is, so it is
  // intentionally NOT accepted as authentication here.
  const hasApiKeyAuth = Boolean(req.headers.authorization?.startsWith("Bearer ") || req.headers["x-api-key"]);
  if (hasApiKeyAuth) {
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
  { id: "pro",      credits: 25000,  amount: 4900,  label: "Pro Pack",       priceId: process.env.STRIPE_PRICE_PRO       ?? "" },
  { id: "business", credits: 125000, amount: 19900, label: "Business Pack",  priceId: process.env.STRIPE_PRICE_BUSINESS  ?? "" },
];

// Legacy pack aliases — the packs were once marketed as Small/Medium/Large.
// Old integrations may still send those names (or the full labels that
// GET /v1/billing/plans used to return); map them to the canonical ids
// so their checkouts keep working.
const LEGACY_PACK_ALIASES = new Map<string, string>([
  ["small", "starter"],
  ["small pack", "starter"],
  ["medium", "pro"],
  ["medium pack", "pro"],
  ["large", "business"],
  ["large pack", "business"],
]);

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

// Server-side allow-lists: a webhook may only ever grant a credit amount that
// matches one of our configured packs/plans. This bounds the blast radius if
// session/subscription metadata is ever tampered with (e.g. compromised Stripe
// key) — an attacker cannot inject an arbitrary credit number.
const ALLOWED_ONETIME_CREDITS = new Set(CREDIT_PACKS.map((p) => p.credits));
const ALLOWED_SUB_CREDITS = new Set(SUBSCRIPTION_PLANS.map((p) => p.credits_per_month));

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export async function paymentIntentIdFromCheckoutSession(session: {
  payment_intent?: unknown;
  invoice?: unknown;
}, retrieveInvoice: (invoiceId: string) => Promise<{ payment_intent?: unknown }> = async (invoiceId) => {
  if (!stripe) return {};
  return stripe.invoices.retrieve(invoiceId);
}): Promise<string | null> {
  const directPaymentIntentId = stripeObjectId(session.payment_intent);
  if (directPaymentIntentId) return directPaymentIntentId;
  const invoiceId = stripeObjectId(session.invoice);
  if (!invoiceId) return null;
  const invoice = await retrieveInvoice(invoiceId);
  return stripeObjectId(invoice.payment_intent);
}

export function agentUpdateForPaidSubscriptionInvoice(
  creditsPerMonth: number,
  planId: string | undefined
): { credits: { increment: number }; tier?: string } {
  const tier = tierFromSubscriptionPlanId(planId ?? "");
  return tier === "free"
    ? { credits: { increment: creditsPerMonth } }
    : { credits: { increment: creditsPerMonth }, tier };
}

// GET /v1/billing/plans — returns all plans (one-time + subscription)
router.get("/plans", (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    one_time_packs: CREDIT_PACKS.map(p => ({
      // id = the exact value POST /v1/billing/checkout accepts as `pack` —
      // without it agents can't map labels to the checkout parameter.
      id: p.id,
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

  // Accept both `pack` and `plan` — agents mix the two up, and a failed
  // checkout is a lost sale. If the value names a subscription instead,
  // answer with the exact corrective call.
  const { pack, plan } = req.body as { pack?: string; plan?: string };
  const rawKey = (pack ?? plan ?? "").toLowerCase().trim();
  const packKey = LEGACY_PACK_ALIASES.get(rawKey) ?? rawKey;
  const packConfig = packKey
    ? CREDIT_PACKS.find(p => p.id === packKey || p.label.toLowerCase().startsWith(packKey))
    : undefined;
  if (!packConfig) {
    const subMatch = SUBSCRIPTION_PLANS.find(p => p.id === packKey || p.id === `${packKey}-monthly`);
    if (subMatch) {
      res.status(400).json({ ok: false, error: "invalid_request", message: `"${packKey}" is a subscription, not a one-time pack. POST /v1/billing/subscribe with {"plan":"${subMatch.id}"}.`, request_id: reqId() });
      return;
    }
    res.status(400).json({ ok: false, error: "invalid_request", message: "pack must be one of: starter, pro, business (legacy aliases small, medium, large are also accepted)", request_id: reqId() });
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

  // Accept both `plan` and `pack`, plus bare tier names ("pro" → "pro-monthly")
  // — but a bare PACK id arriving via the `pack` key must NEVER silently become
  // a recurring charge: {"pack":"business"} means the $199 one-time pack, and
  // expanding it to business-monthly would put the buyer on an unintended
  // subscription (all three pack ids collide with -monthly plan tiers). Exact
  // plan ids always win regardless of key; bare-name expansion is a
  // subscription-intent convenience reserved for the `plan` key.
  const { plan, pack } = req.body as { plan?: string; pack?: string };
  const planKey = (plan ?? pack ?? "").toLowerCase().trim();
  let planConfig = SUBSCRIPTION_PLANS.find(p => p.id === planKey);
  if (!planConfig) {
    const packMatch = CREDIT_PACKS.find(p => p.id === planKey);
    const sentAsPack = plan == null && pack != null;
    const ids = SUBSCRIPTION_PLANS.map(p => p.id).join(", ");
    if (packMatch && sentAsPack) {
      res.status(400).json({ ok: false, error: "invalid_request", message: `"${planKey}" is a one-time credit pack, not a subscription. POST /v1/billing/checkout with {"pack":"${packMatch.id}"} — or pick a plan: ${ids}.`, request_id: reqId() });
      return;
    }
    planConfig = SUBSCRIPTION_PLANS.find(p => p.id === `${planKey}-monthly`);
    if (!planConfig) {
      if (packMatch) {
        res.status(400).json({ ok: false, error: "invalid_request", message: `"${planKey}" is a one-time credit pack, not a subscription. POST /v1/billing/checkout with {"pack":"${packMatch.id}"} — or pick a plan: ${ids}.`, request_id: reqId() });
        return;
      }
      res.status(400).json({ ok: false, error: "invalid_request", message: `plan must be one of: ${ids}`, request_id: reqId() });
      return;
    }
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

  if (!webhookSecret) {
    // Without the signing secret we cannot verify authenticity. Refuse rather
    // than process unverified events. (In production this should never happen.)
    console.error("[billing] STRIPE_WEBHOOK_SECRET is not set — refusing to process webhook.");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

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
      // Store the PaymentIntent id so a later refund/dispute (which references
      // the charge's payment_intent, not this session id) can find this purchase.
      // Subscription Checkout sessions carry it on the first invoice, not on the
      // session itself.
      const paymentIntentId = await paymentIntentIdFromCheckoutSession(session);
      const existing = await prisma.purchase.findUnique({ where: { stripeId } });
      if (existing) { res.json({ received: true }); return; }

      // One-time payment
      if (session.mode === "payment") {
        const credits = parseInt(session.metadata?.credits ?? "0", 10);
        if (!credits) { res.json({ received: true }); return; }
        if (!ALLOWED_ONETIME_CREDITS.has(credits)) {
          console.error(`[billing] REJECTED one-time credit grant: credits=${credits} not in allowed set (agent ${agentId}, session ${stripeId})`);
          sendAdminAlert("⚠️ Stripe webhook credit mismatch", `One-time purchase requested an out-of-range credit amount and was NOT credited.\nagent=${agentId} credits=${credits} amount=${session.amount_total ?? 0} session=${stripeId}`).catch(() => {});
          res.json({ received: true }); return;
        }
        await prisma.$transaction([
          prisma.purchase.create({ data: { agentId, stripeId, paymentIntentId, credits, amountCents: session.amount_total ?? 0, status: "completed" } }),
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
        if (!ALLOWED_SUB_CREDITS.has(creditsPerMonth)) {
          console.error(`[billing] REJECTED subscription credit grant: creditsPerMonth=${creditsPerMonth} not in allowed set (agent ${agentId}, session ${stripeId})`);
          sendAdminAlert("⚠️ Stripe webhook credit mismatch", `Subscription start requested an out-of-range credit amount and was NOT credited.\nagent=${agentId} credits_per_month=${creditsPerMonth} session=${stripeId}`).catch(() => {});
          res.json({ received: true }); return;
        }
        await prisma.$transaction([
          prisma.purchase.create({ data: { agentId, stripeId, paymentIntentId, credits: creditsPerMonth, amountCents: session.amount_total ?? 0, status: "completed" } }),
          prisma.agent.update({ where: { id: agentId }, data: { credits: { increment: creditsPerMonth }, tier: tierFromSubscriptionPlanId(planId) } }),
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
      // Return 5xx so Stripe retries delivery — otherwise a transient DB failure
      // silently drops a paid customer's credits. Crediting is idempotent on
      // stripeId, so a retry cannot double-credit.
      console.error("Webhook processing error:", e);
      res.status(500).json({ error: "processing_failed", message: safeErr(e) });
      return;
    }
  }

  // ─── Subscription renewal (monthly/annual invoice paid) ──────────────────
  if (event.type === "invoice.paid") {
    const invoice = event.data.object as { subscription?: string; customer?: string; billing_reason?: string; amount_paid?: number; id?: string; payment_intent?: string | { id?: string } | null };
    // Skip the very first invoice (handled by checkout.session.completed above)
    if (invoice.billing_reason === "subscription_create") { res.json({ received: true }); return; }

    const subscriptionId = invoice.subscription as string;
    if (!subscriptionId || !stripe) { res.json({ received: true }); return; }

    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const agentId = subscription.metadata?.agent_id;
      const creditsPerMonth = parseInt(subscription.metadata?.credits_per_month ?? "0", 10);
      if (!agentId || !creditsPerMonth) { res.json({ received: true }); return; }
      if (!ALLOWED_SUB_CREDITS.has(creditsPerMonth)) {
        console.error(`[billing] REJECTED renewal credit grant: creditsPerMonth=${creditsPerMonth} not in allowed set (agent ${agentId}, sub ${subscriptionId})`);
        sendAdminAlert("⚠️ Stripe webhook credit mismatch", `Renewal requested an out-of-range credit amount and was NOT credited.\nagent=${agentId} credits_per_month=${creditsPerMonth} sub=${subscriptionId}`).catch(() => {});
        res.json({ received: true }); return;
      }

      // Idempotency: use invoice ID
      const invoiceId = invoice.id ?? subscriptionId;
      const existing = await prisma.purchase.findUnique({ where: { stripeId: invoiceId } });
      if (existing) { res.json({ received: true }); return; }

      // Link the renewal charge so a later refund/dispute can claw it back.
      const renewalPaymentIntentId = typeof invoice.payment_intent === "string"
        ? invoice.payment_intent
        : invoice.payment_intent?.id ?? null;

      const agentUpdate = agentUpdateForPaidSubscriptionInvoice(creditsPerMonth, subscription.metadata?.plan_id);
      await prisma.$transaction([
        prisma.purchase.create({ data: { agentId, stripeId: invoiceId, paymentIntentId: renewalPaymentIntentId, credits: creditsPerMonth, amountCents: invoice.amount_paid ?? 0, status: "completed" } }),
        prisma.agent.update({ where: { id: agentId }, data: agentUpdate }),
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
      // 5xx → Stripe retries; idempotent on invoice id so no double-credit.
      console.error("Subscription renewal error:", e);
      res.status(500).json({ error: "processing_failed", message: safeErr(e) });
      return;
    }
  }

  // ─── Subscription cancelled ──────────────────────────────────────────────
  if (event.type === "customer.subscription.deleted") {
    const subscription = event.data.object as { metadata?: { agent_id?: string }; id?: string };
    const agentId = subscription.metadata?.agent_id;
    if (agentId) {
      try {
        await prisma.agent.update({ where: { id: agentId }, data: { tier: "free" } });
      } catch (e) {
        // 5xx tells Stripe to retry; acknowledging here would leave a cancelled
        // subscription with paid-tier access after a transient DB failure.
        console.error("Subscription cancellation error:", e);
        res.status(500).json({ error: "subscription_cancellation_failed", message: safeErr(e) });
        return;
      }
      console.log(`[billing] Subscription cancelled for agent ${agentId}`);
    }
  }

  // ─── Refund / chargeback — claw back the granted credits ─────────────────
  // A customer must not be able to buy a pack, spend the credits, then refund or
  // charge back and keep the value. Both events carry a Charge whose
  // payment_intent links to the Purchase we stored at grant time. Amounts are
  // server-derived from that Purchase and Stripe-signed refund totals, floored
  // at 0, and idempotent on the reversal event id via the Clawback guard table
  // so a redelivered event cannot double-decrement.
  if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
    const isDispute = event.type === "charge.dispute.created";
    // charge.refunded → object is a Charge (payment_intent on it directly).
    // charge.dispute.created → object is a Dispute (charge + payment_intent).
    const obj = event.data.object as {
      id?: string;
      payment_intent?: string | { id?: string } | null;
      charge?: string | { id?: string; payment_intent?: string | { id?: string } | null } | null;
      amount_refunded?: number;
    };
    // `charge.refunded` carries the same Charge id for each partial refund, so
    // key refund idempotency on Stripe's Event id. Disputes carry a unique
    // dispute object id, but event.id is still a safe fallback.
    const eventObjectId = isDispute ? (obj.id ?? event.id) : event.id;
    // Resolve the payment_intent for either shape.
    let paymentIntentId: string | null = null;
    if (typeof obj.payment_intent === "string") paymentIntentId = obj.payment_intent;
    else if (obj.payment_intent?.id) paymentIntentId = obj.payment_intent.id;
    if (!paymentIntentId && obj.charge && typeof obj.charge === "object") {
      const c = obj.charge;
      if (typeof c.payment_intent === "string") paymentIntentId = c.payment_intent;
      else if (c.payment_intent?.id) paymentIntentId = c.payment_intent.id;
    }
    const kind = isDispute ? "dispute" : "refund";

    if (!paymentIntentId) {
      // Nothing to link to — record nothing, ack so Stripe stops retrying.
      console.warn(`[billing] ${kind} ${eventObjectId} had no payment_intent — cannot link to a purchase.`);
      sendAdminAlert(`⚠️ Stripe ${kind} unlinked`, `A ${kind} (${eventObjectId}) arrived with no payment_intent — no credits were clawed back. Investigate manually.`).catch(() => {});
      res.json({ received: true }); return;
    }

    try {
      const purchase = await prisma.purchase.findFirst({ where: { paymentIntentId } });
      if (!purchase) {
        // No matching purchase (e.g. pre-migration legacy charge). Ack and alert.
        console.warn(`[billing] ${kind} ${eventObjectId}: no purchase for payment_intent ${paymentIntentId}.`);
        sendAdminAlert(`⚠️ Stripe ${kind} — no matching purchase`, `A ${kind} (${eventObjectId}) referenced payment_intent ${paymentIntentId} but no Purchase was found — credits could NOT be clawed back automatically. Review manually.`).catch(() => {});
        res.json({ received: true }); return;
      }

      const { clawed, already } = await prisma.$transaction(async (tx) => {
        // Idempotency guard: the DB decides whether we've processed this reversal.
        // A redelivered event loses this INSERT (0 rows) → we skip the decrement.
        const inserted = await tx.$executeRaw`
          INSERT INTO "Clawback" ("id", "event_id", "kind", "agent_id", "purchase_stripe_id", "credits")
          VALUES (${crypto.randomUUID()}, ${eventObjectId}, ${kind}, ${purchase.agentId}, ${purchase.stripeId}, ${0})
          ON CONFLICT ("event_id") DO NOTHING`;
        if (inserted === 0) return { clawed: 0, already: true };

        // Server-derived amount: disputes target the whole purchase. Refunds
        // use Stripe's cumulative amount_refunded, then subtract prior credits
        // already clawed for this purchase so partial refunds only remove the
        // new delta.
        const agentRow = await tx.agent.findUnique({ where: { id: purchase.agentId }, select: { credits: true } });
        const currentBalance = agentRow?.credits ?? 0;
        const priorClawbacks = await tx.clawback.aggregate({
          where: {
            purchaseStripeId: purchase.stripeId,
            kind: { in: ["refund", "dispute"] },
          },
          _sum: { credits: true },
        });
        const alreadyClawed = priorClawbacks._sum.credits ?? 0;
        const targetCredits = isDispute
          ? purchase.credits
          : proratedClawbackTarget(purchase.credits, purchase.amountCents, obj.amount_refunded ?? purchase.amountCents);
        const toClaw = clawbackDelta(targetCredits, alreadyClawed, currentBalance);

        if (toClaw > 0) {
          await tx.agent.update({ where: { id: purchase.agentId }, data: { credits: { decrement: toClaw } } });
        }
        await tx.purchase.update({
          where: { id: purchase.id },
          data: { status: isDispute ? "disputed" : "refunded", clawedBackAt: new Date() },
        });
        await tx.clawback.update({ where: { eventId: eventObjectId }, data: { credits: toClaw } });
        return { clawed: toClaw, already: false };
      });

      if (already) {
        console.log(`[billing] ${kind} ${eventObjectId} already processed — no double-decrement.`);
        res.json({ received: true }); return;
      }

      console.log(`[billing] ${kind}: -${clawed} credits from agent ${purchase.agentId} (purchase ${purchase.stripeId})`);
      const agentInfo = await prisma.agent.findUnique({ where: { id: purchase.agentId }, select: { email: true, credits: true } }).catch(() => null);
      // A dispute is a fraud signal — always alert; a plain refund alerts too so
      // ops can watch for abuse patterns.
      sendAdminAlert(
        isDispute ? `🚨 Stripe DISPUTE — credits clawed back` : `↩️ Stripe refund — credits clawed back`,
        `${isDispute ? "Chargeback/dispute" : "Refund"} processed.\n\nAgent: ${purchase.agentId} (${agentInfo?.email ?? "unknown"})\nPurchase: ${purchase.stripeId}\nGranted: ${purchase.credits.toLocaleString()}\nClawed back: ${clawed.toLocaleString()}\nRemaining balance: ${(agentInfo?.credits ?? 0).toLocaleString()}\n${kind} id: ${eventObjectId}${isDispute ? "\n\n⚠️ Dispute is a fraud signal — review this account." : ""}`
      ).catch(() => {});
      res.json({ received: true }); return;
    } catch (e) {
      // 5xx → Stripe retries; the Clawback guard makes the retry idempotent so
      // no double-decrement, but a transient failure won't silently keep the
      // customer's clawed-back credits.
      console.error(`[billing] ${kind} clawback error:`, e);
      res.status(500).json({ error: "clawback_failed", message: safeErr(e) });
      return;
    }
  }

  // ─── Failed subscription payment — stop paid-tier access ─────────────────
  // A lapsed subscriber (card declined, etc.) must not keep paid-tier limits.
  // Downgrade the agent to the free tier. Idempotent on the invoice id via the
  // Clawback guard; 5xx-on-failure so Stripe retries (mirrors the
  // customer.subscription.deleted handler).
  if (event.type === "invoice.payment_failed") {
    const invoice = event.data.object as { id?: string; subscription?: string | { id?: string } | null };
    const eventObjectId = invoice.id ?? event.id; // invoice id — idempotency key
    const subscriptionId = typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id ?? null;
    if (!subscriptionId || !stripe) { res.json({ received: true }); return; }

    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const agentId = subscription.metadata?.agent_id;
      if (!agentId) { res.json({ received: true }); return; }

      const downgraded = await prisma.$transaction(async (tx) => {
        // Idempotency: a redelivered failed-invoice event loses this INSERT.
        const inserted = await tx.$executeRaw`
          INSERT INTO "Clawback" ("id", "event_id", "kind", "agent_id", "purchase_stripe_id", "credits")
          VALUES (${crypto.randomUUID()}, ${eventObjectId}, ${"payment_failed"}, ${agentId}, ${null}, ${0})
          ON CONFLICT ("event_id") DO NOTHING`;
        if (inserted === 0) return false;
        await tx.agent.update({ where: { id: agentId }, data: { tier: "free" } });
        return true;
      });

      if (downgraded) {
        console.log(`[billing] Payment failed — agent ${agentId} downgraded to free (invoice ${eventObjectId}).`);
        const agentInfo = await prisma.agent.findUnique({ where: { id: agentId }, select: { email: true } }).catch(() => null);
        sendAdminAlert(
          `⚠️ Arch Tools subscription payment failed`,
          `A subscription payment failed — agent downgraded to free tier.\n\nAgent: ${agentId} (${agentInfo?.email ?? "unknown"})\nSubscription: ${subscriptionId}\nInvoice: ${eventObjectId}`
        ).catch(() => {});
      } else {
        console.log(`[billing] payment_failed ${eventObjectId} already processed — no-op.`);
      }
    } catch (e) {
      // 5xx tells Stripe to retry; acknowledging on a transient failure would
      // leave a lapsed subscriber with paid-tier access.
      console.error("Subscription payment_failed error:", e);
      res.status(500).json({ error: "payment_failed_downgrade_failed", message: safeErr(e) });
      return;
    }
  }

  res.json({ received: true });
});

export default router;
