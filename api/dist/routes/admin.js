"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
const client_1 = require("@prisma/client");
const auth_1 = require("../middleware/auth");
const credits_1 = require("../utils/credits");
const router = (0, express_1.Router)();
router.get("/stats", auth_1.requireAdmin, async (_req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const [totalAgents, totalRequests, requestsToday, requestsLast30Days, topTools, recentPurchases, x402Payments,] = await Promise.all([
            prisma_1.prisma.agent.count(),
            prisma_1.prisma.apiRequest.count(),
            prisma_1.prisma.apiRequest.count({ where: { createdAt: { gte: new Date(today) } } }),
            prisma_1.prisma.apiRequest.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
            // Prisma v5 groupBy with correct _count orderBy syntax
            prisma_1.prisma.apiRequest.groupBy({
                by: ["toolName"],
                _count: { toolName: true },
                orderBy: { _count: { toolName: "desc" } },
                take: 10,
            }),
            prisma_1.prisma.purchase.findMany({
                where: { status: "completed" },
                orderBy: { createdAt: "desc" },
                take: 10,
                select: { credits: true, amountCents: true, createdAt: true, agentId: true },
            }),
            prisma_1.prisma.x402Payment.count(),
        ]);
        const totalRevenueCents = recentPurchases.reduce((s, p) => s + p.amountCents, 0);
        // Agent fingerprinting breakdown
        const [callerBreakdown, callerTypeBreakdown] = await Promise.all([
            prisma_1.prisma.apiRequest.groupBy({
                by: ["callerName"],
                _count: { callerName: true },
                orderBy: { _count: { callerName: "desc" } },
                take: 20,
            }),
            prisma_1.prisma.apiRequest.groupBy({
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
            request_id: (0, credits_1.reqId)(),
        });
    }
    catch (e) {
        console.error("Admin stats error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: (0, credits_1.safeErr)(e), request_id: (0, credits_1.reqId)() });
    }
});
// GET /v1/admin/lookup?email=... — look up agent API key by email (owner use only)
router.get("/lookup", auth_1.requireAdmin, async (req, res) => {
    const { email } = req.query;
    if (!email) {
        res.status(400).json({ ok: false, error: "email_required", request_id: (0, credits_1.reqId)() });
        return;
    }
    try {
        const agent = await prisma_1.prisma.agent.findUnique({ where: { email }, select: { id: true, email: true, apiKey: true, credits: true, createdAt: true } });
        if (!agent) {
            res.status(404).json({ ok: false, error: "not_found", request_id: (0, credits_1.reqId)() });
            return;
        }
        res.json({ ok: true, agent, request_id: (0, credits_1.reqId)() });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: "internal_error", message: (0, credits_1.safeErr)(e), request_id: (0, credits_1.reqId)() });
    }
});
// POST /v1/admin/seed-tools — one-shot seed for missing tools
router.post("/seed-tools", auth_1.requireAdmin, async (_req, res) => {
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
        columns = await prisma_1.prisma.$queryRaw(client_1.Prisma.sql `
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
            const existing = await prisma_1.prisma.tool.findUnique({ where: { name: t.name } });
            if (existing) {
                results.push({ name: t.name, status: "already_exists" });
            }
            else {
                // DB has extra NOT NULL columns not in Prisma schema — use raw SQL
                const id = Math.random().toString(36).slice(2, 27);
                const endpoint = `/v1/tools/${t.name}`;
                const now = new Date().toISOString();
                await prisma_1.prisma.$executeRaw(client_1.Prisma.sql `
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
    const total = await prisma_1.prisma.tool.count();
    res.json({ ok: true, columns, results, total, request_id: (0, credits_1.reqId)() });
});
exports.default = router;
//# sourceMappingURL=admin.js.map