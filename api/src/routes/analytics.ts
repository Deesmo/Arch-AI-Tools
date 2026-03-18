/**
 * Analytics API Routes — Admin dashboard data endpoints
 *
 * All endpoints require admin authentication via x-admin-key header.
 * Uses both Prisma (DB) for historical data and Redis/in-memory for real-time.
 */
import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "../middleware/auth.js";
import {
  getRecentMetrics,
  getMetricsSince,
  getTotalCallsInMemory,
  getRedisAnalytics,
  getToolRedisStats,
  getActiveAlerts,
  getAllAlerts,
  acknowledgeAlert,
  getAlertStats,
  getRateLimitViolators,
} from "../middleware/analytics.js";
import { X402_PRICES } from "../middleware/x402.js";
import { reqId, safeErr } from "../utils/credits.js";

const router = Router();

// ─── GET /api/v1/analytics/overview ──────────────────────────────────────────
// Total calls, revenue, unique users, top tools — high-level dashboard data
router.get("/overview", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const todayStart = new Date(today);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalRequests,
      requestsToday,
      requestsWeek,
      requestsMonth,
      totalAgents,
      activeAgentsWeek,
      totalX402Payments,
      x402RevenueResult,
      stripeRevenueResult,
      topTools,
      topCallers,
    ] = await Promise.all([
      prisma.apiRequest.count(),
      prisma.apiRequest.count({ where: { createdAt: { gte: todayStart } } }),
      prisma.apiRequest.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.apiRequest.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.agent.count(),
      prisma.agent.count({ where: { lastSeenAt: { gte: weekAgo } } }),
      prisma.x402Payment.count(),
      // @ts-ignore — Prisma aggregate typing
      prisma.x402Payment.count(),
      prisma.purchase.aggregate({
        // @ts-ignore — Prisma aggregate typing
        _sum: { amountCents: true },
        where: { status: "completed" },
      }),
      prisma.apiRequest.groupBy({
        by: ["toolName"],
        _count: { toolName: true },
        orderBy: { _count: { toolName: "desc" } },
        take: 10,
      }),
      prisma.apiRequest.groupBy({
        by: ["callerType"],
        _count: { callerType: true },
        orderBy: { _count: { callerType: "desc" } },
      }),
    ]);

    // Parse x402 revenue (stored as string in DB)
    const x402Payments = await prisma.x402Payment.findMany({
      where: { status: "settled" },
      select: { amountUsdc: true },
    });
    const x402RevenueUsdc = x402Payments.reduce((sum, p) => sum + parseFloat(p.amountUsdc || "0"), 0);
    const stripeRevenueCents = stripeRevenueResult._sum.amountCents ?? 0;
    const totalRevenueUsdc = x402RevenueUsdc + (stripeRevenueCents / 100);

    // Real-time counters from Redis (if available)
    const redisStats = await getRedisAnalytics();
    const inMemoryTotal = getTotalCallsInMemory();

    res.json({
      ok: true,
      overview: {
        total_requests: totalRequests,
        requests_today: redisStats?.callsToday ?? requestsToday,
        requests_week: requestsWeek,
        requests_month: requestsMonth,
        total_agents: totalAgents,
        active_agents_week: activeAgentsWeek,
        total_x402_payments: totalX402Payments,
        revenue: {
          x402_usdc: Math.round(x402RevenueUsdc * 1000) / 1000,
          stripe_usd: Math.round(stripeRevenueCents) / 100,
          total_usd: Math.round(totalRevenueUsdc * 100) / 100,
        },
        realtime: {
          session_calls: inMemoryTotal,
          redis_available: !!redisStats,
          ...(redisStats ?? {}),
        },
      },
      top_tools: topTools.map(t => ({
        tool: t.toolName,
        calls: t._count.toolName,
      })),
      caller_types: topCallers.map(c => ({
        type: c.callerType ?? "unknown",
        calls: c._count.callerType,
      })),
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Analytics overview error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /api/v1/analytics/tools ─────────────────────────────────────────────
// Per-tool breakdown: calls, revenue, avg response time
router.get("/tools", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    // Get call counts per tool from DB
    const toolCalls = await prisma.apiRequest.groupBy({
      by: ["toolName"],
      _count: { toolName: true },
      _avg: { responseMs: true },
      orderBy: { _count: { toolName: "desc" } },
    });

    // Get x402 revenue per tool
    const x402ByTool = await prisma.x402Payment.groupBy({
      by: ["toolName"],
      _count: { toolName: true },
      where: { status: "settled" },
    });

    // Build per-tool x402 payments map
    const x402PaymentsByTool = await prisma.x402Payment.findMany({
      where: { status: "settled" },
      select: { toolName: true, amountUsdc: true },
    });
    const x402RevenueMap: Record<string, number> = {};
    for (const p of x402PaymentsByTool) {
      x402RevenueMap[p.toolName] = (x402RevenueMap[p.toolName] ?? 0) + parseFloat(p.amountUsdc || "0");
    }

    const x402CountMap = Object.fromEntries(x402ByTool.map(t => [t.toolName, t._count.toolName]));

    const tools = toolCalls.map(t => {
      const price = X402_PRICES[t.toolName] ?? "0.005";
      return {
        tool: t.toolName,
        total_calls: t._count.toolName,
        avg_response_ms: Math.round(t._avg.responseMs ?? 0),
        x402_payments: x402CountMap[t.toolName] ?? 0,
        x402_revenue_usdc: Math.round((x402RevenueMap[t.toolName] ?? 0) * 1000) / 1000,
        price_usdc: price,
      };
    });

    res.json({
      ok: true,
      tools,
      total_tools: tools.length,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Analytics tools error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /api/v1/analytics/revenue ───────────────────────────────────────────
// Revenue by day/week/month, by chain, by tool
router.get("/revenue", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const period = (req.query.period as string) ?? "30d";
    const daysBack = period === "7d" ? 7 : period === "90d" ? 90 : 30;
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    // x402 revenue by day
    const x402Payments = await prisma.x402Payment.findMany({
      where: { status: "settled", createdAt: { gte: cutoff } },
      select: { amountUsdc: true, network: true, toolName: true, createdAt: true, txHash: true },
      orderBy: { createdAt: "desc" },
    });

    // Group by day
    const byDay: Record<string, number> = {};
    const byChain: Record<string, number> = {};
    const byTool: Record<string, number> = {};

    for (const p of x402Payments) {
      const day = p.createdAt.toISOString().slice(0, 10);
      const amount = parseFloat(p.amountUsdc || "0");
      byDay[day] = (byDay[day] ?? 0) + amount;
      byChain[p.network] = (byChain[p.network] ?? 0) + amount;
      byTool[p.toolName] = (byTool[p.toolName] ?? 0) + amount;
    }

    // Stripe revenue by day
    const stripePurchases = await prisma.purchase.findMany({
      where: { status: "completed", createdAt: { gte: cutoff } },
      select: { amountCents: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });

    const stripeByDay: Record<string, number> = {};
    for (const p of stripePurchases) {
      const day = p.createdAt.toISOString().slice(0, 10);
      stripeByDay[day] = (stripeByDay[day] ?? 0) + p.amountCents / 100;
    }

    // Recent x402 transactions
    const recentTx = x402Payments.slice(0, 50).map(p => ({
      amount_usdc: p.amountUsdc,
      chain: p.network,
      tool: p.toolName,
      tx_hash: p.txHash,
      timestamp: p.createdAt.toISOString(),
    }));

    // ─── Facilitator fee revenue ──────────────────────────────────────
    let facilitatorFeeTotal = 0;
    let facilitatorSettledTotal = 0;
    let facilitatorTxCount = 0;
    try {
      const feeRecords = await prisma.facilitatorFeeRecord.findMany({
        where: { createdAt: { gte: cutoff } },
        select: { feeAmount: true, settlementAmount: true },
      });
      for (const r of feeRecords) {
        facilitatorFeeTotal += parseFloat(r.feeAmount) / 1_000_000;
        facilitatorSettledTotal += parseFloat(r.settlementAmount) / 1_000_000;
        facilitatorTxCount++;
      }
    } catch { /* FacilitatorFeeRecord table may not exist yet */ }

    // ─── Directory listing revenue ────────────────────────────────────
    let directoryListingRevenue = 0;
    let activeListingsCount = 0;
    try {
      const activeListings = await prisma.directoryListing.findMany({
        where: { status: "active" },
        select: { monthlyPrice: true },
      });
      activeListingsCount = activeListings.length;
      directoryListingRevenue = activeListings.reduce((sum, l) => sum + l.monthlyPrice, 0);
    } catch { /* DirectoryListing table may not exist yet */ }

    res.json({
      ok: true,
      period,
      x402: {
        total_usdc: Math.round(x402Payments.reduce((s, p) => s + parseFloat(p.amountUsdc || "0"), 0) * 1000) / 1000,
        payment_count: x402Payments.length,
        by_day: Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({
          date,
          amount_usdc: Math.round(amount * 1000) / 1000,
        })),
        by_chain: Object.entries(byChain).sort(([, a], [, b]) => b - a).map(([chain, amount]) => ({
          chain,
          amount_usdc: Math.round(amount * 1000) / 1000,
        })),
        by_tool: Object.entries(byTool).sort(([, a], [, b]) => b - a).map(([tool, amount]) => ({
          tool,
          amount_usdc: Math.round(amount * 1000) / 1000,
        })),
      },
      stripe: {
        total_usd: Math.round(stripePurchases.reduce((s, p) => s + p.amountCents, 0)) / 100,
        purchase_count: stripePurchases.length,
        by_day: Object.entries(stripeByDay).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({
          date,
          amount_usd: Math.round(amount * 100) / 100,
        })),
      },
      facilitator: {
        fee_revenue_usdc: Math.round(facilitatorFeeTotal * 1000) / 1000,
        settled_volume_usdc: Math.round(facilitatorSettledTotal * 1000) / 1000,
        transaction_count: facilitatorTxCount,
        effective_rate: facilitatorSettledTotal > 0
          ? Math.round((facilitatorFeeTotal / facilitatorSettledTotal) * 10000) / 100
          : 0,
      },
      directory_listings: {
        active_count: activeListingsCount,
        monthly_revenue_usd: directoryListingRevenue,
      },
      total_revenue: {
        x402_usdc: Math.round(x402Payments.reduce((s, p) => s + parseFloat(p.amountUsdc || "0"), 0) * 1000) / 1000,
        stripe_usd: Math.round(stripePurchases.reduce((s, p) => s + p.amountCents, 0)) / 100,
        facilitator_fees_usdc: Math.round(facilitatorFeeTotal * 1000) / 1000,
        directory_listings_usd: directoryListingRevenue,
        combined_usd_estimate: Math.round((
          x402Payments.reduce((s, p) => s + parseFloat(p.amountUsdc || "0"), 0) +
          stripePurchases.reduce((s, p) => s + p.amountCents, 0) / 100 +
          facilitatorFeeTotal +
          directoryListingRevenue
        ) * 100) / 100,
      },
      recent_transactions: recentTx,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Analytics revenue error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /api/v1/analytics/agents ────────────────────────────────────────────
// Top agents by usage (anonymized IDs for privacy)
router.get("/agents", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const topAgents = await prisma.apiRequest.groupBy({
      by: ["agentId"],
      _count: { agentId: true },
      orderBy: { _count: { agentId: "desc" } },
      take: 50,
    });

    // Get agent details for enrichment
    const agentIds = topAgents.map(a => a.agentId);
    const agents = await prisma.agent.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, tier: true, credits: true, totalCalls: true, lastSeenAt: true, createdAt: true },
    });
    const agentMap = Object.fromEntries(agents.map(a => [a.id, a]));

    const result = topAgents.map(a => {
      const agent = agentMap[a.agentId];
      // Anonymize: show first 8 chars of ID
      const anonId = a.agentId === "x402_anonymous"
        ? "x402_anonymous"
        : `${a.agentId.slice(0, 8)}...`;

      return {
        agent_id_short: anonId,
        total_calls: a._count.agentId,
        tier: agent?.tier ?? "unknown",
        credits_remaining: agent?.credits ?? 0,
        last_seen: agent?.lastSeenAt?.toISOString() ?? null,
        member_since: agent?.createdAt?.toISOString() ?? null,
      };
    });

    res.json({
      ok: true,
      agents: result,
      total_agents: result.length,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Analytics agents error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /api/v1/analytics/realtime ──────────────────────────────────────────
// Real-time metrics from in-memory buffer (last N minutes)
router.get("/realtime", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const minutes = parseInt(req.query.minutes as string) || 60;
    const sinceMs = Date.now() - minutes * 60 * 1000;
    const metrics = getMetricsSince(sinceMs);

    // Aggregate
    const byTool: Record<string, { count: number; totalMs: number; errors: number }> = {};
    let totalCalls = 0;
    let totalErrors = 0;
    let totalMs = 0;

    for (const m of metrics) {
      totalCalls++;
      totalMs += m.responseMs;
      if (m.statusCode >= 400) totalErrors++;

      if (m.toolName) {
        if (!byTool[m.toolName]) byTool[m.toolName] = { count: 0, totalMs: 0, errors: 0 };
        byTool[m.toolName].count++;
        byTool[m.toolName].totalMs += m.responseMs;
        if (m.statusCode >= 400) byTool[m.toolName].errors++;
      }
    }

    const toolBreakdown = Object.entries(byTool)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([tool, data]) => ({
        tool,
        calls: data.count,
        avg_ms: data.count > 0 ? Math.round(data.totalMs / data.count) : 0,
        error_rate: data.count > 0 ? Math.round((data.errors / data.count) * 100) / 100 : 0,
      }));

    res.json({
      ok: true,
      window_minutes: minutes,
      total_calls: totalCalls,
      total_errors: totalErrors,
      error_rate: totalCalls > 0 ? Math.round((totalErrors / totalCalls) * 10000) / 100 : 0,
      avg_response_ms: totalCalls > 0 ? Math.round(totalMs / totalCalls) : 0,
      tools: toolBreakdown,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Analytics realtime error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /api/v1/analytics/alerts ────────────────────────────────────────────
// Active usage alerts (rate limit violations, low credits, traffic spikes)
router.get("/alerts", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const unacknowledgedOnly = _req.query.active !== "false";
    const limit = parseInt(String(_req.query.limit ?? "50")) || 50;
    const alerts = unacknowledgedOnly ? getActiveAlerts(limit) : getAllAlerts(limit);
    const stats = getAlertStats();
    const violators = getRateLimitViolators();

    res.json({
      ok: true,
      alerts,
      stats,
      rate_limit_violators: violators,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Analytics alerts error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── POST /api/v1/analytics/alerts/:id/acknowledge ──────────────────────────
// Acknowledge (dismiss) an alert
router.post("/alerts/:id/acknowledge", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const success = acknowledgeAlert(String(req.params.id));
    if (success) {
      res.json({ ok: true, message: "Alert acknowledged", request_id: reqId() });
    } else {
      res.status(404).json({ ok: false, error: "not_found", message: "Alert not found", request_id: reqId() });
    }
  } catch (e) {
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

export default router;
