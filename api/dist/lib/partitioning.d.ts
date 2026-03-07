/**
 * Partitioning helpers — stub implementation.
 * Table partitioning is not active in the current schema.
 * These no-ops keep the cron jobs importable without error.
 */
export declare function isApiRequestLogPartitioned(): Promise<boolean>;
export declare function ensureMonthlyPartitions(): Promise<void>;
export declare function dropOldApiRequestLogPartitions(): Promise<void>;
//# sourceMappingURL=partitioning.d.ts.map