-- Add premium key restriction fields + prefix index
ALTER TABLE "ApiKey"
  ADD COLUMN IF NOT EXISTS "allowedOrigins" TEXT,
  ADD COLUMN IF NOT EXISTS "allowedIps" TEXT,
  ADD COLUMN IF NOT EXISTS "dailyCreditCap" INTEGER;

CREATE INDEX IF NOT EXISTS "ApiKey_prefix_idx" ON "ApiKey"("prefix");
