-- AlterTable: add password_hash column (nullable, existing users unaffected)
ALTER TABLE "Agent" ADD COLUMN "password_hash" TEXT;
