import { prisma } from "../db.js";

/**
 * Partitioning helpers for ApiRequestLog (Postgres only).
 *
 * If ApiRequestLog is converted to a partitioned table (see prisma/partitioning/postgres_partitioning.sql),
 * we can:
 *  - pre-create monthly partitions
 *  - enforce retention by dropping old partitions (fast) instead of DELETEs (slow)
 */

type PartitionInfo = {
  name: string;
  from: Date | null;
  to: Date | null;
};

function ymName(d: Date) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}_${m}`;
}

function monthStartUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addMonthsUTC(d: Date, months: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

export async function isApiRequestLogPartitioned(): Promise<boolean> {
  const rows: any = await prisma.$queryRawUnsafe(`
    SELECT EXISTS (
      SELECT 1
      FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'ApiRequestLog' AND n.nspname = current_schema()
    ) AS partitioned;
  `);
  return Boolean(rows?.[0]?.partitioned);
}

export async function listApiRequestLogPartitions(): Promise<PartitionInfo[]> {
  const rows: any[] = await prisma.$queryRawUnsafe(`
    SELECT
      child.relname AS name,
      pg_get_expr(child.relpartbound, child.oid) AS bound
    FROM pg_inherits
    JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
    JOIN pg_class child ON pg_inherits.inhrelid = child.oid
    JOIN pg_namespace nsp ON nsp.oid = parent.relnamespace
    WHERE parent.relname = 'ApiRequestLog' AND nsp.nspname = current_schema()
    ORDER BY child.relname;
  `);

  return (rows || []).map((r) => {
    const bound = String(r.bound || "");
    // Example: FOR VALUES FROM ('2026-03-01 00:00:00') TO ('2026-04-01 00:00:00')
    const m = bound.match(/FROM \('([^']+)'\) TO \('([^']+)'\)/i);
    const from = m?.[1] ? new Date(m[1]) : null;
    const to = m?.[2] ? new Date(m[2]) : null;
    return { name: String(r.name), from, to };
  });
}

export async function ensureMonthlyPartitions(monthsAhead = 2) {
  const enabled = String(process.env.ENABLE_PARTITIONING || "").toLowerCase() === "true";
  if (!enabled) return { enabled: false, created: 0, monthsAhead };

  const partitioned = await isApiRequestLogPartitioned();
  if (!partitioned) {
    return { enabled: true, partitioned: false, created: 0, monthsAhead };
  }

  const base = monthStartUTC(new Date());
  const targets = [];
  for (let i = 0; i <= monthsAhead; i++) targets.push(addMonthsUTC(base, i));

  let created = 0;

  for (const start of targets) {
    const end = addMonthsUTC(start, 1);
    const table = `ApiRequestLog_${ymName(start)}`;

    // Create partition
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "${table}" PARTITION OF "ApiRequestLog"
      FOR VALUES FROM ('${start.toISOString().slice(0, 10)}') TO ('${end.toISOString().slice(0, 10)}');
    `);

    // Per-partition indexes (safe to re-run)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${table}_createdAt_idx" ON "${table}"("createdAt");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${table}_agentId_createdAt_idx" ON "${table}"("agentId","createdAt");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${table}_apiKeyId_createdAt_idx" ON "${table}"("apiKeyId","createdAt");`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${table}_toolName_createdAt_idx" ON "${table}"("toolName","createdAt");`);

    created += 1;
  }

  return { enabled: true, partitioned: true, created, monthsAhead };
}

export async function dropOldApiRequestLogPartitions(cutoff: Date) {
  const enabled = String(process.env.ENABLE_PARTITIONING || "").toLowerCase() === "true";
  if (!enabled) return { enabled: false, dropped: 0 };

  const partitioned = await isApiRequestLogPartitioned();
  if (!partitioned) return { enabled: true, partitioned: false, dropped: 0 };

  const parts = await listApiRequestLogPartitions();
  const toDrop = parts.filter((p) => p.to && p.to.getTime() < cutoff.getTime());

  let dropped = 0;
  for (const p of toDrop) {
    // Safety: only drop tables that match our naming convention
    if (!/^ApiRequestLog_\d{4}_\d{2}$/.test(p.name)) continue;
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${p.name}" CASCADE;`);
    dropped += 1;
  }

  return { enabled: true, partitioned: true, dropped };
}
