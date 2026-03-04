import { Router } from "express";
import { prisma } from "../db.js";
import { requireApiKey } from "../middleware/auth.js";
export const dashboardRouter = Router();
// Premium dashboard analytics
dashboardRouter.get("/v1/dashboard/usage", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const days = Math.min(Math.max(Number(req.query?.days) || 30, 1), 180);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Prefer ApiRequest table if migrated; otherwise fall back to ledger debits.
    let series = [];
    try {
        series = await prisma.$queryRawUnsafe(`SELECT date_trunc('day', "createdAt")::date as day, count(*)::int as calls, sum("creditsUsed")::int as credits
       FROM api_requests
       WHERE "agentId" = $1 AND "createdAt" >= $2
       GROUP BY 1
       ORDER BY 1 ASC`, agentId, since);
    }
    catch {
        // ledger fallback
        series = await prisma.$queryRawUnsafe(`SELECT date_trunc('day', "createdAt")::date as day, count(*)::int as calls, sum("credits")::int as credits
       FROM "LedgerEntry"
       WHERE "agentId" = $1 AND "createdAt" >= $2 AND kind = 'debit'
       GROUP BY 1
       ORDER BY 1 ASC`, agentId, since);
    }
    res.json({ ok: true, days, series });
});
dashboardRouter.get("/v1/dashboard/requests", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const limit = Math.min(Math.max(Number(req.query?.limit) || 50, 1), 200);
    try {
        const rows = await prisma.$queryRawUnsafe(`SELECT "createdAt" as ts, tool, status, "latencyMs" as latency_ms, "creditsUsed" as credits_used, "requestId" as request_id
       FROM api_requests
       WHERE "agentId" = $1
       ORDER BY "createdAt" DESC
       LIMIT $2`, agentId, limit);
        return res.json({ ok: true, requests: rows });
    }
    catch {
        // If ApiRequest not available yet, return last ledger entries as a fallback.
        const rows = await prisma.ledgerEntry.findMany({
            where: { agentId, kind: "debit" },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: { createdAt: true, toolName: true, credits: true, requestId: true, meta: true },
        });
        return res.json({
            ok: true,
            requests: rows.map((r) => ({
                ts: r.createdAt,
                tool: r.toolName,
                status: "ok",
                latency_ms: r.meta?.latency_ms ?? null,
                credits_used: r.credits,
                request_id: r.requestId,
            })),
        });
    }
});
// API key management in dashboard UI
dashboardRouter.get("/v1/dashboard/api-keys", requireApiKey, async (req, res) => {
    const agentId = req.agentId;
    const keys = await prisma.apiKey.findMany({
        where: { agentId, revokedAt: null },
        orderBy: { createdAt: "desc" },
        select: { prefix: true, label: true, createdAt: true, revokedAt: true },
    });
    res.json({ ok: true, keys });
});
//# sourceMappingURL=dashboard.js.map