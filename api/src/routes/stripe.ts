import { Router, type Request, type Response } from "express";
import { prisma } from "../db.js";
import { requireApiKey } from "../middleware/auth.js";
import { logger } from "../lib/logger.js";

export const stripeRouter = Router();

/**
 * Credit pack mapping (matches your live Stripe price IDs)
 */
const CREDIT_MAP: Record<string, { credits: number; plan: string; label: string }> = {
  price_1T6boqKzBSl1smzF8iMstc4o: { credits: 1_000, plan: "free", label: "Starter $9" },
  price_1T6bouKzBSl1smzFdOXWN8E2: { credits: 10_000, plan: "pro", label: "Pro $49" },
  price_1T6bp0KzBSl1smzF1awnTk7I: { credits: 100_000, plan: "business", label: "Business $199" },
};

/**
 * POST /v1/checkout — create a Stripe checkout session
 * Requires API key so we can embed agent_id in metadata.
 * Returns a checkout URL the developer redirects to.
 */
stripeRouter.post("/v1/checkout", requireApiKey, async (req: any, res) => {
  const { price_id, success_url, cancel_url } = req.body || {};

  if (!price_id || !CREDIT_MAP[price_id]) {
    return res.status(400).json({
      error: "invalid_price_id",
      valid_prices: Object.entries(CREDIT_MAP).map(([id, info]) => ({
        price_id: id,
        ...info,
      })),
    });
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }

  try {
    const stripe = (await import("stripe")).default;
    const client = new stripe(stripeKey, { apiVersion: "2024-06-20" as any });

    const session = await client.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: price_id, quantity: 1 }],
      metadata: {
        agent_id: req.agentId,
        price_id: price_id,
      },
      success_url: success_url || "https://archtools.dev/success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: cancel_url || "https://archtools.dev/#pricing",
    });

    logger.info({ agentId: req.agentId, price_id }, "Checkout session created");

    res.json({
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (e: any) {
    logger.error({ error: e.message }, "Stripe checkout creation failed");
    return res.status(500).json({ error: "checkout_failed", detail: e.message });
  }
});

/**
 * POST /stripe/webhook — Stripe webhook handler
 * Listens for checkout.session.completed → grants credits.
 *
 * Setup:
 * 1. Stripe Dashboard → Webhooks → Add endpoint
 * 2. URL: https://archtools.dev/stripe/webhook
 * 3. Events: checkout.session.completed
 * 4. Copy signing secret → STRIPE_WEBHOOK_SECRET env var
 */
stripeRouter.post("/stripe/webhook", async (req: Request, res: Response) => {
  const sig = req.headers["stripe-signature"];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;

  let event: any;

  // Stripe recommends verifying signatures using the *raw* request body.
  // See Stripe webhook docs.
  if (!secret || !stripeKey) {
    return res.status(503).json({ error: "stripe_not_configured" });
  }
  if (!sig) {
    return res.status(400).json({ error: "missing_stripe_signature" });
  }

  if (secret && sig) {
    try {
      const stripe = await import("stripe");
      const client = new stripe.default(stripeKey, {
        apiVersion: "2024-06-20" as any,
      });
      event = client.webhooks.constructEvent(
        (req as any).rawBody || JSON.stringify(req.body),
        sig as string,
        secret
      );
    } catch (e: any) {
      logger.warn({ error: e.message }, "Stripe webhook signature verification failed");
      return res.status(400).json({ error: "webhook_signature_invalid" });
    }
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const agentId = session?.metadata?.agent_id;
    const priceId = session?.metadata?.price_id;

    if (!agentId) {
      logger.warn({ session_id: session?.id }, "Checkout completed but no agent_id in metadata");
      return res.json({ received: true, action: "skipped_no_agent_id" });
    }

    if (!priceId) {
      logger.warn({ session_id: session?.id }, "Checkout completed but no price_id in metadata");
      return res.json({ received: true, action: "skipped_no_price_id" });
    }

    const packInfo = CREDIT_MAP[priceId];
    if (!packInfo) {
      logger.warn({ priceId }, "Unknown price_id in checkout — no credits granted");
      return res.json({ received: true, action: "skipped_unknown_price" });
    }

    // Check agent exists
    const agent = await prisma.agent.findUnique({ where: { id: agentId } });
    if (!agent) {
      logger.warn({ agentId }, "Agent not found for credit grant");
      return res.json({ received: true, action: "skipped_agent_not_found" });
    }

    // Idempotency: check if this session was already processed
    const reference = session?.id || session?.payment_intent;
    const existing = await prisma.creditGrant.findFirst({
      where: { agentId, source: "stripe", reference },
    });
    if (existing) {
      logger.info({ agentId, reference }, "Duplicate webhook — credits already granted");
      return res.json({ received: true, action: "already_processed" });
    }

    // Grant credits
    await prisma.creditGrant.create({
      data: {
        agentId,
        credits: packInfo.credits,
        source: "stripe",
        reference,
      },
    });

    // Auto-upgrade plan if applicable
    if (packInfo.plan !== "free" && agent.plan === "free") {
      await prisma.agent.update({
        where: { id: agentId },
        data: { plan: packInfo.plan as any },
      });
      logger.info({ agentId, plan: packInfo.plan }, "Agent auto-upgraded via purchase");
    }

    logger.info({ agentId, credits: packInfo.credits, priceId, session_id: session?.id }, "Credits granted via Stripe");
    return res.json({ received: true, action: "credits_granted", credits: packInfo.credits });
  }

  return res.json({ received: true, action: "ignored" });
});
