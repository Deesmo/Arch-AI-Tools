-- Refund / chargeback / payment_failed clawback (billing hardening).
-- Additive only + idempotent (IF NOT EXISTS / IF EXISTS), safe to re-run and
-- safe against existing data. Runs at next deploy via migrate-startup.js
-- (`npx prisma migrate deploy`).

-- 1. Link a purchase back to its Stripe PaymentIntent so a refund/dispute event
--    (which carries the charge's payment_intent, not the checkout-session id we
--    key `stripeId` on) can find the granted credits. Nullable — legacy rows
--    stay NULL and are handled by an admin alert if reversed.
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "payment_intent_id" TEXT;
CREATE INDEX IF NOT EXISTS "Purchase_payment_intent_id_idx" ON "Purchase"("payment_intent_id");

-- 2. Mark a purchase's credits as reversed. Nullable timestamp; existing rows
--    stay NULL (never clawed back).
ALTER TABLE "Purchase" ADD COLUMN IF NOT EXISTS "clawed_back_at" TIMESTAMP(3);

-- 3. Idempotency guard for reversals. One row per Stripe reversal event object
--    id (refund / dispute / failed-invoice id). The UNIQUE index makes
--    "already processed?" a DB-level decision — a redelivered webhook loses the
--    INSERT and cannot double-decrement. Mirrors "SignupIdentity". EMPTY table,
--    no backfill, so this migration cannot fail against existing data.
CREATE TABLE IF NOT EXISTS "Clawback" (
    -- App code supplies an explicit id in the raw INSERT (Prisma @default(cuid())
    -- does NOT apply to raw SQL); gen_random_uuid() (built-in PG 13+) guards any
    -- other writer.
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "event_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "agent_id" TEXT,
    "purchase_stripe_id" TEXT,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Clawback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Clawback_event_id_key" ON "Clawback"("event_id");
CREATE INDEX IF NOT EXISTS "Clawback_agent_id_idx" ON "Clawback"("agent_id");
