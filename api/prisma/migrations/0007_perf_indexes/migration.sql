-- Performance indexes for enterprise scale

-- ApiRequestLog: common filters for dashboards & incident response
CREATE INDEX IF NOT EXISTS "ApiRequestLog_status_createdAt_idx" ON "ApiRequestLog"("status","createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_apiKeyPrefix_createdAt_idx" ON "ApiRequestLog"("apiKeyPrefix","createdAt");
CREATE INDEX IF NOT EXISTS "ApiRequestLog_ip_createdAt_idx" ON "ApiRequestLog"("ip","createdAt");

-- Fast error investigations (partial index)
CREATE INDEX IF NOT EXISTS "ApiRequestLog_errors_tool_createdAt_idx"
  ON "ApiRequestLog"("toolName","createdAt")
  WHERE COALESCE("status", 0) >= 400;

-- BRIN index for massive time-series tables (very small, very fast for range scans)
-- Only useful on Postgres. Safe no-op elsewhere.
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "ApiRequestLog_createdAt_brin_idx" ON "ApiRequestLog" USING BRIN("createdAt")';
  EXCEPTION WHEN others THEN
    -- ignore if BRIN unsupported
    NULL;
  END;
END $$;
