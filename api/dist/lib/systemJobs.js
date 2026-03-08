"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordJobRun = recordJobRun;
exports.cleanupExpiredOAuthRecords = cleanupExpiredOAuthRecords;
const logger_js_1 = require("./logger.js");
const prisma_js_1 = require("./prisma.js");
/**
 * Records a cron/system job run to the log.
 * Stub implementation — extend to persist to DB if needed.
 */
async function recordJobRun(jobName, status, detail) {
    logger_js_1.logger.info(`[systemJob] ${jobName} → ${status}${detail ? `: ${detail}` : ""}`);
}
/**
 * Deletes expired OAuth auth codes and tokens.
 * Intended to run on a daily schedule.
 */
async function cleanupExpiredOAuthRecords() {
    const now = new Date();
    try {
        const deletedCodes = await prisma_js_1.prisma.oAuthAuthCode.deleteMany({
            where: { expiresAt: { lt: now } },
        });
        const deletedTokens = await prisma_js_1.prisma.oAuthToken.deleteMany({
            where: { expiresAt: { lt: now } },
        });
        logger_js_1.logger.info(`[cleanup] Deleted ${deletedCodes.count} auth codes, ${deletedTokens.count} tokens`);
    }
    catch (e) {
        logger_js_1.logger.info(`[cleanup] Error: ${String(e)}`);
    }
}
//# sourceMappingURL=systemJobs.js.map