-- x402 directory state (2026-11-02). The directory lived only in
-- dist/data/x402-directory.json, rewritten in place on submit/approve; Render's
-- disk is reset on every deploy, so those writes were lost. One row now holds
-- the live directory document. Additive only + idempotent (IF NOT EXISTS).
-- Applies at next deploy via migrate-startup.js (`npx prisma migrate deploy`).
CREATE TABLE IF NOT EXISTS "DirectoryState" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DirectoryState_pkey" PRIMARY KEY ("id")
);
