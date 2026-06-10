-- Atomic free-grant guard for signup anti-farming (M1 hardening).
-- New, EMPTY table — no backfill, no constraint on existing "Agent" rows,
-- so this migration cannot fail against existing data. Populated going
-- forward: signup grant eligibility = INSERT ... ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS "SignupIdentity" (
    "id" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SignupIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SignupIdentity_normalized_email_key"
    ON "SignupIdentity"("normalized_email");
