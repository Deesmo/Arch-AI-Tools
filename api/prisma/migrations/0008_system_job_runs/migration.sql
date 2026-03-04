-- CreateTable
CREATE TABLE IF NOT EXISTS "SystemJobRun" (
  "id" TEXT NOT NULL,
  "jobName" TEXT NOT NULL,
  "lastRunAt" TIMESTAMP(3),
  "lastStatus" TEXT,
  "lastMessage" TEXT,
  "lastDurationMs" INTEGER,
  "meta" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SystemJobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SystemJobRun_jobName_key" ON "SystemJobRun"("jobName");
CREATE INDEX IF NOT EXISTS "SystemJobRun_updatedAt_idx" ON "SystemJobRun"("updatedAt");
