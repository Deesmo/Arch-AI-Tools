"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const prisma_1 = require("../lib/prisma");
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
            recent_purchases: recentPurchases,
            request_id: (0, credits_1.reqId)(),
        });
    }
    catch (e) {
        console.error("Admin stats error:", e);
        res.status(500).json({ ok: false, error: "internal_error", message: String(e), request_id: (0, credits_1.reqId)() });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map