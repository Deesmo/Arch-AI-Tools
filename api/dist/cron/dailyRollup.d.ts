/**
 * Daily Usage Rollup
 *
 * Aggregates ApiRequest rows into DailyUsage for fast reporting.
 * Render Cron Job: Schedule 20 0 * * * | Command: node dist/cron/dailyRollup.js
 *
 * Safe to run multiple times — upserts by (date, toolName).
 */
import "dotenv/config";
//# sourceMappingURL=dailyRollup.d.ts.map