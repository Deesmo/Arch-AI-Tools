/**
 * Daily Usage Rollups + Retention
 *
 * Produces daily aggregates from ApiRequestLog into DailyUsageRollup for fast billing reports.
 * Also enforces retention:
 *   - Raw logs: LOG_RETENTION_DAYS (default 30)
 *   - Rollups: ROLLUP_RETENTION_DAYS (default 365)
 *
 * Intended to run as a Render Cron Job:
 *   Schedule: 20 0 * * *   (daily at 00:20 UTC)
 *   Command: npm run rollup-daily
 *
 * Safe to run multiple times — upserts by (day, agentId, apiKeyId, toolName).
 */
import "dotenv/config";
import { prisma } from "../db.js";
import { dropOldApiRequestLogPartitions, isApiRequestLogPartitioned } from "../lib/partitioning.js";
import { recordJobRun } from "../lib/systemJobs.js";

function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUTC(d: Date, days: number) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

export async function rollupDay(dayStart: Date) {
  const dayEnd = addDaysUTC(dayStart, 1);

  // Aggregate raw logs into groups (agentId/apiKeyId/toolName)
  const rows: Array<{
    agentId: string | null;
    apiKeyId: string | null;
    toolName: string | null;
    requestCount: number;
    successCount: number;
    errorCount: number;
    creditsUsedSum: number;
    latencyAvgMs: number;
    latencyMaxMs: number;
  }> = await prisma.$queryRaw`
    SELECT
      "agentId",
      "apiKeyId",
      "toolName",
      COUNT(*)::int AS "requestCount",
      SUM(CASE WHEN COALESCE("status", 0) > 0 AND "status" < 400 THEN 1 ELSE 0 END)::int AS "successCount",
      SUM(CASE WHEN COALESCE("status", 0) >= 400 THEN 1 ELSE 0 END)::int AS "errorCount",
      COALESCE(SUM(COALESCE("creditsUsed", 0)), 0)::int AS "creditsUsedSum",
      COALESCE(AVG(COALESCE("latencyMs", 0)), 0)::int AS "latencyAvgMs",
      COALESCE(MAX(COALESCE("latencyMs", 0)), 0)::int AS "latencyMaxMs"
    FROM "ApiRequestLog"
    WHERE "createdAt" >= ${dayStart} AND "createdAt" < ${dayEnd}
    GROUP BY "agentId", "apiKeyId", "toolName"
  `;

  for (const r of rows) {
    await prisma.dailyUsageRollup.upsert({
      where: {
        day_agentId_apiKeyId_toolName: {
          day: dayStart,
          agentId: r.agentId ?? undefined,
          apiKeyId: r.apiKeyId ?? undefined,
          toolName: r.toolName ?? undefined,
        },
      },
      create: {
        day: dayStart,
        agentId: r.agentId ?? null,
        apiKeyId: r.apiKeyId ?? null,
        toolName: r.toolName ?? null,
        requestCount: r.requestCount,
        successCount: r.successCount,
        errorCount: r.errorCount,
        creditsUsedSum: r.creditsUsedSum,
        latencyAvgMs: r.latencyAvgMs,
        latencyMaxMs: r.latencyMaxMs,
      },
      update: {
        requestCount: r.requestCount,
        successCount: r.successCount,
        errorCount: r.errorCount,
        creditsUsedSum: r.creditsUsedSum,
        latencyAvgMs: r.latencyAvgMs,
        latencyMaxMs: r.latencyMaxMs,
      },
    });
  }

  return { groups: rows.length, dayStart, dayEnd };
}

export async function enforceRetention() {
  const logDays = Math.min(Math.max(Number(process.env.LOG_RETENTION_DAYS) || 30, 1), 3650);
  const rollupDays = Math.min(Math.max(Number(process.env.ROLLUP_RETENTION_DAYS) || 365, 7), 3650);

  const logCutoff = new Date(Date.now() - logDays * 24 * 60 * 60 * 1000);
  const rollupCutoff = startOfDayUTC(new Date(Date.now() - rollupDays * 24 * 60 * 60 * 1000));

  // If partitioning is enabled and ApiRequestLog is partitioned, dropping old partitions is much faster than DELETEs.
  const partitioningEnabled = String(process.env.ENABLE_PARTITIONING || "").toLowerCase() === "true";
  let droppedPartitions: any = null;

  if (partitioningEnabled) {
    const partitioned = await isApiRequestLogPartitioned();
    if (partitioned) {
      droppedPartitions = await dropOldApiRequestLogPartitions(logCutoff);
    }
  }

  // If we did not drop partitions (not enabled / not partitioned), fall back to deleting rows.
  const delLogs = (!droppedPartitions || droppedPartitions?.partitioned === false)
    ? await prisma.apiRequestLog.deleteMany({ where: { createdAt: { lt: logCutoff } } })
    : { count: 0 };

  const delRollups = await prisma.dailyUsageRollup.deleteMany({ where: { day: { lt: rollupCutoff } } });

  return {
    logDays,
    rollupDays,
    logCutoff,
    rollupCutoff,
    deletedLogs: delLogs.count,
    deletedRollups: delRollups.count,
    droppedPartitions,
  };
}

/**
 * Programmatic entrypoint for admin-triggered or cron-triggered rollups.
 * Rolls up a backfill window of days ending at today (UTC start-of-day).
 */
export async function runDailyRollup(opts?: { daysBack?: number }) {
  const daysBack = Math.min(Math.max(Number(opts?.daysBack ?? process.env.ROLLUP_DAYS_BACK ?? 3) || 3, 1), 30);

  const today = startOfDayUTC(new Date());
  const firstDay = addDaysUTC(today, -daysBack);

  const rolled: any[] = [];
  for (let i = 0; i < daysBack; i++) {
    const day = addDaysUTC(firstDay, i);
    rolled.push(await rollupDay(day));
  }

  const retention = await enforceRetention();
  return { ok: true, daysBack, rolled_up: rolled, retention };
}

async function main() {
  const start = Date.now();
  const out = await runDailyRollup();
  await recordJobRun({ jobName: "daily_rollup", status: "ok", durationMs: Date.now() - start, meta: out });
  console.log(JSON.stringify(out, null, 2));
}

main()
  .catch(async (err) => {
    try { await recordJobRun({ jobName: "daily_rollup", status: "error", message: String((err as any)?.message || err) }); } catch {}

    console.error("dailyRollup failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
