import { Router } from "express";
import { prisma } from "../db.js";
import { runDailyRollup } from "../cron/dailyRollup.js";
import { runPartitionMaintenance } from "../cron/monthlyPartitions.js";
import { isApiRequestLogPartitioned, listApiRequestLogPartitions } from "../lib/partitioning.js";
import { requireAdminAuth, requireScope, generateAdminKey, sha256Hex, normalizeScopes, isValidScope } from "../lib/adminAuth.js";

export const adminRouter = Router();

// All admin endpoints require auth. Scope checks are applied per-route.
adminRouter.use(requireAdminAuth());

/**
 * GET /v1/admin/whoami
 */
adminRouter.get("/v1/admin/whoami", (req: any, res: any) => {
  const ctx = req.admin;
  return res.json({ ok: true, admin: ctx });
});



/**
 * GET /v1/admin/request-logs
 * Query:
 *  - limit (1..200, default 50)
 *  - cursor (base64: createdAtISO|id)
 *  - agentId, apiKeyId, toolName
 *  - status (exact)
 *  - since (ISO date)
 */
adminRouter.get("/v1/admin/request-logs", requireScope("logs:read"), async (req: any, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);

  const agentId = req.query.agentId ? String(req.query.agentId) : undefined;
  const apiKeyId = req.query.apiKeyId ? String(req.query.apiKeyId) : undefined;
  const toolName = req.query.toolName ? String(req.query.toolName).toLowerCase() : undefined;
  const status = req.query.status ? Number(req.query.status) : undefined;

  const since = req.query.since ? new Date(String(req.query.since)) : undefined;

  let cursorCreatedAt: Date | undefined;
  let cursorId: string | undefined;

  const cursor = req.query.cursor ? String(req.query.cursor) : "";
  if (cursor) {
    try {
      const decoded = Buffer.from(cursor, "base64").toString("utf8");
      const [createdAtIso, id] = decoded.split("|");
      if (createdAtIso && id) {
        cursorCreatedAt = new Date(createdAtIso);
        cursorId = id;
      }
    } catch {
      // ignore invalid cursor
    }
  }

  const where: any = {};
  if (agentId) where.agentId = agentId;
  if (apiKeyId) where.apiKeyId = apiKeyId;
  if (toolName) where.toolName = toolName;
  if (Number.isFinite(status)) where.status = status;
  if (since) where.createdAt = { gte: since };

  // cursor pagination (createdAt desc, id desc)
  if (cursorCreatedAt && cursorId) {
    where.AND = [
      ...(where.AND || []),
      {
        OR: [
          { createdAt: { lt: cursorCreatedAt } },
          { AND: [{ createdAt: cursorCreatedAt }, { id: { lt: cursorId } }] },
        ],
      },
    ];
  }

  const rows = await prisma.apiRequestLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const logs = hasMore ? rows.slice(0, limit) : rows;

  const nextCursor = hasMore
    ? Buffer.from(`${logs[logs.length - 1].createdAt.toISOString()}|${logs[logs.length - 1].id}`, "utf8").toString("base64")
    : null;

  res.json({ ok: true, logs, next_cursor: nextCursor });
});

/**
 * GET /v1/admin/stats?hours=24
 * Quick rollup for dashboards.
 */
adminRouter.get("/v1/admin/stats", requireScope("system:read"), async (req: any, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 720);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const total = await prisma.apiRequestLog.count({ where: { createdAt: { gte: since } } });
  const byStatus = await prisma.apiRequestLog.groupBy({
    by: ["status"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { status: "asc" },
  });

  const topTools = await prisma.apiRequestLog.groupBy({
    by: ["toolName"],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    orderBy: { _count: "desc" },
    take: 12,
  });

  const credits = await prisma.apiRequestLog.aggregate({
    where: { createdAt: { gte: since } },
    _sum: { creditsUsed: true },
  });

  res.json({
    ok: true,
    window_hours: hours,
    since: since.toISOString(),
    total_requests: total,
    status_counts: byStatus.map((x) => ({ status: x.status ?? null, count: (x._count! as any) })),
    top_tools: topTools.map((x) => ({ tool: x.toolName ?? null, count: (x._count! as any) })),
    credits_used_sum: credits._sum.creditsUsed ?? 0,
  });
});



