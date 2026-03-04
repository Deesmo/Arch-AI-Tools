-- Optional: Convert ApiRequestLog into a partitioned table (Postgres only).
-- Use ONLY if you expect very high volume and want fast retention.

-- 0) Safety: run in a transaction and on a staging DB first.

-- 1) Rename the existing table (keeps data)
ALTER TABLE IF EXISTS "ApiRequestLog" RENAME TO "ApiRequestLog_unpartitioned";

-- 2) Recreate ApiRequestLog as a partitioned table
CREATE TABLE IF NOT EXISTS "ApiRequestLog" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "agentId" TEXT,
  "apiKeyId" TEXT,
  "apiKeyPrefix" TEXT,
  "toolName" TEXT,
  "endpoint" TEXT,
  "method" TEXT,
  "status" INTEGER,
  "latencyMs" INTEGER,
  "creditsUsed" INTEGER,
  "creditsRemaining" INTEGER,
  "requestId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT
) PARTITION BY RANGE ("createdAt");

-- 3) Create the first partition (example: March 2026). Repeat per month.
CREATE TABLE IF NOT EXISTS "ApiRequestLog_2026_03" PARTITION OF "ApiRequestLog"
FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');

-- 4) Indexes on the partition (repeat per partition)
CREATE INDEX IF NOT EXISTS "ApiRequestLog_2026_03_createdAt_idx" ON "ApiRequestLog_2026_03"("createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_2026_03_agentId_createdAt_idx" ON "ApiRequestLog_2026_03"("agentId","createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_2026_03_apiKeyId_createdAt_idx" ON "ApiRequestLog_2026_03"("apiKeyId","createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_2026_03_toolName_createdAt_idx" ON "ApiRequestLog_2026_03"("toolName","createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_2026_03_status_createdAt_idx" ON "ApiRequestLog_2026_03"("status","createdAt");

-- 5) Backfill existing data into the partitioned table
INSERT INTO "ApiRequestLog" SELECT * FROM "ApiRequestLog_unpartitioned";

-- 6) Validate counts, then drop old table when confident
-- SELECT COUNT(*) FROM "ApiRequestLog_unpartitioned";
-- SELECT COUNT(*) FROM "ApiRequestLog";
-- DROP TABLE "ApiRequestLog_unpartitioned";

-- 7) Retention becomes dropping old partitions:
-- DROP TABLE IF EXISTS "ApiRequestLog_2026_01";
