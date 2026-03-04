-- Daily usage rollups (fast billing reports + long-term analytics)
CREATE TABLE IF NOT EXISTS "DailyUsageRollup" (
  "id" TEXT PRIMARY KEY,
  "day" TIMESTAMP(3) NOT NULL,

  "agentId" TEXT,
  "apiKeyId" TEXT,
  "toolName" TEXT,

  "requestCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "creditsUsedSum" INTEGER NOT NULL DEFAULT 0,
  "latencyAvgMs" INTEGER NOT NULL DEFAULT 0,
  "latencyMaxMs" INTEGER NOT NULL DEFAULT 0,

  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint to upsert rollups by day & dimension
CREATE UNIQUE INDEX IF NOT EXISTS "DailyUsageRollup_day_agentId_apiKeyId_toolName_key"
  ON "DailyUsageRollup" ("day", "agentId", "apiKeyId", "toolName");

-- Query indexes
CREATE INDEX IF NOT EXISTS "DailyUsageRollup_day_idx" ON "DailyUsageRollup" ("day");
CREATE INDEX IF NOT EXISTS "DailyUsageRollup_agentId_day_idx" ON "DailyUsageRollup" ("agentId", "day");
CREATE INDEX IF NOT EXISTS "DailyUsageRollup_apiKeyId_day_idx" ON "DailyUsageRollup" ("apiKeyId", "day");
CREATE INDEX IF NOT EXISTS "DailyUsageRollup_toolName_day_idx" ON "DailyUsageRollup" ("toolName", "day");
