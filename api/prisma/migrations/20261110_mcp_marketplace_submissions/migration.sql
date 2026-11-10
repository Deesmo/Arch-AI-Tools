-- MCP marketplace submissions used to live only in a module-level array, so a
-- deploy/restart erased accepted submissions. Persist them before answering 201.
CREATE TABLE IF NOT EXISTS "McpMarketplaceSubmission" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "repository" TEXT NOT NULL,
    "package" TEXT,
    "category" TEXT NOT NULL,
    "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "contact_email" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpMarketplaceSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "McpMarketplaceSubmission_status_idx" ON "McpMarketplaceSubmission"("status");
CREATE INDEX IF NOT EXISTS "McpMarketplaceSubmission_submittedAt_idx" ON "McpMarketplaceSubmission"("submitted_at");
