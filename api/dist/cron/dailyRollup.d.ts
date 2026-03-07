/**
 * Daily Usage Rollups + Retention
 *
 * Produces daily aggregates from ApiRequestLog into DailyUsageRollup for fast billing reports.
 * Also enforces retention:
 *   - Raw logs: LOG_RETENTION_DAYS (default 30)
 *   - Rollups: ROLLUP_RETENTION_DAYS (default 365)
 *
 * Intended to run as a Render Cron Job:
 *   Schedule: 20 0 * * *   (daily at 00:20 UTC)
 *   Command: npm run rollup-daily
 *
 * Safe to run multiple times — upserts by (day, agentId, apiKeyId, toolName).
 */
import "dotenv/config";
export declare function rollupDay(dayStart: Date): Promise<{
    groups: number;
    dayStart: Date;
    dayEnd: Date;
}>;
export declare function enforceRetention(): Promise<{
    logDays: number;
    rollupDays: number;
    logCutoff: Date;
    rollupCutoff: Date;
    deletedLogs: any;
    deletedRollups: any;
    droppedPartitions: any;
}>;
/**
 * Programmatic entrypoint for admin-triggered or cron-triggered rollups.
 * Rolls up a backfill window of days ending at today (UTC start-of-day).
 */
export declare function runDailyRollup(opts?: {
    daysBack?: number;
}): Promise<{
    ok: boolean;
    daysBack: number;
    rolled_up: any[];
    retention: {
        logDays: number;
        rollupDays: number;
        logCutoff: Date;
        rollupCutoff: Date;
        deletedLogs: any;
        deletedRollups: any;
        droppedPartitions: any;
    };
}>;
//# sourceMappingURL=dailyRollup.d.ts.map