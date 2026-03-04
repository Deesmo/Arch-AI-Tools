-- CreateTable
CREATE TABLE "admin_api_keys" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "keyPrefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT[] NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "admin_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_api_keys_keyPrefix_key" ON "admin_api_keys"("keyPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "admin_api_keys_keyHash_key" ON "admin_api_keys"("keyHash");

-- CreateIndex
CREATE INDEX "admin_api_keys_isActive_idx" ON "admin_api_keys"("isActive");

-- Trigger to keep updatedAt fresh
CREATE OR REPLACE FUNCTION set_updated_at_admin_api_keys()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_admin_api_keys_trigger ON "admin_api_keys";
CREATE TRIGGER set_updated_at_admin_api_keys_trigger
BEFORE UPDATE ON "admin_api_keys"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_admin_api_keys();
