/**
 * Monthly Free Credit Refresh
 *
 * Grants FREE_MONTHLY_CREDITS to all free-plan agents
 * who haven't received a monthly_free grant in the current month.
 *
 * Render Cron Job setup:
 *   Schedule: 0 0 1 * *  (1st of each month at midnight UTC)
 *   Command: npm run refresh-credits
 *
 * Safe to run multiple times — idempotent via month-based reference.
 */
import "dotenv/config";
//# sourceMappingURL=refreshCredits.d.ts.map