-- Arch Tools Platform schema (v1)
CREATE TYPE "AgentPlan" AS ENUM ('free','pro','business');

CREATE TABLE IF NOT EXISTS "Agent" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "email" TEXT UNIQUE,
  "plan" "AgentPlan" NOT NULL DEFAULT 'free',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL REFERENCES "Agent"("id") ON DELETE CASCADE,
  "keyHash" TEXT NOT NULL UNIQUE,
  "prefix" TEXT NOT NULL,
  "label" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3)
);

CREATE TABLE IF NOT EXISTS "Tool" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL UNIQUE,
  "description" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'POST',
  "credits" INTEGER NOT NULL,
  "schemaJson" JSONB,
  "category" TEXT,
  "ownerAgentId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS "LedgerEntry" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL REFERENCES "Agent"("id") ON DELETE CASCADE,
  "kind" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "toolName" TEXT,
  "requestId" TEXT,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "CreditGrant" (
  "id" TEXT PRIMARY KEY,
  "agentId" TEXT NOT NULL REFERENCES "Agent"("id") ON DELETE CASCADE,
  "credits" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "reference" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS "Agent_email_idx" ON "Agent"("email");
CREATE INDEX IF NOT EXISTS "ApiKey_agentId_idx" ON "ApiKey"("agentId");
CREATE INDEX IF NOT EXISTS "Tool_active_idx" ON "Tool"("active");
CREATE INDEX IF NOT EXISTS "LedgerEntry_agentId_createdAt_idx" ON "LedgerEntry"("agentId","createdAt");
CREATE INDEX IF NOT EXISTS "LedgerEntry_agentId_kind_idx" ON "LedgerEntry"("agentId","kind");
CREATE INDEX IF NOT EXISTS "CreditGrant_agentId_createdAt_idx" ON "CreditGrant"("agentId","createdAt");

-- Unique idempotency for Stripe/webhook-like grants
CREATE UNIQUE INDEX IF NOT EXISTS "CreditGrant_agentId_source_reference_uq" ON "CreditGrant"("agentId","source","reference");