/**
 * GET /v1/admin/billing-report?days=7&groupBy=agent|apiKey|tool
 * Aggregates request volume, errors, and credits used.
 */
adminRouter.get("/v1/admin/billing-report", requireScope("billing:read"), async (req: any, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const groupBy = String(req.query.groupBy || "agent");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byField =
    groupBy === "apikey" || groupBy === "apiKey" ? "apiKeyId" :
    groupBy === "tool" ? "toolName" :
    "agentId";

  const useRollups = String(process.env.USE_ROLLUPS_FOR_BILLING || "true").toLowerCase() !== "false" && days >= 3;

  if (useRollups) {
    // Rollup query is day-based; truncate to UTC day for the lower bound.
    const sinceDay = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));

    const rows: Array<any> = await prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE("${byField}", '') AS key,
        SUM("requestCount")::int AS requests,
        SUM("errorCount")::int AS error_count,
        SUM("creditsUsedSum")::int AS credits_used,
        CASE
          WHEN SUM("requestCount") > 0
          THEN ROUND(SUM(("latencyAvgMs"::bigint) * ("requestCount"::bigint))::numeric / SUM("requestCount")::numeric)::int
          ELSE 0
        END AS avg_latency_ms
      FROM "DailyUsageRollup"
      WHERE "day" >= $1
      GROUP BY COALESCE("${byField}", '')
      ORDER BY requests DESC
      LIMIT 200
      `,
      sinceDay
    );

    const out = rows.map((r: any) => {
      const requests = Number(r.requests || 0);
      const errorCount = Number(r.error_count || 0);
      const errorRate = requests ? Number((errorCount / requests).toFixed(4)) : 0;
      return {
        key: String(r.key || "(unknown)") || "(unknown)",
        requests,
        error_count: errorCount,
        error_rate: errorRate,
        credits_used: Number(r.credits_used || 0),
        avg_latency_ms: Number(r.avg_latency_ms || 0),
      };
    });

    return res.json({
      ok: true,
      window_days: days,
      since: sinceDay.toISOString(),
      group_by: byField,
      source: "rollups",
      rows: out,
    });
  }

  // Fallback: raw logs (more accurate for tiny windows, slower at scale)
  const totals = await prisma.apiRequestLog.groupBy({
    by: [byField as any],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _sum: { creditsUsed: true, latencyMs: true },
    orderBy: { _count: "desc" },
    take: 200,
  });

  const errors = await prisma.apiRequestLog.groupBy({
    by: [byField as any],
    where: { createdAt: { gte: since }, status: { gte: 400 } },
    _count: { _all: true },
    orderBy: { _count: "desc" },
    take: 200,
  });

  const errMap = new Map<string, number>();
  for (const e of errors) {
    const k = String((e as any)[byField] ?? "");
    errMap.set(k, (e._count! as any));
  }

  const rows = totals.map((t: any) => {
    const key = String(t[byField] ?? "");
    const requests = (t._count! as any) || 0;
    const errorCount = errMap.get(key) || 0;
    const credits = t._sum?.creditsUsed ?? 0;
    const latencySum = t._sum?.latencyMs ?? 0;
    const avgLatencyMs = requests ? Math.round(latencySum / requests) : 0;
    const errorRate = requests ? Number((errorCount / requests).toFixed(4)) : 0;
    return {
      key: key || "(unknown)",
      requests,
      error_count: errorCount,
      error_rate: errorRate,
      credits_used: credits,
      avg_latency_ms: avgLatencyMs,
    };
  });

  res.json({
    ok: true,
    window_days: days,
    since: since.toISOString(),
    group_by: byField,
    source: "raw",
    rows,
  });
});

/**
 * GET /v1/admin/billing-report.csv?days=7&groupBy=agent|apiKey|tool
 * CSV export for spreadsheets.
 */
adminRouter.get("/v1/admin/billing-report.csv", requireScope("billing:read"), async (req: any, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const groupBy = String(req.query.groupBy || "agent");
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const byField =
    groupBy === "apikey" || groupBy === "apiKey" ? "apiKeyId" :
    groupBy === "tool" ? "toolName" :
    "agentId";

  const useRollups = String(process.env.USE_ROLLUPS_FOR_BILLING || "true").toLowerCase() !== "false" && days >= 3;

  let rows: Array<any> = [];

  if (useRollups) {
    const sinceDay = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
    rows = await prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE("${byField}", '') AS key,
        SUM("requestCount")::int AS requests,
        SUM("errorCount")::int AS error_count,
        SUM("creditsUsedSum")::int AS credits_used,
        CASE
          WHEN SUM("requestCount") > 0
          THEN ROUND(SUM(("latencyAvgMs"::bigint) * ("requestCount"::bigint))::numeric / SUM("requestCount")::numeric)::int
          ELSE 0
        END AS avg_latency_ms
      FROM "DailyUsageRollup"
      WHERE "day" >= $1
      GROUP BY COALESCE("${byField}", '')
      ORDER BY requests DESC
      LIMIT 200
      `,
      sinceDay
    );
  } else {
    // raw logs
    const totals = await prisma.apiRequestLog.groupBy({
      by: [byField as any],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { creditsUsed: true, latencyMs: true },
      orderBy: { _count: "desc" },
      take: 200,
    });

    const errors = await prisma.apiRequestLog.groupBy({
      by: [byField as any],
      where: { createdAt: { gte: since }, status: { gte: 400 } },
      _count: { _all: true },
      orderBy: { _count: "desc" },
      take: 200,
    });

    const errMap = new Map<string, number>();
    for (const e of errors) {
      const k = String((e as any)[byField] ?? "");
      errMap.set(k, (e._count! as any));
    }

    rows = totals.map((t: any) => {
      const key = String(t[byField] ?? "");
      const requests = (t._count! as any) || 0;
      const errorCount = errMap.get(key) || 0;
      const credits = t._sum?.creditsUsed ?? 0;
      const latencySum = t._sum?.latencyMs ?? 0;
      const avgLatencyMs = requests ? Math.round(latencySum / requests) : 0;
      return {
        key,
        requests,
        error_count: errorCount,
        credits_used: credits,
        avg_latency_ms: avgLatencyMs,
      };
    });
  }

  // CSV response
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="billing-report-${days}d-${byField}.csv"`);

  const header = "key,requests,error_count,error_rate,credits_used,avg_latency_ms\n";
  const lines = rows.map((r: any) => {
    const key = String(r.key || "(unknown)").replace(/"/g, '""');
    const requests = Number(r.requests || 0);
    const errorCount = Number(r.error_count || 0);
    const errorRate = requests ? (errorCount / requests) : 0;
    const creditsUsed = Number(r.credits_used || 0);
    const avgLatencyMs = Number(r.avg_latency_ms || 0);
    return `"${key}",${requests},${errorCount},${errorRate.toFixed(4)},${creditsUsed},${avgLatencyMs}`;
  });

  res.send(header + lines.join("\n") + "\n");
});

/**
 * GET /v1/admin/fraud-signals?hours=24
 * Heuristic signals: error spikes, high 429/401 rates, noisy IPs, failing tools.
 */
adminRouter.get("/v1/admin/fraud-signals", requireScope("fraud:read"), async (req: any, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 720);
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Top failing tools
  const failingTools = await prisma.apiRequestLog.groupBy({
    by: ["toolName"],
    where: { createdAt: { gte: since }, status: { gte: 400 } },
    _count: { _all: true },
    orderBy: { _count: "desc" },
    take: 12,
  });

  // Top noisy IPs (errors)
  const noisyIps = await prisma.apiRequestLog.groupBy({
    by: ["ip"],
    where: { createdAt: { gte: since }, status: { gte: 400 }, ip: { not: null } },
    _count: { _all: true },
    orderBy: { _count: "desc" },
    take: 12,
  });

  // 429 offenders (rate limit)
  const offenders429 = await prisma.apiRequestLog.groupBy({
    by: ["agentId"],
    where: { createdAt: { gte: since }, status: 429, agentId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: "desc" },
    take: 12,
  });

  // 401/403 offenders (bad keys)
  const offendersAuth = await prisma.apiRequestLog.groupBy({
    by: ["apiKeyPrefix"],
    where: { createdAt: { gte: since }, status: { in: [401, 403] }, apiKeyPrefix: { not: null } },
    _count: { _all: true },
    orderBy: { _count: "desc" },
    take: 12,
  });

  // Error-rate by agent (min volume)
  const totalsByAgent = await prisma.apiRequestLog.groupBy({
    by: ["agentId"],
    where: { createdAt: { gte: since }, agentId: { not: null } },
    _count: { _all: true },
    orderBy: { _count: "desc" },
    take: 200,
  });

  const errorsByAgent = await prisma.apiRequestLog.groupBy({
    by: ["agentId"],
    where: { createdAt: { gte: since }, agentId: { not: null }, status: { gte: 400 } },
    _count: { _all: true },
    orderBy: { _count: "desc" },
    take: 200,
  });

  const errMap = new Map<string, number>();
  for (const e of errorsByAgent) errMap.set(String(e.agentId), (e._count! as any));

  const highErrorAgents = totalsByAgent
    .map((t) => {
      const total = (t._count! as any) || 0;
      const err = errMap.get(String(t.agentId)) || 0;
      const rate = total ? err / total : 0;
      return { agentId: t.agentId, requests: total, error_count: err, error_rate: Number(rate.toFixed(4)) };
    })
    .filter((x) => (x.requests >= 25 && x.error_rate >= 0.25))
    .sort((a, b) => b.error_rate - a.error_rate)
    .slice(0, 12);

  // Spike detection: last hour vs previous hour (aggregate)
  const now = Date.now();
  const lastHourStart = new Date(now - 60 * 60 * 1000);
  const prevHourStart = new Date(now - 2 * 60 * 60 * 1000);

  const lastHour = await prisma.apiRequestLog.count({ where: { createdAt: { gte: lastHourStart } } });
  const prevHour = await prisma.apiRequestLog.count({ where: { createdAt: { gte: prevHourStart, lt: lastHourStart } } });

  const spikeRatio = prevHour > 0 ? Number((lastHour / prevHour).toFixed(2)) : null;

  res.json({
    ok: true,
    window_hours: hours,
    since: since.toISOString(),
    traffic_spike: {
      last_hour_requests: lastHour,
      prev_hour_requests: prevHour,
      ratio: spikeRatio,
      note: "ratio > 2.0 can indicate sudden traffic spikes",
    },
    failing_tools: failingTools.map((x) => ({ tool: x.toolName ?? "(unknown)", error_count: (x._count! as any) })),
    noisy_ips: noisyIps.map((x) => ({ ip: x.ip, error_count: (x._count! as any) })),
    offenders_429: offenders429.map((x) => ({ agentId: x.agentId, count: (x._count! as any) })),
    offenders_auth: offendersAuth.map((x) => ({ apiKeyPrefix: x.apiKeyPrefix, count: (x._count! as any) })),
    high_error_agents: highErrorAgents,
  });
});

/**
 * POST /v1/admin/rollup/run
 * Body: { daysBack?: number }
 * Triggers the daily rollup + retention logic on-demand.
 * Useful right after deploy or during incident response.
 */
adminRouter.post("/v1/admin/rollup/run", requireScope("ops:write"), async (req: any, res) => {
  const daysBackRaw = req.body?.daysBack ?? req.query?.daysBack;
  const daysBack = Math.min(Math.max(Number(daysBackRaw) || 3, 1), 30);

  try {
    const out = await runDailyRollup({ daysBack });
    res.json({ ok: true, ...out, triggered_by: "admin" });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "rollup_failed", message: String(err?.message || err) });
  }
});


/**
 * GET /v1/admin/partitions/status
 * Returns whether partitioning is enabled, whether ApiRequestLog is partitioned, and a list of partitions.
 */
adminRouter.get("/v1/admin/partitions/status", requireScope("system:read"), async (_req: any, res) => {
  const enabled = String(process.env.ENABLE_PARTITIONING || "").toLowerCase() === "true";
  const partitioned = await isApiRequestLogPartitioned();
  const partitions = partitioned ? await listApiRequestLogPartitions() : [];
  res.json({
    ok: true,
    enabled,
    partitioned,
    partition_count: partitions.length,
    partitions: partitions.slice(-36), // cap payload
  });
});

/**
 * GET /v1/admin/system/status
 * Operational status: last job runs, partitioning config, and rough row counts.
 */
adminRouter.get("/v1/admin/system/status", requireScope("system:read"), async (_req: any, res) => {
  const enabled = String(process.env.ENABLE_PARTITIONING || "").toLowerCase() === "true";
  const partitioned = await isApiRequestLogPartitioned();
  const jobs = await prisma.systemJobRun.findMany({ orderBy: { updatedAt: "desc" }, take: 20 });

  // cheap counts
  const [logCount, rollupCount] = await Promise.all([
    prisma.apiRequestLog.count(),
    prisma.dailyUsageRollup.count(),
  ]);

  res.json({
    ok: true,
    partitioning: { enabled, partitioned },
    counts: { api_request_logs: logCount, daily_rollups: rollupCount },
    jobs,
  });
});

/**
 * POST /v1/admin/partitions/ensure
 * Body: { monthsAhead?: number }
 * Ensures monthly partitions exist (if ENABLE_PARTITIONING=true and ApiRequestLog is partitioned),
 * and enforces retention by dropping old partitions.
 */
adminRouter.post("/v1/admin/partitions/ensure", requireScope("ops:write"), async (req: any, res) => {
  const monthsAheadRaw = req.body?.monthsAhead ?? req.query?.monthsAhead;
  const monthsAhead = Math.min(Math.max(Number(monthsAheadRaw) || Number(process.env.PARTITION_PRECREATE_MONTHS) || 2, 0), 12);

  try {
    // Temporarily override months ahead for this run (without mutating process.env permanently)
    const prev = process.env.PARTITION_PRECREATE_MONTHS;
    process.env.PARTITION_PRECREATE_MONTHS = String(monthsAhead);

    const result = await runPartitionMaintenance();

    if (prev === undefined) delete process.env.PARTITION_PRECREATE_MONTHS;
    else process.env.PARTITION_PRECREATE_MONTHS = prev;

    return res.json({ ok: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ ok: false, error: err?.message || String(err) });
  }
});


/**
 * Admin API Keys (DB-backed). These require admin scopes.
 * - GET /v1/admin/keys  (admin:read)
 * - POST /v1/admin/keys (admin:write) { name, scopes }
 * - POST /v1/admin/keys/:id/revoke (admin:write)
 *
 * Note: If you use ADMIN_API_KEY (env-super) or ADMIN_KEYS_JSON (env-list), these are optional.
 */
adminRouter.get("/v1/admin/keys", requireScope("admin:read"), async (req: any, res: any) => {
  const keys = await prisma.adminApiKey.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, keyPrefix: true, scopes: true, isActive: true, lastUsedAt: true, createdAt: true, updatedAt: true },
  });
  return res.json({ ok: true, keys });
});

adminRouter.post("/v1/admin/keys", requireScope("admin:write"), async (req: any, res: any) => {
  const name = String(req.body?.name || "admin").trim() || "admin";
  const scopesIn = Array.isArray(req.body?.scopes) ? req.body.scopes.map(String) : [];
  const scopes = normalizeScopes(scopesIn.filter(isValidScope));
  const finalScopes = scopes.length ? scopes : ["system:read"];

  const key = generateAdminKey();
  const hash = sha256Hex(key);
  const pref = hash.slice(0, 10);

  const row = await prisma.adminApiKey.create({
    data: { name, keyPrefix: pref, keyHash: hash, scopes: finalScopes, isActive: true },
    select: { id: true, name: true, keyPrefix: true, scopes: true, isActive: true, createdAt: true },
  });

  // Return the plaintext key ONE TIME.
  return res.status(201).json({ ok: true, key: { ...row, plaintext: key } });
});

adminRouter.post("/v1/admin/keys/:id/revoke", requireScope("admin:write"), async (req: any, res: any) => {
  const id = String(req.params.id || "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "bad_request" });
  const row = await prisma.adminApiKey.update({ where: { id }, data: { isActive: false } });
  return res.json({ ok: true, revoked: { id: row.id, isActive: row.isActive } });
});
