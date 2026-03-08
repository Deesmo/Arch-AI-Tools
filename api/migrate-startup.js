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

    // OAuth 2.0 tables for Claude Connector listing
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OAuthClient" (
      "id" TEXT PRIMARY KEY,
      "clientId" TEXT UNIQUE NOT NULL,
      "clientSecret" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "redirectUris" TEXT[] NOT NULL DEFAULT '{}',
      "createdAt" TIMESTAMP DEFAULT NOW()
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OAuthAuthCode" (
      "id" TEXT PRIMARY KEY,
      "code" TEXT UNIQUE NOT NULL,
      "clientId" TEXT NOT NULL,
      "agentId" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "redirectUri" TEXT NOT NULL,
      "expiresAt" TIMESTAMP NOT NULL,
      "used" BOOLEAN DEFAULT FALSE,
      "createdAt" TIMESTAMP DEFAULT NOW()
    )`);
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "OAuthToken" (
      "id" TEXT PRIMARY KEY,
      "accessToken" TEXT UNIQUE NOT NULL,
      "refreshToken" TEXT UNIQUE NOT NULL,
      "clientId" TEXT NOT NULL,
      "agentId" TEXT NOT NULL,
      "scope" TEXT NOT NULL,
      "expiresAt" TIMESTAMP NOT NULL,
      "createdAt" TIMESTAMP DEFAULT NOW()
    )`);
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OAuthAuthCode_code_idx" ON "OAuthAuthCode"("code")`); } catch {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OAuthToken_accessToken_idx" ON "OAuthToken"("accessToken")`); } catch {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "OAuthToken_refreshToken_idx" ON "OAuthToken"("refreshToken")`); } catch {}

    // Seed Claude as an OAuth client (idempotent)
    const claudeClientId = 'claude-anthropic-connector';
    const claudeClientSecret = process.env.OAUTH_CLAUDE_SECRET || 'arch-claude-secret-' + Math.random().toString(36).slice(2);
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "OAuthClient" ("id","clientId","clientSecret","name","redirectUris")
        VALUES (gen_random_uuid()::text, $1, $2, 'Claude (Anthropic)', ARRAY['https://claude.ai/oauth/callback','https://api.claude.ai/oauth/callback'])
        ON CONFLICT ("clientId") DO NOTHING
      `, claudeClientId, claudeClientSecret);
      console.log('[migrate] Claude OAuth client seeded');
    } catch(e) { console.warn('[migrate] Claude OAuth seed skip:', e.message.slice(0,60)); }

    console.log('[migrate] OAuth 2.0 tables created');

    // Ensure ApiRequest table exists (CREATE before ALTER)
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "ApiRequest" (
      "id" TEXT PRIMARY KEY,
      "agentId" TEXT NOT NULL REFERENCES "Agent"("id"),
      "toolName" TEXT NOT NULL,
      "creditsUsed" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'SUCCESS',
      "responseMs" INTEGER,
      "callerType" TEXT,
      "callerName" TEXT,
      "callerVersion" TEXT,
      "createdAt" TIMESTAMP DEFAULT NOW()
    )`);
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ApiRequest_agentId_idx" ON "ApiRequest"("agentId")`); } catch {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ApiRequest_toolName_idx" ON "ApiRequest"("toolName")`); } catch {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ApiRequest_createdAt_idx" ON "ApiRequest"("createdAt")`); } catch {}
    console.log('[migrate] ApiRequest table ensured');

    // Add agent fingerprinting columns to ApiRequest (safe if already there)
    try { await prisma.$executeRawUnsafe(`ALTER TABLE "ApiRequest" ADD COLUMN IF NOT EXISTS "callerType" TEXT`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE "ApiRequest" ADD COLUMN IF NOT EXISTS "callerName" TEXT`); } catch {}
    try { await prisma.$executeRawUnsafe(`ALTER TABLE "ApiRequest" ADD COLUMN IF NOT EXISTS "callerVersion" TEXT`); } catch {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "ApiRequest_callerName_idx" ON "ApiRequest"("callerName")`); } catch {}
    console.log('[migrate] Agent fingerprinting columns ensured on ApiRequest');

    // Ensure Purchase table exists
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Purchase" (
      "id" TEXT PRIMARY KEY,
      "agentId" TEXT NOT NULL REFERENCES "Agent"("id"),
      "stripeId" TEXT UNIQUE NOT NULL,
      "credits" INTEGER NOT NULL,
      "amountCents" INTEGER NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'pending',
      "createdAt" TIMESTAMP DEFAULT NOW()
    )`);
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Purchase_agentId_idx" ON "Purchase"("agentId")`); } catch {}
    console.log('[migrate] Purchase table ensured');

    // Ensure DailyUsage table exists
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "DailyUsage" (
      "id" TEXT PRIMARY KEY,
      "date" TEXT NOT NULL,
      "toolName" TEXT NOT NULL,
      "callCount" INTEGER NOT NULL DEFAULT 0,
      "updatedAt" TIMESTAMP DEFAULT NOW()
    )`);
    try { await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "DailyUsage_date_toolName_key" ON "DailyUsage"("date","toolName")`); } catch {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "DailyUsage_date_idx" ON "DailyUsage"("date")`); } catch {}
    console.log('[migrate] DailyUsage table ensured');

    // Ensure X402Payment table exists
    await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "X402Payment" (
      "id" TEXT PRIMARY KEY,
      "agentId" TEXT,
      "toolName" TEXT NOT NULL,
      "amountUsdc" TEXT NOT NULL,
      "txHash" TEXT,
      "network" TEXT NOT NULL DEFAULT 'base',
      "status" TEXT NOT NULL DEFAULT 'settled',
      "createdAt" TIMESTAMP DEFAULT NOW()
    )`);
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "X402Payment_createdAt_idx" ON "X402Payment"("createdAt")`); } catch {}
    console.log('[migrate] X402Payment table ensured');

    // Seed all missing tools via raw SQL (safe, idempotent)
    const missingTools = [
      { name: "barcode-generate",   description: "Generate Code128 barcodes as SVG",                            category: "media",   credits: 2  },
      { name: "html-to-markdown",   description: "Convert HTML or any URL to clean Markdown",                   category: "text",    credits: 3  },
      { name: "image-generate",     description: "Generate SVG images from text prompts via Claude",             category: "ai",      credits: 15 },
      { name: "jsonpath-query",     description: "Run JSONPath expressions against any JSON payload",            category: "data",    credits: 1  },
      { name: "screenshot-capture", description: "Capture page metadata and screenshot URL for any public URL", category: "web",     credits: 10 },
      { name: "url-shorten",        description: "Shorten any URL via TinyURL",                                 category: "utility", credits: 1  },
      { name: "webhook-send",       description: "POST a JSON payload to any webhook URL",                      category: "utility", credits: 2  },
      { name: "workflow-agent",     description: "Multi-step autonomous AI agent pipeline",                     category: "ai",      credits: 25 },
    ];
    for (const t of missingTools) {
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Tool" (id, name, description, category, credits, enabled)
           VALUES (gen_random_uuid()::text, $1, $2, $3, $4, true)
           ON CONFLICT (name) DO UPDATE SET description=$2, category=$3, credits=$4, enabled=true`,
          t.name, t.description, t.category, t.credits
        );
        console.log('[migrate] Tool upserted (SQL):', t.name);
      } catch (err) {
        console.warn('[migrate] Tool SQL skip:', t.name, err.message.slice(0, 80));
      }
    }
    console.log('[migrate] Missing tools seeded');

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

    // Clean up expired OAuth codes and tokens
    try {
      const now = new Date().toISOString();
      await prisma.$executeRawUnsafe(`DELETE FROM "OAuthAuthCode" WHERE "expiresAt" < $1 OR "used" = true`, now);
      await prisma.$executeRawUnsafe(`DELETE FROM "OAuthToken" WHERE "expiresAt" < $1`, now);
      console.log('[migrate] Expired OAuth codes/tokens cleaned up');
    } catch(e) { console.warn('[migrate] OAuth cleanup skip:', e.message?.slice(0,60)); }

    // Ensure Tool table has 'enabled' column (was missing from original schema)
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Tool" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN DEFAULT true`);
      await prisma.$executeRawUnsafe(`UPDATE "Tool" SET enabled = true WHERE enabled IS NULL`);
      await prisma.$executeRawUnsafe(`ALTER TABLE "Tool" ALTER COLUMN "enabled" SET NOT NULL`);
      console.log('[migrate] Tool.enabled column ensured + nulls fixed');
    } catch (err) {
      console.warn('[migrate] Tool.enabled skip:', err.message.slice(0, 80));
    }
    // Ensure Tool table has 'schemaJson' column
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Tool" ADD COLUMN IF NOT EXISTS "schemaJson" JSONB`);
      console.log('[migrate] Tool.schemaJson column ensured');
    } catch (err) {
      console.warn('[migrate] Tool.schemaJson skip:', err.message.slice(0, 80));
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
