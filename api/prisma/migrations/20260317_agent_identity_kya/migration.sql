-- Agent Identity (KYA — Know Your Agent)
-- Adds reputation scoring, badges, and identity metadata to Agent model

ALTER TABLE "Agent" ADD COLUMN "description" TEXT;
ALTER TABLE "Agent" ADD COLUMN "wallet_address" TEXT;
ALTER TABLE "Agent" ADD COLUMN "callback_url" TEXT;
ALTER TABLE "Agent" ADD COLUMN "reputation_score" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Agent" ADD COLUMN "badge" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "Agent" ADD COLUMN "error_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN "success_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN "total_spent_usdc" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Agent" ADD COLUMN "is_public" BOOLEAN NOT NULL DEFAULT true;
