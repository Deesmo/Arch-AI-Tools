-- Atomic free-grant guard for signup anti-farming (M1 hardening).
-- New, EMPTY table — no backfill, no constraint on existing "Agent" rows,
-- so this migration cannot fail against existing data. Populated going
-- forward: signup grant eligibility = INSERT ... ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS "SignupIdentity" (
    -- DB-level default as belt-and-suspenders: app code supplies an explicit
    -- id in the raw INSERT (Prisma @default(cuid()) does NOT apply to raw
    -- SQL), but gen_random_uuid() (built-in PG 13+) guards any other writer.
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "normalized_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignupIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignupIdentity_normalized_email_key"
    ON "SignupIdentity"("normalized_email");
