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
  } catch (e) {
    console.error("Admin stats error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: String(e), request_id: reqId() });
  }
});

// POST /v1/admin/seed-tools — one-shot seed for missing tools
router.post("/seed-tools", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  const tools = [
    { name: "barcode-generate",   description: "Generate Code128 barcodes as SVG",                            category: "media",   credits: 2  },
    { name: "html-to-markdown",   description: "Convert HTML or any URL to clean Markdown",                   category: "text",    credits: 3  },
    { name: "image-generate",     description: "Generate SVG images from text prompts via Claude",             category: "ai",      credits: 15 },
    { name: "jsonpath-query",     description: "Run JSONPath expressions against any JSON payload",            category: "data",    credits: 1  },
    { name: "screenshot-capture", description: "Capture page metadata and screenshot URL for any public URL", category: "web",     credits: 10 },
    { name: "url-shorten",        description: "Shorten any URL via TinyURL",                                 category: "utility", credits: 1  },
    { name: "webhook-send",       description: "POST a JSON payload to any webhook URL",                      category: "utility", credits: 2  },
    { name: "workflow-agent",     description: "Multi-step autonomous AI agent pipeline",                     category: "ai",      credits: 25 },
    // Crypto tools
    { name: "crypto-price",       description: "Real-time price, 24h change, market cap for any cryptocurrency", category: "crypto",  credits: 1  },
    { name: "crypto-ohlcv",       description: "OHLCV candlestick data for any crypto over 1-90 days",           category: "crypto",  credits: 2  },
    { name: "crypto-market-cap",  description: "Top N cryptocurrencies by market cap with price and volume",      category: "crypto",  credits: 1  },
    { name: "crypto-fear-greed",  description: "Crypto Fear & Greed Index with historical data",                  category: "crypto",  credits: 1  },
    { name: "crypto-news",        description: "Latest crypto news headlines with source and sentiment",          category: "crypto",  credits: 2  },
    { name: "crypto-sentiment",   description: "Market sentiment analysis for any cryptocurrency",                category: "crypto",  credits: 3  },
    { name: "token-lookup",       description: "Look up any token by name, symbol, or contract address",         category: "crypto",  credits: 1  },
  ];

  const results: Array<{ name: string; status: string }> = [];
  for (const t of tools) {
    try {
      await prisma.tool.upsert({
        where: { name: t.name },
        update: { description: t.description, category: t.category, credits: t.credits, enabled: true },
        create: { ...t, enabled: true },
      });
      results.push({ name: t.name, status: "ok" });
    } catch (e) {
      results.push({ name: t.name, status: `error: ${String(e).slice(0, 100)}` });
    }
  }

  const total = await prisma.tool.count();
  res.json({ ok: true, results, total, request_id: reqId() });
});

export default router;
