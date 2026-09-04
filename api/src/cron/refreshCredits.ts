// @ts-nocheck
/**
 * Monthly Free Credit Refresh
 *
 * Tops up free-tier agents to FREE_MONTHLY_CREDITS on the 1st of each month.
 * Render Cron Job: Schedule 0 0 1 * * | Command: node dist/cron/refreshCredits.js
 *
 * TOP-UP, NEVER RESET: an inactive free agent that still holds PURCHASED pack
 * credits above the monthly free grant must NOT be lowered to the free amount.
 * We only grant when the current balance is below the monthly floor.
 *
 * Safe to run multiple times — uses an explicit AuditLog marker to prevent
 * double-grants in the same month. Do NOT use Agent.updatedAt for this: normal
 * account activity (auth lastSeenAt, password changes, etc.) updates that column.
 */
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../lib/prisma.js";
import { sendMonthlyRefreshEmail } from "../services/email.js";

export const MONTHLY_REFRESH_ACTION = "monthly_free_credit_refresh";

export async function refreshMonthlyCredits(now = new Date()): Promise<{ granted: number; skipped: number }> {
  const credits = Number(process.env.FREE_MONTHLY_CREDITS || 250);

  if (credits <= 0) {
    console.log("FREE_MONTHLY_CREDITS is 0 — skipping refresh");
    return { granted: 0, skipped: 0 };
  }

  // Only process agents that do not already have this month's refresh marker.
  const startOfMonth = new Date(now);
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const agents = await prisma.agent.findMany({
    where: { tier: "free" },
    select: { id: true, email: true, credits: true },
  });

  let granted = 0;
  let skipped = 0;

  for (const agent of agents) {
    const result = await prisma.$transaction(async (tx) => {
      const month = startOfMonth.toISOString().slice(0, 7);
      const alreadyRefreshed = await tx.auditLog.findFirst({
        where: {
          agentId: agent.id,
          action: MONTHLY_REFRESH_ACTION,
          createdAt: { gte: startOfMonth },
        },
        select: { id: true },
      });
      if (alreadyRefreshed) return { added: 0, balance: agent.credits };

      // TOP-UP ONLY: raise the balance to the monthly floor iff it is currently
      // below it. Agents already at/above the floor (e.g. holding purchased pack
      // credits) are left untouched so we never lower a paid balance.
      let added = 0;
      let balance = agent.credits;
      if (agent.credits < credits) {
        const updated = await tx.agent.updateMany({
          where: { id: agent.id, credits: { lt: credits } },
          data: { credits },
        });
        if (updated.count > 0) {
          added = credits - agent.credits;
          balance = credits;
        }
      }

      await tx.auditLog.create({
        data: {
          agentId: agent.id,
          action: MONTHLY_REFRESH_ACTION,
          resource: month,
          status: added > 0 ? "success" : "skipped",
          meta: {
            credits_floor: credits,
            previous_credits: agent.credits,
            credits_added: added,
            balance_after: balance,
          },
        },
      });

      return { added, balance };
    });

    if (result.added <= 0) {
      skipped++;
      continue;
    }
    granted++;

    // Send monthly refresh email (non-blocking)
    if (agent.email) {
      sendMonthlyRefreshEmail(agent.email, result.added, result.balance).catch(() => {});
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
