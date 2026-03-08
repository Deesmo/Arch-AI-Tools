/**
 * Records a cron/system job run to the log.
 * Stub implementation — extend to persist to DB if needed.
 */
export declare function recordJobRun(jobName: string, status: "success" | "error" | string, detail?: string): Promise<void>;
/**
 * Deletes expired OAuth auth codes and tokens.
 * Intended to run on a daily schedule.
 */
export declare function cleanupExpiredOAuthRecords(): Promise<void>;
//# sourceMappingURL=systemJobs.d.ts.map