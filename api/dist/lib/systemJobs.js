import { logger } from "./logger.js";
import { prisma } from "./prisma.js";
/**
 * Records a cron/system job run to the log.
 * Stub implementation — extend to persist to DB if needed.
 */
export async function recordJobRun(jobName, status, detail) {
    logger.info(`[systemJob] ${jobName} → ${status}${detail ? `: ${detail}` : ""}`);
}
/**
 * Deletes expired OAuth auth codes and tokens.
 * Intended to run on a daily schedule.
 */
export async function cleanupExpiredOAuthRecords() {
    const now = new Date();
    try {
        const deletedCodes = await prisma.oAuthAuthCode.deleteMany({
            where: { expiresAt: { lt: now } },
        });
        const deletedTokens = await prisma.oAuthToken.deleteMany({
            where: { expiresAt: { lt: now } },
        });
        logger.info(`[cleanup] Deleted ${deletedCodes.count} auth codes, ${deletedTokens.count} tokens`);
    }
    catch (e) {
        logger.info(`[cleanup] Error: ${String(e)}`);
    }
}
//# sourceMappingURL=systemJobs.js.map