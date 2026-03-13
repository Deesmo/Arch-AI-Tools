// @ts-nocheck
/**
 * Daily Usage Rollup
 *
 * Aggregates ApiRequest rows into DailyUsage for fast reporting.
 * Render Cron Job: Schedule 20 0 * * * | Command: node dist/cron/dailyRollup.js
 *
 * Safe to run multiple times — upserts by (date, toolName).
 */
import "dotenv/config";
import { prisma } from "../lib/prisma.js";
async function main() {
    const today = new Date().toISOString().slice(0, 10);
    const logDays = Number(process.env.LOG_RETENTION_DAYS ?? 30);
    const cutoff = new Date(Date.now() - logDays * 24 * 60 * 60 * 1000);
    // Aggregate today's ApiRequest rows into DailyUsage
    const rows = await prisma.$queryRaw `
    SELECT "toolName", COUNT(*)::int AS "callCount"
    FROM "ApiRequest"
    WHERE "createdAt" >= ${new Date(today)}
    GROUP BY "toolName"
  `;
    let upserted = 0;
    for (const row of rows) {
        await prisma.dailyUsage.upsert({
            where: { date_toolName: { date: today, toolName: row.toolName } },
            update: { callCount: Number(row.callCount) },
            create: { date: today, toolName: row.toolName, callCount: Number(row.callCount) },
        });
        upserted++;
    }
    // Prune old ApiRequest rows beyond retention window
    const deleted = await prisma.apiRequest.deleteMany({
        where: { createdAt: { lt: cutoff } },
    });
    console.log(JSON.stringify({ ok: true, date: today, upserted, deleted_logs: deleted.count }));
}
main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
    console.error("dailyRollup failed:", e);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=dailyRollup.js.map