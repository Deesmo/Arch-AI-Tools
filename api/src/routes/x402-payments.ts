/**
 * x402 Payment Receipt & History Routes
 *
 * GET /receipt/:txHash  — Public: look up a payment by transaction hash
 * GET /payments         — Admin: paginated payment history with filters
 * GET /payments/stats   — Admin: revenue stats & analytics
 */

import { Router, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAdmin } from "../middleware/auth.js";

const router = Router();

/* ------------------------------------------------------------------ */
/*  GET /receipt/:txHash — Public endpoint                            */
/* ------------------------------------------------------------------ */
router.get("/receipt/:txHash", async (req: Request, res: Response): Promise<void> => {
  try {
    const txHash = String(req.params.txHash ?? "");

    if (!txHash || txHash.length < 10) {
      res.status(400).json({ ok: false, error: "invalid_tx_hash", message: "Provide a valid transaction hash." });
      return;
    }

    const payment = await prisma.x402Payment.findFirst({
      where: { txHash },
    });

    if (!payment) {
      res.status(404).json({ ok: false, error: "not_found", message: "No payment found for this transaction hash." });
      return;
    }

    res.json({
      ok: true,
      receipt: {
        id: payment.id,
        toolName: payment.toolName,
        amountUsdc: payment.amountUsdc,
        network: payment.network,
        txHash: payment.txHash,
        status: payment.status,
        timestamp: payment.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error("[x402-payments] receipt error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /payments — Admin: paginated list with filters                */
/* ------------------------------------------------------------------ */
router.get("/payments", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const skip = (page - 1) * limit;

    // Build filter
    const where: Prisma.X402PaymentWhereInput = {};

    if (req.query.tool) {
      where.toolName = String(req.query.tool);
    }
    if (req.query.network) {
      where.network = String(req.query.network);
    }
    if (req.query.status) {
      where.status = String(req.query.status);
    }
    if (req.query.agent) {
      where.agentId = String(req.query.agent);
    }

    // Date range
    if (req.query.from || req.query.to) {
      const createdAt: Prisma.DateTimeFilter = {};
      if (req.query.from) createdAt.gte = new Date(String(req.query.from));
      if (req.query.to) createdAt.lte = new Date(String(req.query.to));
      where.createdAt = createdAt;
    }

    const [payments, total] = await Promise.all([
      prisma.x402Payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.x402Payment.count({ where }),
    ]);

    res.json({
      ok: true,
      payments: payments.map((p) => ({
        id: p.id,
        agentId: p.agentId,
        toolName: p.toolName,
        amountUsdc: p.amountUsdc,
        network: p.network,
        txHash: p.txHash,
        status: p.status,
        timestamp: p.createdAt.toISOString(),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[x402-payments] payments list error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /payments/stats — Admin: revenue analytics                    */
/* ------------------------------------------------------------------ */
router.get("/payments/stats", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    // Total payments & revenue
    const allPayments = await prisma.x402Payment.findMany({
      select: { amountUsdc: true, agentId: true, toolName: true, createdAt: true },
    });

    const totalPayments = allPayments.length;
    const totalRevenue = allPayments.reduce((sum, p) => sum + parseFloat(p.amountUsdc || "0"), 0);
    const uniqueAgents = new Set(allPayments.filter((p) => p.agentId).map((p) => p.agentId)).size;

    // Revenue by day (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentPayments = allPayments.filter((p) => p.createdAt >= thirtyDaysAgo);
    const revenueByDay: Record<string, number> = {};
    for (const p of recentPayments) {
      const day = p.createdAt.toISOString().slice(0, 10);
      revenueByDay[day] = (revenueByDay[day] || 0) + parseFloat(p.amountUsdc || "0");
    }

    // Fill in missing days with 0
    const dailyRevenue: Array<{ date: string; revenue: number; count: number }> = [];
    const countByDay: Record<string, number> = {};
    for (const p of recentPayments) {
      const day = p.createdAt.toISOString().slice(0, 10);
      countByDay[day] = (countByDay[day] || 0) + 1;
    }

    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      dailyRevenue.push({
        date: day,
        revenue: Math.round((revenueByDay[day] || 0) * 1e6) / 1e6,
        count: countByDay[day] || 0,
      });
    }

    // Top tools by revenue
    const toolRevenue: Record<string, { revenue: number; count: number }> = {};
    for (const p of allPayments) {
      if (!toolRevenue[p.toolName]) toolRevenue[p.toolName] = { revenue: 0, count: 0 };
      toolRevenue[p.toolName].revenue += parseFloat(p.amountUsdc || "0");
      toolRevenue[p.toolName].count += 1;
    }

    const topTools = Object.entries(toolRevenue)
      .map(([tool, data]) => ({
        tool,
        revenue: Math.round(data.revenue * 1e6) / 1e6,
        count: data.count,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 20);

    res.json({
      ok: true,
      stats: {
        totalPayments,
        totalRevenueUsdc: Math.round(totalRevenue * 1e6) / 1e6,
        uniqueAgents,
        dailyRevenue,
        topTools,
      },
    });
  } catch (err) {
    console.error("[x402-payments] stats error:", err);
    res.status(500).json({ ok: false, error: "internal_error" });
  }
});

export default router;
