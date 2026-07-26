import { logger } from "./logger.js";
import { oauthRefreshCutoff } from "./oauthTokens.js";
import { prisma } from "./prisma.js";

/**
 * Records a cron/system job run to the log.
 * Stub implementation — extend to persist to DB if needed.
 */
export async function recordJobRun(
  jobName: string,
  status: "success" | "error" | string,
  detail?: string
): Promise<void> {
  logger.info(`[systemJob] ${jobName} → ${status}${detail ? `: ${detail}` : ""}`);
}

/**
 * Deletes expired OAuth auth codes and tokens.
 * Intended to run on a daily schedule.
 */
export async function cleanupExpiredOAuthRecords(): Promise<void> {
  const now = new Date();
  // Tokens are only stale once the REFRESH token has outlived its TTL — deleting
  // by the access token's 1h expiresAt would nuke still-valid refresh tokens (#13).
  const refreshCutoff = oauthRefreshCutoff(now);
  try {
    const deletedCodes = await prisma.oAuthAuthCode.deleteMany({
      where: { expiresAt: { lt: now } },
    });
    const deletedTokens = await prisma.oAuthToken.deleteMany({
      where: { createdAt: { lte: refreshCutoff } },
    });
    logger.info(`[cleanup] Deleted ${deletedCodes.count} auth codes, ${deletedTokens.count} tokens`);
  } catch (e) {
    logger.info(`[cleanup] Error: ${String(e)}`);
  }
}
