"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const stripe_1 = require("../lib/stripe");
const auth_1 = require("../middleware/auth");
const credits_1 = require("../utils/credits");
const email_1 = require("../services/email");
const router = (0, express_1.Router)();
// ─── One-time credit packs ──────────────────────────────────────────────────
const CREDIT_PACKS = [
    { credits: 10000, amount: 900, label: "Starter Pack", priceId: process.env.STRIPE_PRICE_STARTER ?? "" },
    { credits: 60000, amount: 4900, label: "Pro Pack", priceId: process.env.STRIPE_PRICE_PRO ?? "" },
    { credits: 250000, amount: 19900, label: "Business Pack", priceId: process.env.STRIPE_PRICE_BUSINESS ?? "" },
];
// ─── Monthly subscription plans ────────────────────────────────────────────
const SUBSCRIPTION_PLANS = [
    {
        id: "starter-monthly",
        label: "Starter",
        billing: "monthly",
        credits_per_month: 600,
        amount: 900, // $9/mo
        priceId: process.env.STRIPE_PRICE_SUB_STARTER_MONTHLY ?? "price_1T8pQtKzBSl1smzF1927svjM",
    },
    {
        id: "pro-monthly",
        label: "Pro",
        billing: "monthly",
        credits_per_month: 3000,
        amount: 2900, // $29/mo
        priceId: process.env.STRIPE_PRICE_SUB_PRO_MONTHLY ?? "price_1T8pQtKzBSl1smzF3Lv6bPEr",
    },
    {
        id: "business-monthly",
        label: "Business",
        billing: "monthly",
        credits_per_month: 12000,
        amount: 8900, // $89/mo
        priceId: process.env.STRIPE_PRICE_SUB_BUSINESS_MONTHLY ?? "price_1T8pQuKzBSl1smzF8WWHHAr8",
    },
    {
        id: "starter-annual",
        label: "Starter",
        billing: "annual",
        credits_per_month: 600,
        credits_per_year: 7200,
        amount: 8100, // $81/yr = $6.75/mo (25% off)
        amount_monthly_equiv: 675,
        priceId: process.env.STRIPE_PRICE_SUB_STARTER_ANNUAL ?? "price_1T8pQuKzBSl1smzFRoaBUtBf",
    },
    {
        id: "pro-annual",
        label: "Pro",
        billing: "annual",
        credits_per_month: 3000,
        credits_per_year: 36000,
        amount: 26100, // $261/yr = $21.75/mo (25% off)
        amount_monthly_equiv: 2175,
        priceId: process.env.STRIPE_PRICE_SUB_PRO_ANNUAL ?? "price_1T8pQuKzBSl1smzFa6rrFn18",
    },
    {
        id: "business-annual",
        label: "Business",
        billing: "annual",
        credits_per_month: 12000,
        credits_per_year: 144000,
        amount: 80100, // $801/yr = $66.75/mo (25% off)
        amount_monthly_equiv: 6675,
        priceId: process.env.STRIPE_PRICE_SUB_BUSINESS_ANNUAL ?? "price_1T8pQvKzBSl1smzFzM34v689",
    },
];
// GET /v1/billing/plans — returns all plans (one-time + subscription)
router.get("/plans", (_req, res) => {
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
            price_monthly_equiv: p.billing === "annual" ? (p.amount_monthly_equiv ?? p.amount) / 100 : p.amount / 100,
            savings_vs_monthly: p.billing === "annual" ? "25%" : null,
            auto_renew: true,
            credits_refresh: "monthly",
        })),
        request_id: (0, credits_1.reqId)(),
    });
});
// POST /v1/billing/checkout — one-time pack checkout
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
// POST /v1/billing/subscribe — subscription checkout
router.post("/subscribe", auth_1.requireAuth, async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: (0, credits_1.reqId)() });
        return;
    }
    if (!stripe_1.stripe) {
        res.status(503).json({ ok: false, error: "not_configured", message: "Stripe not configured", request_id: (0, credits_1.reqId)() });
        return;
    }
    const { plan } = req.body;
    const planConfig = SUBSCRIPTION_PLANS.find(p => p.id === plan);
    if (!planConfig) {
        const ids = SUBSCRIPTION_PLANS.map(p => p.id).join(", ");
        res.status(400).json({ ok: false, error: "invalid_request", message: `plan must be one of: ${ids}`, request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const session = await stripe_1.stripe.checkout.sessions.create({
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
        res.json({ ok: true, url: session.url, session_id: session.id, plan: planConfig.id, request_id: (0, credits_1.reqId)() });
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
    // ─── One-time purchase ───────────────────────────────────────────────────
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const agentId = session.metadata?.agent_id;
        const stripeId = session.id;
        if (!agentId) {
            res.json({ received: true });
            return;
        }
        try {
            const existing = await prisma_1.prisma.purchase.findUnique({ where: { stripeId } });
            if (existing) {
                res.json({ received: true });
                return;
            }
            // One-time payment
            if (session.mode === "payment") {
                const credits = parseInt(session.metadata?.credits ?? "0", 10);
                if (!credits) {
                    res.json({ received: true });
                    return;
                }
                await prisma_1.prisma.$transaction([
                    prisma_1.prisma.purchase.create({ data: { agentId, stripeId, credits, amountCents: session.amount_total ?? 0, status: "completed" } }),
                    prisma_1.prisma.agent.update({ where: { id: agentId }, data: { credits: { increment: credits } } }),
                ]);
                console.log(`[billing] One-time: +${credits} credits to agent ${agentId}`);
                try {
                    const agentRecord = await prisma_1.prisma.agent.findUnique({ where: { id: agentId }, select: { email: true, credits: true } });
                    if (agentRecord?.email) {
                        const pack = CREDIT_PACKS.find(p => p.credits === credits);
                        (0, email_1.sendPurchaseConfirmation)(agentRecord.email, credits, pack?.label ?? "Credit Pack", agentRecord.credits).catch(() => { });
                    }
                }
                catch { /* non-fatal */ }
                // Subscription — first payment
            }
            else if (session.mode === "subscription") {
                const creditsPerMonth = parseInt(session.metadata?.credits_per_month ?? "0", 10);
                const planId = session.metadata?.plan_id ?? "";
                const planLabel = session.metadata?.plan_label ?? "Subscription";
                if (!creditsPerMonth) {
                    res.json({ received: true });
                    return;
                }
                await prisma_1.prisma.$transaction([
                    prisma_1.prisma.purchase.create({ data: { agentId, stripeId, credits: creditsPerMonth, amountCents: session.amount_total ?? 0, status: "completed" } }),
                    prisma_1.prisma.agent.update({ where: { id: agentId }, data: { credits: { increment: creditsPerMonth }, tier: planId } }),
                ]);
                console.log(`[billing] Subscription start: +${creditsPerMonth} credits/month (${planLabel}) to agent ${agentId}`);
            }
        }
        catch (e) {
            console.error("Webhook processing error:", e);
        }
    }
    // ─── Subscription renewal (monthly/annual invoice paid) ──────────────────
    if (event.type === "invoice.paid") {
        const invoice = event.data.object;
        // Skip the very first invoice (handled by checkout.session.completed above)
        if (invoice.billing_reason === "subscription_create") {
            res.json({ received: true });
            return;
        }
        const subscriptionId = invoice.subscription;
        if (!subscriptionId || !stripe_1.stripe) {
            res.json({ received: true });
            return;
        }
        try {
            const subscription = await stripe_1.stripe.subscriptions.retrieve(subscriptionId);
            const agentId = subscription.metadata?.agent_id;
            const creditsPerMonth = parseInt(subscription.metadata?.credits_per_month ?? "0", 10);
            if (!agentId || !creditsPerMonth) {
                res.json({ received: true });
                return;
            }
            // Idempotency: use invoice ID
            const invoiceId = invoice.id ?? subscriptionId;
            const existing = await prisma_1.prisma.purchase.findUnique({ where: { stripeId: invoiceId } });
            if (existing) {
                res.json({ received: true });
                return;
            }
            await prisma_1.prisma.$transaction([
                prisma_1.prisma.purchase.create({ data: { agentId, stripeId: invoiceId, credits: creditsPerMonth, amountCents: invoice.amount_paid ?? 0, status: "completed" } }),
                prisma_1.prisma.agent.update({ where: { id: agentId }, data: { credits: { increment: creditsPerMonth } } }),
            ]);
            console.log(`[billing] Renewal: +${creditsPerMonth} credits to agent ${agentId}`);
        }
        catch (e) {
            console.error("Subscription renewal error:", e);
        }
    }
    // ─── Subscription cancelled ──────────────────────────────────────────────
    if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;
        const agentId = subscription.metadata?.agent_id;
        if (agentId) {
            await prisma_1.prisma.agent.update({ where: { id: agentId }, data: { tier: "free" } }).catch(() => { });
            console.log(`[billing] Subscription cancelled for agent ${agentId}`);
        }
    }
    res.json({ received: true });
});
exports.default = router;
//# sourceMappingURL=billing.js.map