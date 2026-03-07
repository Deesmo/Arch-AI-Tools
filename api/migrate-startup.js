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

    // Add api_key column to Agent if it doesn't exist
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "api_key" TEXT;
    `);
    console.log('[migrate] api_key column ensured on Agent');

    // Add unique index if it doesn't exist
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "Agent_api_key_key" ON "Agent"("api_key");
    `);
    console.log('[migrate] Unique index on Agent.api_key ensured');

    // Add tier column if it doesn't exist (Windows schema uses "plan" not "tier")
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "tier" TEXT NOT NULL DEFAULT 'free';
    `);
    console.log('[migrate] tier column ensured on Agent');

    console.log('[migrate] All migrations complete.');
  } catch (err) {
    console.error('[migrate] Migration error (non-fatal, continuing):', err.message);
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
