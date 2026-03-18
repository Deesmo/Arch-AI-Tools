/**
 * Low Credits Batch Cron — fires daily
 * Sends alert emails at 80% and 100% consumption thresholds.
 */
import { prisma } from "../lib/prisma.js";
import { sendEmail80PctAlert, sendCreditsDepletedAlert } from "../services/email.js";
import { logger } from "../lib/logger.js";

// Default initial credits for free tier
const INITIAL_FREE_CREDITS = 100;

export async function runLowCreditsCron(): Promise<void> {
  try {
    // Agents at 80% consumption (≤20 credits remaining, >0)
    const threshold80 = Math.floor(INITIAL_FREE_CREDITS * 0.2); // 20 credits = 80% consumed
    const lowCreditAgents = await prisma.agent.findMany({
      where: {
        credits: { gt: 0, lte: threshold80 },
        email: { not: "" },
      },
      select: { id: true, email: true, credits: true },
    });

    // Agents at 0 credits (100% consumed)
    const depletedAgents = await prisma.agent.findMany({
      where: {
        credits: { lte: 0 },
        email: { not: "" },
        // Only agents who were active in the last 30 days
        lastSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { id: true, email: true, credits: true },
    });

    logger.info(
      { lowCredit: lowCreditAgents.length, depleted: depletedAgents.length },
      "Low credits batch cron"
    );

    // Send 80% consumption alerts
    await Promise.allSettled(
      lowCreditAgents.map((a) =>
        a.email
          ? sendEmail80PctAlert(a.email, a.credits, a.id)
          : Promise.resolve()
      )
    );

    // Send depletion alerts
    await Promise.allSettled(
      depletedAgents.map((a) =>
        a.email
          ? sendCreditsDepletedAlert(a.email, a.id)
          : Promise.resolve()
      )
    );
  } catch (err: any) {
    logger.error({ err: err.message }, "Low credits cron failed");
  }
}
