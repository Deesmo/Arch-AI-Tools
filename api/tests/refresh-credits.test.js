import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (...p) => path.join(__dirname, "..", "dist", ...p);

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

async function main() {
  process.env.FREE_MONTHLY_CREDITS = "250";
  const { prisma } = await import(dist("lib", "prisma.js"));
  const { refreshMonthlyCredits } = await import(dist("cron", "refreshCredits.js"));

  const lastMonth = new Date("2026-05-15T00:00:00.000Z");
  const thisMonth = new Date("2026-06-10T00:00:00.000Z");
  const updates = [];

  prisma.agent.findMany = async () => [
    { id: "low_old", email: null, credits: 10, updatedAt: lastMonth },
    { id: "high_old", email: null, credits: 1000, updatedAt: lastMonth },
    { id: "low_new", email: null, credits: 10, updatedAt: thisMonth },
  ];
  prisma.agent.updateMany = async (args) => {
    updates.push(args);
    if (args.where.id === "high_old") return { count: 0 };
    return { count: 1 };
  };

  console.log("Monthly credit refresh:");
  await test("tops up stale low balances to monthly allowance only", async () => {
    const result = await refreshMonthlyCredits(new Date("2026-06-26T00:00:00.000Z"));
    assert.deepStrictEqual(result, { granted: 1, skipped: 2 });
    assert.deepStrictEqual(
      updates.map((u) => ({ id: u.where.id, creditGuard: u.where.credits, data: u.data })),
      [
        { id: "low_old", creditGuard: { lt: 250 }, data: { credits: 250 } },
        { id: "high_old", creditGuard: { lt: 250 }, data: { credits: 250 } },
      ],
    );
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll monthly refresh tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
