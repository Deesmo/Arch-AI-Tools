"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordJobRun = recordJobRun;
const logger_js_1 = require("./logger.js");
/**
 * Records a cron/system job run to the log.
 * Stub implementation — extend to persist to DB if needed.
 */
async function recordJobRun(jobName, status, detail) {
    logger_js_1.logger.info(`[systemJob] ${jobName} → ${status}${detail ? `: ${detail}` : ""}`);
}
//# sourceMappingURL=systemJobs.js.map