import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { sendFeatureAnnouncement } from "../services/email.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.get("/stats", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const todayDate = new Date(today);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [
      totalAgents,
      totalRequests,
      requestsToday,
      requestsLast7Days,
      requestsLast30Days,
      signupsToday,
      signupsLast7d,
      signupsLast30d,
      topTools,
      recentPurchases,
      x402Payments,
      creditsAgg,
      toolsActive,
    ] = await Promise.all([
      prisma.agent.count(),
      prisma.apiRequest.count(),
      prisma.apiRequest.count({ where: { createdAt: { gte: todayDate } } }),
      prisma.apiRequest.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.apiRequest.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.agent.count({ where: { createdAt: { gte: todayDate } } }),
      prisma.agent.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.agent.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),

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
      prisma.agent.aggregate({ _sum: { credits: true } }),
      prisma.tool.count({ where: { active: true } }),
    ]);

    // True all-time Stripe revenue (completed purchases), not just the last 10.
    const stripeAgg = await prisma.purchase.aggregate({
      where: { status: "completed" },
      _sum: { amountCents: true },
      _count: { _all: true },
    });
    const totalStripeRevenueCents = stripeAgg._sum.amountCents ?? 0;
    const totalStripePurchases = stripeAgg._count._all;
    // Preserve legacy "sample" field for back-compat; it's the sum of the last 10 only.
    const totalRevenueCents = recentPurchases.reduce((s, p) => s + p.amountCents, 0);

    // Daily requests for last 14 days
    const dailyRequests: Array<{ date: string; count: number }> = [];
    const dailySignups: Array<{ date: string; count: number }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      dailyRequests.push({ date: dateStr, count: 0 });
      dailySignups.push({ date: dateStr, count: 0 });
    }

    // Batch query for daily request counts
    const rawDailyReqs = await prisma.$queryRaw<Array<{ d: string; c: bigint }>>(
      Prisma.sql`SELECT DATE("createdAt") as d, COUNT(*)::bigint as c FROM "ApiRequest" WHERE "createdAt" >= ${fourteenDaysAgo} GROUP BY DATE("createdAt") ORDER BY d`
    );
    for (const row of rawDailyReqs) {
      const dateStr = typeof row.d === 'string' ? row.d : new Date(row.d as string).toISOString().slice(0, 10);
      const entry = dailyRequests.find(e => e.date === dateStr);
      if (entry) entry.count = Number(row.c);
    }

    const rawDailySignups = await prisma.$queryRaw<Array<{ d: string; c: bigint }>>(
      Prisma.sql`SELECT DATE("createdAt") as d, COUNT(*)::bigint as c FROM "Agent" WHERE "createdAt" >= ${fourteenDaysAgo} GROUP BY DATE("createdAt") ORDER BY d`
    );
    for (const row of rawDailySignups) {
      const dateStr = typeof row.d === 'string' ? row.d : new Date(row.d as string).toISOString().slice(0, 10);
      const entry = dailySignups.find(e => e.date === dateStr);
      if (entry) entry.count = Number(row.c);
    }

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

    // Merge duplicate caller_types (e.g. null callerType and literal "unknown" string
    // both surface as "unknown" — collapse them into a single bucket so the UI doesn't
    // render two rows for the same thing).
    const mergedCallerTypes = new Map<string, number>();
    for (const c of callerTypeBreakdown) {
      const key = c.callerType ?? "unknown";
      mergedCallerTypes.set(key, (mergedCallerTypes.get(key) ?? 0) + c._count.callerType);
    }
    const callerTypes = Array.from(mergedCallerTypes.entries())
      .map(([type, calls]) => ({ type, calls }))
      .sort((a, b) => b.calls - a.calls);

    // Trim daily series to dates <= today (UTC). The 14-day window can
    // straddle a UTC day boundary depending on when the loop runs.
    const todayUtc = new Date().toISOString().slice(0, 10);
    const trimSeries = (arr: Array<{ date: string; count: number }>) =>
      arr.filter(d => d.date <= todayUtc);

    res.json({
      ok: true,
      summary: {
        total_agents: totalAgents,
        total_requests: totalRequests,
        requests_today: requestsToday,
        requests_last_7d: requestsLast7Days,
        requests_last_30d: requestsLast30Days,
        signups_today: signupsToday,
        signups_last_7d: signupsLast7d,
        signups_last_30d: signupsLast30d,
        x402_payments: x402Payments,
        // Legacy field — sum of the *last 10* purchases only. Kept for back-compat;
        // do not use this for total revenue display. Use total_stripe_revenue_cents.
        revenue_sample_cents: totalRevenueCents,
        total_stripe_revenue_cents: totalStripeRevenueCents,
        total_stripe_purchases: totalStripePurchases,
        credits_in_circulation: creditsAgg._sum.credits ?? 0,
        tools_active: toolsActive,
      },
      daily_requests: trimSeries(dailyRequests),
      daily_signups: trimSeries(dailySignups),
      top_tools: topTools.map(t => ({ tool: t.toolName, calls: t._count.toolName })),
      caller_breakdown: callerBreakdown.map(c => ({ caller: c.callerName ?? "unknown", calls: c._count.callerName })),
      caller_types: callerTypes,
      recent_purchases: recentPurchases,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Admin stats error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// GET /v1/admin/agents — list all agents with usage stats
// ─── GET /v1/admin/traffic — real-vs-self go/no-go instrument ────────────────
// The audit's #1 discipline gap: 6 months live with no way to tell REAL external
// demand from our own testing/seeding. This separates them so investment decisions
// key off external signal, not self-traffic. Heuristic but honest, and labeled.
const SELF_EMAIL_PATTERNS = [
  /(^|[.+_-])cc\d/i,        // cc4… test accounts
  /verify[-.]/i,            // verify-… / verify.… throwaways
  /^test/i, /\+test/i,
  /@example\.(com|org)$/i,
  ...String(process.env.SELF_EMAIL_PATTERNS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => new RegExp(s, "i")),
];
const isSelfEmail = (email: string | null | undefined): boolean =>
  !!email && SELF_EMAIL_PATTERNS.some((re) => re.test(email));
// Caller fingerprints that indicate a REAL agent/client (vs a curl/script/unknown
// self-test). ApiRequest.callerName is set by the caller-detection middleware.
const REAL_CLIENT_NAMES = new Set(["claude-desktop", "claude", "cursor", "openai-sdk", "langchain", "windsurf", "cline", "vscode", "continue"]);

router.get("/traffic", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [agents, requests, purchases, x402] = await Promise.all([
      prisma.agent.findMany({ select: { email: true, createdAt: true } }),
      prisma.apiRequest.findMany({ select: { callerType: true, callerName: true, agentId: true, createdAt: true, status: true } }),
      prisma.purchase.findMany({ where: { status: "completed" }, select: { amountCents: true, createdAt: true } }),
      prisma.x402Payment.findMany({ where: { status: "settled" }, select: { amountUsdc: true, createdAt: true } }),
    ]);

    const externalAgents = agents.filter((a) => !isSelfEmail(a.email));

    // Tool calls: a call is "real" if the caller fingerprint names a known client
    // OR callerType is a genuine agent/sdk; script/unknown/null = likely self-test.
    const realCall = (r: { callerType: string | null; callerName: string | null }) =>
      (r.callerName != null && REAL_CLIENT_NAMES.has(r.callerName.toLowerCase())) ||
      (r.callerType != null && ["ai-agent", "sdk"].includes(r.callerType.toLowerCase()));
    const realCalls = requests.filter(realCall);

    const stripeRevenueUsd = purchases.reduce((s, p) => s + p.amountCents, 0) / 100;
    const x402TotalUsdc = x402.reduce((s, p) => s + (parseFloat(p.amountUsdc) || 0), 0);

    // Top real-client fingerprints (what's actually calling us)
    const byClient: Record<string, number> = {};
    for (const r of requests) { const k = r.callerName || r.callerType || "unknown"; byClient[k] = (byClient[k] || 0) + 1; }
    const topClients = Object.entries(byClient).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count }));

    const externalDemand = externalAgents.length > 0 || purchases.length > 0 || realCalls.length > 0;

    res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      note: "Heuristic separation of external demand from self-testing/seeding. Self = email matches a test pattern; real tool calls = a known client fingerprint or agent/sdk caller type. x402 payments do not store a payer address, so treat x402 counts as self-seeded until a non-self signup or paid conversion appears.",
      verdict: { external_demand: externalDemand, meaning: externalDemand ? "At least one non-self signup, paid conversion, or real-client tool call exists." : "No external demand detected yet — all traffic looks self-generated." },
      signups: { total: agents.length, external: externalAgents.length, self: agents.length - externalAgents.length },
      tool_calls: { total: requests.length, real_client: realCalls.length, self_or_unknown: requests.length - realCalls.length },
      stripe: { completed_purchases: purchases.length, revenue_usd: Number(stripeRevenueUsd.toFixed(2)) },
      x402: { settled_payments: x402.length, total_usdc: Number(x402TotalUsdc.toFixed(4)), note: "payer not stored; currently self-seeded" },
      top_caller_fingerprints: topClients,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "traffic_error", message: safeErr(e), request_id: reqId() });
  }
});

