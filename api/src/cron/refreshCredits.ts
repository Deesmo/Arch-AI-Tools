/**
 * Monthly Free Credit Refresh
 *
 * Grants FREE_MONTHLY_CREDITS to all free-plan agents
 * who haven't received a monthly_free grant in the current month.
 *
 * Render Cron Job setup:
 *   Schedule: 0 0 1 * *  (1st of each month at midnight UTC)
 *   Command: npm run refresh-credits
 *
 * Safe to run multiple times — idempotent via month-based reference.
 */
import "dotenv/config";
import { prisma } from "../db.js";

async function main() {
  const now = new Date();
  const monthRef = `monthly_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, "0")}`;
  const credits = Number(process.env.FREE_MONTHLY_CREDITS || 100);

  if (credits <= 0) {
    console.log("FREE_MONTHLY_CREDITS is 0 — skipping refresh");
    return;
  }

  const agents = await prisma.agent.findMany({
    where: { plan: "free" },
    select: { id: true },
  });

  let granted = 0;
  let skipped = 0;

  for (const agent of agents) {
    const existing = await prisma.creditGrant.findFirst({
      where: { agentId: agent.id, source: "monthly_free", reference: monthRef },
    });

    if (existing) {
      skipped++;
      continue;
    }

    await prisma.creditGrant.create({
      data: {
        agentId: agent.id,
        credits,
        source: "monthly_free",
        reference: monthRef,
      },
    });
    granted++;
  }

  console.log(`Credit refresh complete: ${granted} granted, ${skipped} already had this month. Month: ${monthRef}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error("Credit refresh failed:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
