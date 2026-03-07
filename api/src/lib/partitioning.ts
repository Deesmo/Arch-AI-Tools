import { logger } from "./logger.js";

/**
 * Partitioning helpers — stub implementation.
 * Table partitioning is not active in the current schema.
 * These no-ops keep the cron jobs importable without error.
 */

export async function isApiRequestLogPartitioned(): Promise<boolean> {
  return false;
}

export async function ensureMonthlyPartitions(): Promise<void> {
  logger.debug("[partitioning] ensureMonthlyPartitions — no-op (partitioning not enabled)");
}

export async function dropOldApiRequestLogPartitions(): Promise<void> {
  logger.debug("[partitioning] dropOldApiRequestLogPartitions — no-op (partitioning not enabled)");
}