router.get("/agents", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 500);

    const agents = await prisma.agent.findMany({
      take: limit,
      orderBy: { lastSeenAt: { sort: "desc", nulls: "last" } },
      select: {
        id: true,
        email: true,
        credits: true,
        tier: true,
        totalCalls: true,
        lastSeenAt: true,
        createdAt: true,
      },
    });

    res.json({
      ok: true,
      agents: agents.map(a => ({
        id: a.id,
        email: a.email,
        credits: a.credits,
        tier: a.tier,
        totalCalls: a.totalCalls,
        lastActive: a.lastSeenAt,
        createdAt: a.createdAt,
      })),
      total: agents.length,
      request_id: reqId(),
    });
  } catch (e) {
    console.error("Admin agents error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// GET /v1/admin/lookup?email=... — look up agent key metadata by email (owner use only).
// Plaintext keys are no longer stored; only the prefix/masked form can ever be returned.
router.get("/lookup", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { email } = req.query as { email?: string };
  if (!email) { res.status(400).json({ ok: false, error: "email_required", request_id: reqId() }); return; }
  try {
    const agent = await prisma.agent.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        apiKeyPrefix: true,
        apiKeyHash: true,
        credits: true,
        createdAt: true,
      },
    });
    if (!agent) { res.status(404).json({ ok: false, error: "not_found", request_id: reqId() }); return; }
    res.json({
      ok: true,
      agent: {
        id: agent.id,
        email: agent.email,
        credits: agent.credits,
        createdAt: agent.createdAt,
        apiKeyPrefix: agent.apiKeyPrefix ?? null,
        apiKeyMasked: agent.apiKeyPrefix ? `${agent.apiKeyPrefix}…` : null,
        hasApiKey: Boolean(agent.apiKeyHash),
      },
      request_id: reqId(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
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
    // New tools (2026-03-18)
    { name: "ai-oracle",          description: "AI reasoning engine with standard and deep analysis modes",       category: "ai",      credits: 25 },
    { name: "session-create",     description: "Create a persistent AI conversation session",                     category: "ai",      credits: 5  },
    { name: "session-message",    description: "Send a message in an existing AI session",                        category: "ai",      credits: 10 },
    { name: "design-create",      description: "Generate designs and images via DALL-E 3",                        category: "media",   credits: 20 },
    { name: "image-remove-bg",    description: "Remove background from any image",                                category: "media",   credits: 350 },
    { name: "video-generate",     description: "Generate short video clips from text prompts",                    category: "media",   credits: 500 },
    { name: "email-find",         description: "Find email addresses for a person at a company domain",           category: "utility", credits: 5  },
    { name: "email-send",         description: "Send transactional emails via Resend",                            category: "utility", credits: 3  },
    { name: "domain-check",       description: "Check domain availability via RDAP",                              category: "network", credits: 2  },
    { name: "semantic-search",    description: "AI-powered semantic search across web content",                    category: "ai",      credits: 10 },
  ];

  // First, diagnose the actual Tool table structure
  let columns: unknown[] = [];
  try {
    columns = await prisma.$queryRaw(Prisma.sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = 'Tool'
      ORDER BY ordinal_position
    `);
  } catch (e) {
    columns = [{ error: String(e).slice(0, 200) }];
  }

  const results: Array<{ name: string; status: string }> = [];
  for (const t of tools) {
    try {
      const existing = await prisma.tool.findUnique({ where: { name: t.name } });
      if (existing) {
        // Ensure tool is active and enabled
        if (!existing.active) {
          await prisma.$executeRaw(Prisma.sql`UPDATE "Tool" SET active = true WHERE name = ${t.name}`);
          results.push({ name: t.name, status: "activated" });
        } else {
          results.push({ name: t.name, status: "already_exists" });
        }
      } else {
        // DB has extra NOT NULL columns not in Prisma schema — use raw SQL
        const id = Math.random().toString(36).slice(2, 27);
        const endpoint = `/v1/tools/${t.name}`;
        const now = new Date().toISOString();
        await prisma.$executeRaw(Prisma.sql`
          INSERT INTO "Tool" (id, name, description, endpoint, method, credits, category, active, "createdAt", "updatedAt", version)
          VALUES (${id}, ${t.name}, ${t.description}, ${endpoint}, 'POST', ${t.credits}, ${t.category}, true, ${now}::timestamp, ${now}::timestamp, '1.0.0')
        `);
        results.push({ name: t.name, status: "created" });
      }
    } catch (e) {
      results.push({ name: t.name, status: `error: ${String(e).slice(0, 300)}` });
    }
  }

  const total = await prisma.tool.count();
  res.json({ ok: true, columns, results, total, request_id: reqId() });
});

// ─── Grant credits to an agent (admin only) ─────────────────────────────────
router.post("/grant-credits", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { agent_id, credits } = req.body as { agent_id?: string; credits?: number };
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
  } catch (e) {
    res.status(404).json({ ok: false, error: "agent_not_found", detail: safeErr(e), request_id: reqId() });
  }
});

// ─── POST /v1/admin/email/broadcast — Send feature announcement to all users ─
router.post("/email/broadcast", requireAdmin, async (req: Request, res: Response): Promise<void> => {
  const { headline, body, cta_label, cta_url, dry_run } = req.body as {
    headline?: string;
    body?: string;
    cta_label?: string;
    cta_url?: string;
    dry_run?: boolean;
  };

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
      const results = await Promise.allSettled(
        batch.map(agent =>
          sendFeatureAnnouncement(agent.email, {
            headline,
            body,
            ctaLabel: cta_label,
            ctaUrl: cta_url,
          })
        )
      );

      for (const r of results) {
        if (r.status === "fulfilled" && r.value) sent++;
        else failed++;
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
  } catch (e) {
    logger.error({ error: e }, "Broadcast email error");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

export default router;
