import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma";
import { requireAdmin } from "../middleware/auth";
import { reqId } from "../utils/credits";

const router = Router();

router.get("/stats", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalAgents,
      totalRequests,
      requestsToday,
      requestsLast30Days,
      topTools,
      recentPurchases,
      x402Payments,
    ] = await Promise.all([
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
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Admin stats error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: String(e), request_id: reqId() });
  }
});

export default router;
