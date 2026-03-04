-- Add premium key scrape controls and tool marketplace metadata

-- ApiKey: scrape controls
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "scrapeEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ApiKey" ADD COLUMN IF NOT EXISTS "allowedScrapeDomains" TEXT;

-- Tool: marketplace metadata
ALTER TABLE "Tool" ADD COLUMN IF NOT EXISTS "version" TEXT NOT NULL DEFAULT '1.0.0';
ALTER TABLE "Tool" ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Tool" ADD COLUMN IF NOT EXISTS "author" TEXT;
ALTER TABLE "Tool" ADD COLUMN IF NOT EXISTS "homepage" TEXT;
ALTER TABLE "Tool" ADD COLUMN IF NOT EXISTS "minPlan" "AgentPlan";
ALTER TABLE "Tool" ADD COLUMN IF NOT EXISTS "deprecated" BOOLEAN NOT NULL DEFAULT false;
