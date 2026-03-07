/**
 * migrate-startup.js
 * Runs lightweight SQL migrations then starts the app.
 * Used as Render start command: node migrate-startup.js
 */
const { PrismaClient } = require('@prisma/client');
const { spawn } = require('child_process');

async function migrate() {
  const prisma = new PrismaClient();
  try {
    console.log('[migrate] Running startup migrations...');

    const migrations = [
      // Agent table — add all columns that Windows schema is missing
      `ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "api_key" TEXT`,
      `ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'free'`,
      `ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "credits" INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "totalCalls" INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP`,
      // Unique index on api_key
      `CREATE UNIQUE INDEX IF NOT EXISTS "Agent_api_key_key" ON "Agent"("api_key")`,
    ];

    for (const sql of migrations) {
      try {
        await prisma.$executeRawUnsafe(sql);
        console.log('[migrate] OK:', sql.slice(0, 60));
      } catch (err) {
        // Non-fatal — column/index may already exist with a slightly different state
        console.warn('[migrate] SKIP (non-fatal):', err.message.slice(0, 100));
      }
    }

    console.log('[migrate] All migrations complete.');
  } catch (err) {
    console.error('[migrate] Fatal migration error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

migrate().then(() => {
  console.log('[migrate] Starting app...');
  const child = spawn('node', ['dist/index.js'], {
    stdio: 'inherit',
    env: process.env
  });
  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('[migrate] Failed to start app:', err);
    process.exit(1);
  });
});
