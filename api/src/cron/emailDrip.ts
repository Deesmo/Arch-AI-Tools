/**
 * Email Drip Cron — fires daily
 * Day 3: follow-up tip
 * Day 7: re-engagement
 */
import { prisma } from "../lib/prisma.js";
import { sendDay3FollowupEmail, sendDay7ReengagementEmail } from "../services/email.js";
import { logger } from "../lib/logger.js";

export async function runEmailDrip(): Promise<void> {
  const now = new Date();

  // Day-3 followup: agents created 3 days ago ±12h
  const day3Start = new Date(now.getTime() - 3.5 * 24 * 60 * 60 * 1000);
  const day3End = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000);

  // Day-7 re-engagement: agents created 7 days ago ±12h
  const day7Start = new Date(now.getTime() - 7.5 * 24 * 60 * 60 * 1000);
  const day7End = new Date(now.getTime() - 6.5 * 24 * 60 * 60 * 1000);

  try {
    const [day3Agents, day7Agents] = await Promise.all([
      prisma.agent.findMany({
        where: { createdAt: { gte: day3Start, lte: day3End }, email: { not: null } },
        select: { id: true, email: true, creditsRemaining: true }
      }),
      prisma.agent.findMany({
        where: { createdAt: { gte: day7Start, lte: day7End }, email: { not: null } },
        select: { id: true, email: true, creditsRemaining: true }
      }),
    ]);

    logger.info({ day3: day3Agents.length, day7: day7Agents.length }, "Email drip batch");

    await Promise.all([
      ...day3Agents.map(a => a.email ? sendDay3FollowupEmail(a.email, a.id, a.creditsRemaining ?? 0) : Promise.resolve()),
      ...day7Agents.map(a => a.email ? sendDay7ReengagementEmail(a.email, a.creditsRemaining ?? 0) : Promise.resolve()),
    ]);
  } catch (err: any) {
    logger.error({ err: err.message }, "Email drip cron failed");
  }
}
