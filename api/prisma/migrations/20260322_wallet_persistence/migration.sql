-- AddWalletPersistenceFields
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "wallet_label" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "wallet_network" TEXT;
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "wallet_created_at" TIMESTAMP(3);
