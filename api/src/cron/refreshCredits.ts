// @ts-nocheck
/**
 * Monthly Free Credit Refresh
 *
 * Tops up free-tier agents to FREE_MONTHLY_CREDITS on the 1st of each month.
 * Render Cron Job: Schedule 0 0 1 * * | Command: node dist/cron/refreshCredits.js
 *
 * Safe to run multiple times — uses updatedAt guard to prevent double-grants in same month.
 */
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { sendMonthlyRefreshEmail } from "../services/email.js";

export async function refreshMonthlyCredits(now = new Date()): Promise<{ granted: number; skipped: number }> {
  const credits = Number(process.env.FREE_MONTHLY_CREDITS || 250);

  if (credits <= 0) {
    console.log("FREE_MONTHLY_CREDITS is 0 — skipping refresh");
    return { granted: 0, skipped: 0 };
  }

  // Only refresh agents whose credits haven't been topped up this month
  const startOfMonth = new Date(now);
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const agents = await prisma.agent.findMany({
    where: { tier: "free" },
    select: { id: true, email: true, credits: true, updatedAt: true },
  });

  let granted = 0;
  let skipped = 0;

  for (const agent of agents) {
    // Skip if already refreshed this month (updatedAt is within current month)
    if (agent.updatedAt >= startOfMonth) {
      skipped++;
      continue;
    }

    const result = await prisma.agent.updateMany({
      where: { id: agent.id, credits: { lt: credits } },
      data: { credits: credits },
    });
    if (result.count === 0) {
      skipped++;
      continue;
    }
    granted++;

    // Send monthly refresh email (non-blocking)
    if (agent.email) {
      sendMonthlyRefreshEmail(agent.email, credits - agent.credits, credits).catch(() => {});
    }
  }

  console.log(`Credit refresh complete: ${granted} granted, ${skipped} skipped.`);
  return { granted, skipped };
}

async function main() {
  await refreshMonthlyCredits();
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMainModule) {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error("Credit refresh failed:", e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
