/**
 * Webhook Management Routes
 *
 * POST   /api/v1/webhooks/register  — Register a new webhook
 * GET    /api/v1/webhooks           — List registered webhooks
 * DELETE /api/v1/webhooks/:id       — Remove a webhook
 * POST   /api/v1/webhooks/test      — Send a test event
 */
import { Router } from "express";
import { randomBytes } from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { WEBHOOK_EVENTS, fireWebhookEvent } from "../services/webhooks.js";
const router = Router();
// All webhook management routes require authentication
router.use(requireAuth);
// ─── POST /api/v1/webhooks/register ─────────────────────────────────────────
router.post("/register", async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() });
        return;
    }
    const { url, events } = req.body;
    // Validate URL
    if (!url) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "url is required", request_id: reqId() });
        return;
    }
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:") {
            res.status(400).json({ ok: false, error: "invalid_request", message: "Webhook URL must use HTTPS", request_id: reqId() });
            return;
        }
    }
    catch {
        res.status(400).json({ ok: false, error: "invalid_request", message: "Invalid URL format", request_id: reqId() });
        return;
    }
    // Validate events
    if (!events || !Array.isArray(events) || events.length === 0) {
        res.status(400).json({
            ok: false,
            error: "invalid_request",
            message: `events is required. Available: ${WEBHOOK_EVENTS.join(", ")}`,
            request_id: reqId(),
        });
        return;
    }
    const invalidEvents = events.filter((e) => !WEBHOOK_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
        res.status(400).json({
            ok: false,
            error: "invalid_request",
            message: `Invalid events: ${invalidEvents.join(", ")}. Available: ${WEBHOOK_EVENTS.join(", ")}`,
            request_id: reqId(),
        });
        return;
    }
    // Limit webhooks per agent
    const count = await prisma.webhook.count({ where: { agentId: agent.id } });
    if (count >= 5) {
        res.status(400).json({
            ok: false,
            error: "limit_reached",
            message: "Maximum 5 webhooks per account. Delete an existing one first.",
            request_id: reqId(),
        });
        return;
    }
    try {
        // Generate signing secret
        const secret = `whsec_${randomBytes(24).toString("hex")}`;
        const webhook = await prisma.webhook.create({
            data: {
                agentId: agent.id,
                url,
                secret,
                events: events,
                active: true,
            },
        });
        res.status(201).json({
            ok: true,
            webhook: {
                id: webhook.id,
                url: webhook.url,
                events: webhook.events,
                secret, // Only shown once at creation
                active: webhook.active,
                created_at: webhook.createdAt.toISOString(),
            },
            message: "Webhook registered. Save the secret — it won't be shown again.",
            request_id: reqId(),
        });
    }
    catch (e) {
        console.error("Webhook register error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
    }
});
// ─── GET /api/v1/webhooks ───────────────────────────────────────────────────
router.get("/", async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() });
        return;
    }
    try {
        const webhooks = await prisma.webhook.findMany({
            where: { agentId: agent.id },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                url: true,
                events: true,
                active: true,
                createdAt: true,
                updatedAt: true,
                _count: { select: { deliveries: true } },
            },
        });
        res.json({
            ok: true,
            webhooks: webhooks.map((w) => ({
                id: w.id,
                url: w.url,
                events: w.events,
                active: w.active,
                total_deliveries: w._count.deliveries,
                created_at: w.createdAt.toISOString(),
                updated_at: w.updatedAt.toISOString(),
            })),
            request_id: reqId(),
        });
    }
    catch (e) {
        console.error("Webhook list error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
    }
});
// ─── DELETE /api/v1/webhooks/:id ────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() });
        return;
    }
    const webhookId = req.params.id;
    try {
        const webhook = await prisma.webhook.findFirst({
            where: { id: webhookId, agentId: agent.id },
        });
        if (!webhook) {
            res.status(404).json({ ok: false, error: "not_found", message: "Webhook not found", request_id: reqId() });
            return;
        }
        await prisma.webhook.delete({ where: { id: webhookId } });
        res.json({ ok: true, message: "Webhook deleted", request_id: reqId() });
    }
    catch (e) {
        console.error("Webhook delete error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
    }
});
// ─── POST /api/v1/webhooks/test ─────────────────────────────────────────────
router.post("/test", async (req, res) => {
    const agent = req.agent;
    if (!agent) {
        res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() });
        return;
    }
    const { webhook_id } = req.body;
    try {
        // If webhook_id provided, test that specific one; otherwise test all
        const webhooks = webhook_id
            ? await prisma.webhook.findMany({ where: { id: webhook_id, agentId: agent.id, active: true } })
            : await prisma.webhook.findMany({ where: { agentId: agent.id, active: true } });
        if (webhooks.length === 0) {
            res.status(404).json({
                ok: false,
                error: "not_found",
                message: "No active webhooks found. Register one first at POST /api/v1/webhooks/register",
                request_id: reqId(),
            });
            return;
        }
        // Fire a test event
        await fireWebhookEvent("payment.received", agent.id, {
            test: true,
            message: "This is a test webhook delivery from Arch Tools",
            amount_usd: "0.00",
            credits_added: 0,
        });
        res.json({
            ok: true,
            message: `Test event fired to ${webhooks.length} webhook(s). Check your endpoint for delivery.`,
            webhooks_notified: webhooks.length,
            request_id: reqId(),
        });
    }
    catch (e) {
        console.error("Webhook test error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
    }
});
export default router;
//# sourceMappingURL=webhooks.js.map