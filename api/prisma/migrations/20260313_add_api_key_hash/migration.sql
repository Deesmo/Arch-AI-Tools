-- Security: add bcrypt hash + prefix columns for API key hashing migration
-- api_key_prefix: first 12 chars of the raw key, used as a lookup index
-- api_key_hash:   bcrypt(saltRounds=10) of the full key, for secure comparison

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "api_key_prefix" VARCHAR(12);
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "api_key_hash" TEXT;

-- Backfill prefix for existing rows (first 12 chars of plaintext key)
UPDATE "Agent" SET "api_key_prefix" = LEFT(api_key, 12) WHERE "api_key_prefix" IS NULL;

-- Note: api_key_hash cannot be backfilled here because bcrypt is irreversible.
-- Existing sessions will continue to use the plaintext apiKey column until each
-- agent re-authenticates (or until a manual backfill script is run with the raw keys).
