// @ts-nocheck
/**
 * Monthly Partition Maintenance (Postgres partitioning optional)
 *
 * If ENABLE_PARTITIONING=true and ApiRequestLog is a partitioned table,
 * this job will:
 *  - Ensure current + next N monthly partitions exist (PARTITION_PRECREATE_MONTHS, default 2)
 *  - Optionally enforce retention by dropping partitions older than LOG_RETENTION_DAYS
 *
 * Intended to run as a Render Cron Job:
 *   Schedule: 30 0 1 * *   (monthly at 00:30 UTC on the 1st)
 *   Command: npm run partitions-ensure
 */
import "dotenv/config";
import { ensureMonthlyPartitions, dropOldApiRequestLogPartitions } from "../lib/partitioning.js";
import { prisma } from "../db.js";
import { recordJobRun } from "../lib/systemJobs.js";

export async function runPartitionMaintenance() {
  const monthsAhead = Math.min(Math.max(Number(process.env.PARTITION_PRECREATE_MONTHS) || 2, 0), 12);
  const logDays = Math.min(Math.max(Number(process.env.LOG_RETENTION_DAYS) || 30, 1), 3650);

  const ensured = await ensureMonthlyPartitions(monthsAhead);

  const cutoff = new Date(Date.now() - logDays * 24 * 60 * 60 * 1000);
  const dropped = await dropOldApiRequestLogPartitions(cutoff);

  return { ensured, dropped, logDays, monthsAhead };
}

async function main() {
  const start = Date.now();
  try {
    const res = await runPartitionMaintenance();
    await recordJobRun({ jobName: "monthly_partitions", status: "ok", durationMs: Date.now() - start, meta: res });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ok: true, ...res }, null, 2));
    await prisma.$disconnect();
    process.exit(0);
  } catch (err: any) {
    try { await recordJobRun({ jobName: "monthly_partitions", status: "error", message: String(err?.message || err) }); } catch {}

    // eslint-disable-next-line no-console
    console.error("partition-maintenance failed:", err?.message || err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

// Only run when invoked directly (not when imported by admin.ts / index.ts)
const isDirectRun = process.argv[1]?.replace(/\\/g, "/").includes("monthlyPartitions");
if (isDirectRun) {
  main();
}
