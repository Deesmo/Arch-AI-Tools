-- Archive of files found on the Render persistent disk (2026-11-02). The disk
-- (/opt/render/project/data) is unused by the app but disables zero-downtime
-- deploys; its only file, a 32 KB legacy SQLite database last written
-- 2026-03-03, is copied here byte-for-byte before the disk is removed.
-- Additive only + idempotent (IF NOT EXISTS).
CREATE TABLE IF NOT EXISTS "DiskArchive" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "fileModifiedAt" TIMESTAMP(3) NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiskArchive_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DiskArchive_sha256_key" ON "DiskArchive"("sha256");
