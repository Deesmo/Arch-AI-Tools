-- Create users table
CREATE TABLE IF NOT EXISTS "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users"("email");

-- Email verifications
CREATE TABLE IF NOT EXISTS "email_verifications" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "ip" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_verifications_tokenHash_key" ON "email_verifications"("tokenHash");
CREATE INDEX IF NOT EXISTS "email_verifications_userId_createdAt_idx" ON "email_verifications"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "email_verifications_email_idx" ON "email_verifications"("email");

ALTER TABLE "email_verifications"
  ADD CONSTRAINT "email_verifications_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Link Agents -> Users
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "userId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Agent_userId_key" ON "Agent"("userId");

ALTER TABLE "Agent"
  ADD CONSTRAINT "Agent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
