import { logger } from "./logger.js";

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
