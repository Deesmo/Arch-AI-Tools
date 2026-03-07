"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isApiRequestLogPartitioned = isApiRequestLogPartitioned;
exports.ensureMonthlyPartitions = ensureMonthlyPartitions;
exports.dropOldApiRequestLogPartitions = dropOldApiRequestLogPartitions;
const logger_js_1 = require("./logger.js");
/**
 * Partitioning helpers — stub implementation.
 * Table partitioning is not active in the current schema.
 * These no-ops keep the cron jobs importable without error.
 */
async function isApiRequestLogPartitioned() {
    return false;
}
async function ensureMonthlyPartitions() {
    logger_js_1.logger.debug("[partitioning] ensureMonthlyPartitions — no-op (partitioning not enabled)");
}
async function dropOldApiRequestLogPartitions() {
    logger_js_1.logger.debug("[partitioning] dropOldApiRequestLogPartitions — no-op (partitioning not enabled)");
}
//# sourceMappingURL=partitioning.js.map