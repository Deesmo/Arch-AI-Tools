#!/usr/bin/env node
/**
 * backfill-api-key-hashes.cjs — Phase A security backfill
 *
 * For every Agent whose api_key_hash IS NULL, compute:
 *   api_key_prefix = first 12 chars of plaintext api_key
 *   api_key_hash   = bcrypt(api_key, 10)
 *
 * Idempotent (only touches NULL-hash rows), batched, read-then-write.
 * Skips revoked keys (api_key starting with "revoked_") — those must not
 * become valid bcrypt-verifiable credentials.
 *
 * Usage: DATABASE_URL=... node scripts/backfill-api-key-hashes.cjs
 */
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const BATCH = 25;

async function main() {
  const before = await prisma.agent.count({ where: { apiKeyHash: null } });
  const total = await prisma.agent.count();
  console.log(`[backfill] total agents=${total}, missing hash=${before}`);
  if (before === 0) {
    console.log("[backfill] nothing to do");
    return;
  }

  let updated = 0;
  let skipped = 0;
  for (;;) {
    const rows = await prisma.agent.findMany({
      where: { apiKeyHash: null },
      select: { id: true, apiKey: true },
      take: BATCH,
    });
    if (rows.length === 0) break;
    let progressed = false;
    for (const row of rows) {
      if (!row.apiKey || row.apiKey.startsWith("revoked_")) {
        // Revoked/empty keys: set hash to empty string so they exit the
        // NULL-hash legacy path and can never bcrypt-match anything.
        await prisma.agent.update({
          where: { id: row.id },
          data: { apiKeyHash: "" },
        });
        skipped++;
        progressed = true;
        continue;
      }
      const hash = await bcrypt.hash(row.apiKey, 10);
      await prisma.agent.update({
        where: { id: row.id },
        data: { apiKeyHash: hash, apiKeyPrefix: row.apiKey.slice(0, 12) },
      });
      updated++;
      progressed = true;
    }
    if (!progressed) break;
  }

  const after = await prisma.agent.count({ where: { apiKeyHash: null } });
  console.log(
    `[backfill] done: hashed=${updated}, revoked/empty marked=${skipped}, remaining null=${after}`
  );
  if (after !== 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("[backfill] FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
