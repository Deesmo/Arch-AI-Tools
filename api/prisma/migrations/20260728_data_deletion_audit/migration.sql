-- GDPR deletion audit trail (DataDeletionAudit) — hardening batch 2026-07-28.
-- PR #74's DELETE /v1/agent had no durable audit trail (only a process log
-- line). One row per deletion, written inside the deletion transaction.
-- Contains NO direct identifiers: agent id stored only as a SHA-256 hash;
-- requester evidence holds the auth method + truncated hashes.
--
-- Additive only + idempotent (IF NOT EXISTS), safe to re-run and safe against
-- existing data (empty table, no backfill). Runs at next deploy via
-- migrate-startup.js (`npx prisma migrate deploy`) — same pattern as
-- 20260726_refund_clawback.

CREATE TABLE IF NOT EXISTS "DataDeletionAudit" (
    -- App code supplies an explicit id via Prisma @default(cuid());
    -- gen_random_uuid() (built-in PG 13+) guards any other writer.
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "agent_id_hash" TEXT NOT NULL,
    "erased_summary" TEXT NOT NULL,
    "requester_evidence" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DataDeletionAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DataDeletionAudit_agent_id_hash_idx" ON "DataDeletionAudit"("agent_id_hash");
