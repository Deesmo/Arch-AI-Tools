import { logger } from "./logger.js";
/**
 * Partitioning helpers — stub implementation.
 * Table partitioning is not active in the current schema.
 * These no-ops keep the cron jobs importable without error.
 */
export async function isApiRequestLogPartitioned() {
    return false;
}
export async function ensureMonthlyPartitions() {
    logger.debug("[partitioning] ensureMonthlyPartitions — no-op (partitioning not enabled)");
}
export async function dropOldApiRequestLogPartitions() {
    logger.debug("[partitioning] dropOldApiRequestLogPartitions — no-op (partitioning not enabled)");
}
//# sourceMappingURL=partitioning.js.map