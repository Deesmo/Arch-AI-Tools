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

    // Add agent fingerprinting columns to ApiRequest
    await prisma.$executeRawUnsafe(`ALTER TABLE "ApiRequest" ADD COLUMN IF NOT EXISTS "callerType" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ApiRequest" ADD COLUMN IF NOT EXISTS "callerName" TEXT`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "ApiRequest" ADD COLUMN IF NOT EXISTS "callerVersion" TEXT`);
    // Add index for callerName (best-effort — ignore if exists)
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ApiRequest_callerName_idx" ON "ApiRequest"("callerName")`); } catch {}
    console.log('[migrate] Agent fingerprinting columns added to ApiRequest');

    // Seed new crypto tools (upsert — safe to run multiple times)
    const cryptoTools = [
      { name: "crypto-price", description: "Real-time price, 24h change, market cap, and volume for any cryptocurrency", category: "crypto", credits: 1 },
      { name: "crypto-ohlcv", description: "OHLCV candlestick data for any crypto over 1-90 days", category: "crypto", credits: 2 },
      { name: "crypto-market-cap", description: "Top N cryptocurrencies by market cap with price, volume, and 24h change", category: "crypto", credits: 1 },
      { name: "crypto-fear-greed", description: "Crypto Fear & Greed Index with historical data", category: "crypto", credits: 1 },
      { name: "crypto-sentiment", description: "Community sentiment, social stats, and price momentum for any cryptocurrency", category: "crypto", credits: 2 },
      { name: "crypto-news", description: "Latest crypto news headlines. Filter by token symbol", category: "crypto", credits: 2 },
      { name: "token-lookup", description: "Search for any token by name or ticker, returns CoinGecko IDs", category: "crypto", credits: 1 },
    ];
    for (const tool of cryptoTools) {
      try {
        await prisma.tool.upsert({
          where: { name: tool.name },
          update: { description: tool.description, category: tool.category, credits: tool.credits },
          create: { ...tool, enabled: true },
        });
        console.log('[migrate] Tool upserted:', tool.name);
      } catch (err) {
        console.warn('[migrate] Tool upsert skip:', tool.name, err.message.slice(0, 60));
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
