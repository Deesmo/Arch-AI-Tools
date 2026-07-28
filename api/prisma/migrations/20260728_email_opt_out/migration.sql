-- Marketing email opt-out (CAN-SPAM unsubscribe, 2026-07-28).
-- Additive only + idempotent (IF NOT EXISTS) — safe to re-run and safe against
-- existing data (every existing row defaults to opted-IN, matching current
-- behavior; nobody has asked to be suppressed through this mechanism yet).
-- Applies at next deploy via migrate-startup.js (`npx prisma migrate deploy`).
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "email_opt_out" BOOLEAN NOT NULL DEFAULT false;
