-- API request logs (enterprise observability & audit)
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
);

CREATE INDEX IF NOT EXISTS "ApiRequestLog_createdAt_idx" ON "ApiRequestLog"("createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_agentId_createdAt_idx" ON "ApiRequestLog"("agentId","createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_apiKeyId_createdAt_idx" ON "ApiRequestLog"("apiKeyId","createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_toolName_createdAt_idx" ON "ApiRequestLog"("toolName","createdAt");
