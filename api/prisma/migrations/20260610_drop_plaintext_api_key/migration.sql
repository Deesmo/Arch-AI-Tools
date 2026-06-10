-- Phase B API key hardening: eliminate plaintext API keys at rest.
-- Precondition (verified before this migration ships): every Agent row has a
-- non-null api_key_hash + api_key_prefix (Phase A backfill), and
-- FacilitatorProvider is empty. Dropping the column also drops its dependent
-- unique constraint/index automatically.

ALTER TABLE "Agent" DROP COLUMN IF EXISTS "api_key";

ALTER TABLE "FacilitatorProvider" DROP COLUMN IF EXISTS "api_key";
