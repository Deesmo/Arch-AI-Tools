# Postgres partitioning (optional, for very high volume)

Arch Tools works without table partitioning.

If you expect **millions+** of `ApiRequestLog` rows, Postgres declarative partitioning can keep queries fast and retention deletes cheap.

## Strategy
- Partition `ApiRequestLog` by **createdAt** (monthly partitions recommended).
- Keep the same indexes on each partition.
- Retention becomes: `DROP TABLE ApiRequestLog_2026_03;` instead of `DELETE ...`.

## How to use
1. Apply normal Prisma migrations as usual.
2. If you want partitioning, run the SQL in `postgres_partitioning.sql` once (as a DBA/admin).
3. Then set `LOG_RETENTION_DAYS` normally (cron will still delete; if you switch to partition drops, you can disable deletion in code).

Notes:
- Prisma does not manage partitions automatically. This is an **ops-only** optimization.
- If you already have data, you can migrate into the partitioned structure (script provided).


## Automation (recommended)

- Set `ENABLE_PARTITIONING=true`
- Add `PARTITION_PRECREATE_MONTHS=2`
- Run monthly:
  - `npm run partitions-ensure`
  - Recommended schedule: `30 0 1 * *` (00:30 UTC on the 1st)

When partitioning is enabled, retention can be enforced by **dropping old partitions** (fast) instead of deleting rows.
