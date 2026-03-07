// @ts-nocheck
/**
 * Monthly Free Credit Refresh
 *
 * Resets credits for all free-tier agents to FREE_MONTHLY_CREDITS on the 1st of each month.
 * Render Cron Job: Schedule 0 0 1 * * | Command: node dist/cron/refreshCredits.js
 *
 * Safe to run multiple times — uses updatedAt guard to prevent double-grants in same month.
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";

async function main() {
  const credits = Number(process.env.FREE_MONTHLY_CREDITS || 100);

  if (credits <= 0) {
    console.log("FREE_MONTHLY_CREDITS is 0 — skipping refresh");
    return;
  }

  // Only refresh agents whose credits haven't been topped up this month
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const agents = await prisma.agent.findMany({
    where: { tier: "free" },
    select: { id: true, updatedAt: true },
  });

  let granted = 0;
  let skipped = 0;

  for (const agent of agents) {
    // Skip if already refreshed this month (updatedAt is within current month)
    if (agent.updatedAt >= startOfMonth) {
      skipped++;
      continue;
    }

    await prisma.agent.update({
      where: { id: agent.id },
      data: { credits: credits },
    });
    granted++;
  }

  console.log(`Credit refresh complete: ${granted} granted, ${skipped} already refreshed this month.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Credit refresh failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
