-- Wallet Persistence: store CDP wallet metadata alongside existing wallet_address
-- All columns nullable so existing agents are unaffected

ALTER TABLE "Agent" ADD COLUMN "wallet_network" TEXT;
ALTER TABLE "Agent" ADD COLUMN "wallet_label" TEXT;
ALTER TABLE "Agent" ADD COLUMN "wallet_provisioned_at" TIMESTAMP(3);
