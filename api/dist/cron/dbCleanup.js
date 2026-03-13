// @ts-nocheck
/**
 * Weekly DB Cleanup
 * - Deletes API request logs older than 90 days (keeps DB lean)
 * - Logs summary stats
 * Render Cron: Schedule 0 2 * * 0 (Sunday 2am) | Command: npm run db:cleanup
 */
import "dotenv/config";
import { prisma } from "../lib/prisma";
async function main() {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    // Delete old API request logs
    const deleted = await prisma.apiRequest.deleteMany({
        where: { createdAt: { lt: ninetyDaysAgo } }
    });
    // Stats snapshot
    const totalAgents = await prisma.agent.count();
    const activeAgents = await prisma.agent.count({ where: { lastSeenAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } });
    const totalPurchases = await prisma.purchase.count();
    const recentRequests = await prisma.apiRequest.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } });
    console.log(`[db-cleanup] Deleted ${deleted.count} old API logs (>90 days)`);
    console.log(`[db-cleanup] Stats: ${totalAgents} total users | ${activeAgents} active (30d) | ${totalPurchases} purchases | ${recentRequests} requests this week`);
}
main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
    console.error("DB cleanup failed:", e);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=dbCleanup.js.map