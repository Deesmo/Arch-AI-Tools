import { Router } from "express";
import { prisma } from "../db.js";
import { getMetricsSnapshot } from "../lib/metrics.js";
/**
 * GET /v1/status
 * Premium status endpoint for developer confidence and easy monitoring.
 * Auth optional? We keep it public but minimal (no secrets). This version is public.
 */
export const statusRouter = Router();
statusRouter.get("/v1/status", async (_req, res) => {
    let db = "unknown";
    try {
        await prisma.$queryRaw `SELECT 1`;
        db = "connected";
    }
    catch {
        db = "disconnected";
    }
    const toolCount = db === "connected" ? await prisma.tool.count({ where: { active: true } }).catch(() => 0) : 0;
    res.json({
        ok: true,
        service: "arch-tools-api",
        version: "13",
        db,
        tools_active: toolCount,
        uptime_seconds: Math.floor(process.uptime()),
        stripe_configured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
        ai_provider_configured: Boolean(process.env.ANTHROPIC_API_KEY),
        sentry_configured: Boolean(process.env.SENTRY_DSN),
        build: {
            git_sha: process.env.GIT_SHA || null,
        },
    });
});
/**
 * GET /v1/metrics
 * Protected lightweight metrics snapshot (counts + latency).
 * Set METRICS_API_KEY to enable and call with header: x-metrics-key
 */
statusRouter.get("/v1/metrics", (req, res) => {
    const key = process.env.METRICS_API_KEY;
    if (!key)
        return res.status(404).json({ ok: false, error: "not_found" });
    const provided = String(req.header("x-metrics-key") || "");
    if (provided !== key)
        return res.status(401).json({ ok: false, error: "unauthorized" });
    res.json(getMetricsSnapshot());
});
//# sourceMappingURL=status.js.map