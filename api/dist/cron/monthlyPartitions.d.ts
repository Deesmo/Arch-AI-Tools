/**
 * Monthly Partition Maintenance (Postgres partitioning optional)
 *
 * If ENABLE_PARTITIONING=true and ApiRequestLog is a partitioned table,
 * this job will:
 *  - Ensure current + next N monthly partitions exist (PARTITION_PRECREATE_MONTHS, default 2)
 *  - Optionally enforce retention by dropping partitions older than LOG_RETENTION_DAYS
 *
 * Intended to run as a Render Cron Job:
 *   Schedule: 30 0 1 * *   (monthly at 00:30 UTC on the 1st)
 *   Command: npm run partitions-ensure
 */
import "dotenv/config";
export declare function runPartitionMaintenance(): Promise<{
    ensured: void;
    dropped: void;
    logDays: number;
    monthsAhead: number;
}>;
//# sourceMappingURL=monthlyPartitions.d.ts.map