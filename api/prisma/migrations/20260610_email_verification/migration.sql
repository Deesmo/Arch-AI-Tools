-- Email verification gate: credits don't activate until email verified.
-- Additive only. Existing accounts are grandfathered as verified (no clawback).
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "verify_token" TEXT;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "verify_token_expiry" TIMESTAMP(3);
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "pending_credits" INTEGER NOT NULL DEFAULT 0;

-- Backfill: all accounts created before this migration are treated as verified.
UPDATE "Agent" SET "email_verified" = true WHERE "email_verified" = false;
