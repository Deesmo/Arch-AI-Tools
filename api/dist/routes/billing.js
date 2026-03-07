"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const stripe_1 = require("../lib/stripe");
const auth_1 = require("../middleware/auth");
const credits_1 = require("../utils/credits");
const router = (0, express_1.Router)();
const CREDIT_PACKS = [
    { credits: 10000, amount: 900, label: "Starter Pack", priceId: process.env.STRIPE_PRICE_STARTER ?? "" },
    { credits: 10000, amount: 4900, label: "Pro Pack", priceId: process.env.STRIPE_PRICE_PRO ?? "" },
    { credits: 100000, amount: 19900, label: "Business Pack", priceId: process.env.STRIPE_PRICE_BUSINESS ?? "" },
];
// GET /v1/billing/plans
router.get("/plans", (_req, res) => {
    res.json({
        ok: true,
        plans: CREDIT_PACKS.map(p => ({
            label: p.label,
            credits: p.credits,
            price_usd: p.amount / 100,
            price_per_credit: (p.amount / p.credits / 100).toFixed(4),
        })),
        request_id: (0, credits_1.reqId)(),
    });
});
// POST /v1/billing/checkout — create Stripe checkout session
router.post("/checkout", auth_1.requireAuth, async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: (0, credits_1.reqId)() });
        return;
    }
    if (!stripe_1.stripe) {
        res.status(503).json({ ok: false, error: "not_configured", message: "Stripe not configured", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { pack } = req.body;
    const packConfig = CREDIT_PACKS.find(p => p.label.toLowerCase().startsWith((pack ?? "").toLowerCase()));
    if (!packConfig) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "pack must be one of: starter, pro, business", request_id: (0, credits_1.reqId)() });
        return;
    }
    if (!packConfig.priceId) {
        res.status(503).json({ ok: false, error: "not_configured", message: "Stripe price not configured", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const session = await stripe_1.stripe.checkout.sessions.create({
            mode: "payment",
            payment_method_types: ["card"],
            line_items: [{ price: packConfig.priceId, quantity: 1 }],
            success_url: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/pricing`,
            metadata: { agent_id: agent.id, credits: String(packConfig.credits) },
            customer_email: agent.email,
        });
        res.json({ ok: true, url: session.url, session_id: session.id, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "stripe_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
// POST /webhooks/stripe — Stripe webhook handler
router.post("/stripe", async (req, res) => {
    if (!stripe_1.stripe) {
        res.status(503).json({ error: "Stripe not configured" });
        return;
    }
    const sig = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? "";
    let event;
    try {
        event = stripe_1.stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    }
    catch (e) {
        console.error("Webhook signature error:", e);
        res.status(400).json({ error: "Invalid signature" });
        return;
    }
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const agentId = session.metadata?.agent_id;
        const credits = parseInt(session.metadata?.credits ?? "0", 10);
        const stripeId = session.id;
        if (!agentId || !credits) {
            res.json({ received: true });
            return;
        }
        try {
            // Idempotency check
            const existing = await prisma_1.prisma.purchase.findUnique({ where: { stripeId } });
            if (existing) {
                res.json({ received: true });
                return;
            }
            await prisma_1.prisma.$transaction([
                prisma_1.prisma.purchase.create({
                    data: {
                        agentId,
                        stripeId,
                        credits,
                        amountCents: session.amount_total ?? 0,
                        status: "completed",
                    },
                }),
                prisma_1.prisma.agent.update({
                    where: { id: agentId },
                    data: { credits: { increment: credits } },
                }),
            ]);
            console.log(`Credits granted: ${credits} to agent ${agentId}`);
        }
        catch (e) {
            console.error("Webhook processing error:", e);
        }
    }
    res.json({ received: true });
});
exports.default = router;
//# sourceMappingURL=billing.js.map