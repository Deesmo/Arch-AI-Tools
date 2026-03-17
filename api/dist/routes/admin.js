import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { sendFeatureAnnouncement } from "../services/email.js";
import { logger } from "../lib/logger.js";
const router = Router();
router.get("/stats", requireAdmin, async (_req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [totalAgents, totalRequests, requestsToday, requestsLast30Days, topTools, recentPurchases, x402Payments,] = await Promise.all([
            prisma.agent.count(),
            prisma.apiRequest.count(),
            prisma.apiRequest.count({ where: { createdAt: { gte: new Date(today) } } }),
            prisma.apiRequest.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
            // Prisma v5 groupBy with correct _count orderBy syntax
            prisma.apiRequest.groupBy({
                by: ["toolName"],
                _count: { toolName: true },
                orderBy: { _count: { toolName: "desc" } },
                take: 10,
            }),
            prisma.purchase.findMany({
                where: { status: "completed" },
                orderBy: { createdAt: "desc" },
                take: 10,
                select: { credits: true, amountCents: true, createdAt: true, agentId: true },
            }),
            prisma.x402Payment.count(),
        ]);
        const totalRevenueCents = recentPurchases.reduce((s, p) => s + p.amountCents, 0);
        // Agent fingerprinting breakdown
        const [callerBreakdown, callerTypeBreakdown] = await Promise.all([
            prisma.apiRequest.groupBy({
                by: ["callerName"],
                _count: { callerName: true },
                orderBy: { _count: { callerName: "desc" } },
                take: 20,
            }),
            prisma.apiRequest.groupBy({
                by: ["callerType"],
                _count: { callerType: true },
                orderBy: { _count: { callerType: "desc" } },
            }),
        ]);
        res.json({
            ok: true,
            summary: {
                total_agents: totalAgents,
                total_requests: totalRequests,
                requests_today: requestsToday,
                requests_last_30d: requestsLast30Days,
                x402_payments: x402Payments,
                revenue_sample_cents: totalRevenueCents,
            },
            top_tools: topTools.map(t => ({ tool: t.toolName, calls: t._count.toolName })),
            caller_breakdown: callerBreakdown.map(c => ({ caller: c.callerName ?? "unknown", calls: c._count.callerName })),
            caller_types: callerTypeBreakdown.map(c => ({ type: c.callerType ?? "unknown", calls: c._count.callerType })),
            recent_purchases: recentPurchases,
            request_id: reqId(),
        });
    }
    catch (e) {
        console.error("Admin stats error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
    }
});
// GET /v1/admin/lookup?email=... — look up agent API key by email (owner use only)
router.get("/lookup", requireAdmin, async (req, res) => {
    const { email } = req.query;
    if (!email) {
        res.status(400).json({ ok: false, error: "email_required", request_id: reqId() });
        return;
    }
    try {
        const agent = await prisma.agent.findUnique({ where: { email }, select: { id: true, email: true, apiKey: true, credits: true, createdAt: true } });
        if (!agent) {
            res.status(404).json({ ok: false, error: "not_found", request_id: reqId() });
            return;
        }
        res.json({ ok: true, agent, request_id: reqId() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
    }
});
// POST /v1/admin/seed-tools — one-shot seed for missing tools
router.post("/seed-tools", requireAdmin, async (_req, res) => {
    const tools = [
        { name: "barcode-generate", description: "Generate Code128 barcodes as SVG", category: "media", credits: 2 },
        { name: "html-to-markdown", description: "Convert HTML or any URL to clean Markdown", category: "text", credits: 3 },
        { name: "image-generate", description: "Generate SVG images from text prompts via Claude", category: "ai", credits: 15 },
        { name: "jsonpath-query", description: "Run JSONPath expressions against any JSON payload", category: "data", credits: 1 },
        { name: "screenshot-capture", description: "Capture page metadata and screenshot URL for any public URL", category: "web", credits: 10 },
        { name: "url-shorten", description: "Shorten any URL via TinyURL", category: "utility", credits: 1 },
        { name: "webhook-send", description: "POST a JSON payload to any webhook URL", category: "utility", credits: 2 },
        { name: "workflow-agent", description: "Multi-step autonomous AI agent pipeline", category: "ai", credits: 25 },
        // Crypto tools
        { name: "crypto-price", description: "Real-time price, 24h change, market cap for any cryptocurrency", category: "crypto", credits: 1 },
        { name: "crypto-ohlcv", description: "OHLCV candlestick data for any crypto over 1-90 days", category: "crypto", credits: 2 },
        { name: "crypto-market-cap", description: "Top N cryptocurrencies by market cap with price and volume", category: "crypto", credits: 1 },
        { name: "crypto-fear-greed", description: "Crypto Fear & Greed Index with historical data", category: "crypto", credits: 1 },
        { name: "crypto-news", description: "Latest crypto news headlines with source and sentiment", category: "crypto", credits: 2 },
        { name: "crypto-sentiment", description: "Market sentiment analysis for any cryptocurrency", category: "crypto", credits: 3 },
        { name: "token-lookup", description: "Look up any token by name, symbol, or contract address", category: "crypto", credits: 1 },
    ];
    // First, diagnose the actual Tool table structure
    let columns = [];
    try {
        columns = await prisma.$queryRaw(Prisma.sql `
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'Tool'
      ORDER BY ordinal_position
    `);
    }
    catch (e) {
        columns = [{ error: String(e).slice(0, 200) }];
    }
    const results = [];
    for (const t of tools) {
        try {
            const existing = await prisma.tool.findUnique({ where: { name: t.name } });
            if (existing) {
                results.push({ name: t.name, status: "already_exists" });
            }
            else {
                // DB has extra NOT NULL columns not in Prisma schema — use raw SQL
                const id = Math.random().toString(36).slice(2, 27);
                const endpoint = `/v1/tools/${t.name}`;
                const now = new Date().toISOString();
                await prisma.$executeRaw(Prisma.sql `
          INSERT INTO "Tool" (id, name, description, endpoint, method, credits, category, active, enabled, "createdAt", "updatedAt", version)
          VALUES (${id}, ${t.name}, ${t.description}, ${endpoint}, 'POST', ${t.credits}, ${t.category}, true, true, ${now}::timestamp, ${now}::timestamp, '1.0.0')
        `);
                results.push({ name: t.name, status: "created" });
            }
        }
        catch (e) {
            results.push({ name: t.name, status: `error: ${String(e).slice(0, 300)}` });
        }
    }
    const total = await prisma.tool.count();
    res.json({ ok: true, columns, results, total, request_id: reqId() });
});
// ─── Grant credits to an agent (admin only) ─────────────────────────────────
router.post("/grant-credits", requireAdmin, async (req, res) => {
    const { agent_id, credits } = req.body;
    if (!agent_id || !credits || credits < 1 || credits > 1_000_000) {
        res.status(400).json({ ok: false, error: "invalid_request", message: "agent_id and credits (1-1000000) required", request_id: reqId() });
        return;
    }
    try {
        const agent = await prisma.agent.update({
            where: { id: agent_id },
            data: { credits: { increment: credits } },
        });
        res.json({ ok: true, agent_id, credits_added: credits, new_balance: agent.credits, request_id: reqId() });
    }
    catch (e) {
        res.status(404).json({ ok: false, error: "agent_not_found", detail: safeErr(e), request_id: reqId() });
    }
});
// ─── POST /v1/admin/email/broadcast — Send feature announcement to all users ─
router.post("/email/broadcast", requireAdmin, async (req, res) => {
    const { headline, body, cta_label, cta_url, dry_run } = req.body;
    if (!headline || !body) {
        res.status(400).json({
            ok: false,
            error: "invalid_request",
            message: "headline and body are required",
            request_id: reqId(),
        });
        return;
    }
    try {
        // Get all agents with valid emails
        const agents = await prisma.agent.findMany({
            where: { email: { not: "" } },
            select: { id: true, email: true },
        });
        if (dry_run) {
            res.json({
                ok: true,
                dry_run: true,
                recipients: agents.length,
                headline,
                body_preview: body.slice(0, 200),
                request_id: reqId(),
            });
            return;
        }
        // Send emails in batches of 10 with 1s delay between batches (Resend rate limit: 10/s)
        let sent = 0;
        let failed = 0;
        const batchSize = 10;
        for (let i = 0; i < agents.length; i += batchSize) {
            const batch = agents.slice(i, i + batchSize);
            const results = await Promise.allSettled(batch.map(agent => sendFeatureAnnouncement(agent.email, {
                headline,
                body,
                ctaLabel: cta_label,
                ctaUrl: cta_url,
            })));
            for (const r of results) {
                if (r.status === "fulfilled" && r.value)
                    sent++;
                else
                    failed++;
            }
            // Rate limit pause between batches (skip for last batch)
            if (i + batchSize < agents.length) {
                await new Promise(resolve => setTimeout(resolve, 1100));
            }
        }
        logger.info({ headline, sent, failed, total: agents.length }, "Broadcast email complete");
        res.json({
            ok: true,
            sent,
            failed,
            total: agents.length,
            headline,
            request_id: reqId(),
        });
    }
    catch (e) {
        logger.error({ error: e }, "Broadcast email error");
        res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
    }
});
export default router;
//# sourceMappingURL=admin.js.map