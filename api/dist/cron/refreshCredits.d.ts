/**
 * Monthly Free Credit Refresh
 *
 * Resets credits for all free-tier agents to FREE_MONTHLY_CREDITS on the 1st of each month.
 * Render Cron Job: Schedule 0 0 1 * * | Command: node dist/cron/refreshCredits.js
 *
 * Safe to run multiple times — uses updatedAt guard to prevent double-grants in same month.
 */
import "dotenv/config";
//# sourceMappingURL=refreshCredits.d.ts.map