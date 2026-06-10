// @ts-nocheck
/**
 * MCP Anonymous-Demo Pool Auto-Top-Off
 *
 * Keeps the mcp-internal demo house account topped up so anonymous MCP
 * first-impression calls never hit an empty wall — with hard guardrails
 * so it can NEVER be drained at unbounded cost.
 *
 * Guardrails (defense in depth — these are the BACKSTOP; per-IP/global
 * daily anon caps in mcp/src/index.ts are the first line of defense):
 *   1. Only tops up when balance < MCP_DEMO_FLOOR (default 1000).
 *   2. Only tops UP TO MCP_DEMO_TARGET (default 5000) — never beyond.
 *   3. HARD monthly ceiling: total auto-topoff per calendar month is
 *      capped at MCP_DEMO_MONTHLY_CAP credits (default 20000). Once hit,
 *      the demo pool simply goes dry until next month. Paying users are
 *      unaffected.
 *
 * Month-to-date accounting is derived from AuditLog rows
 * (action = "demo_topoff", meta.amount) — no schema migration needed,
 * and every grant is auditable.
 *
 * Wired two ways:
 *   - hourly setInterval in api/src/index.ts (main service)
 *   - manual trigger: npm run demo-topoff (node dist/cron/demoTopoff.js)
 */
import { prisma } from "../lib/prisma.js";
const DEMO_EMAIL = process.env.MCP_DEMO_EMAIL || "mcp-internal@archtools.dev";
const TOPOFF_ACTION = "demo_topoff";
export async function runDemoTopoff() {
    const target = Number(process.env.MCP_DEMO_TARGET || 5000);
    const floor = Number(process.env.MCP_DEMO_FLOOR || 1000);
    const monthlyCap = Number(process.env.MCP_DEMO_MONTHLY_CAP || 20000);
    if (!(target > 0) || !(floor > 0) || !(monthlyCap > 0) || floor > target) {
        console.log(`[demo-topoff] disabled or misconfigured (target=${target} floor=${floor} cap=${monthlyCap}) — skipping`);
        return;
    }
    const agent = await prisma.agent.findUnique({
        where: { email: DEMO_EMAIL },
        select: { id: true, credits: true },
    });
    if (!agent) {
        console.log(`[demo-topoff] demo account ${DEMO_EMAIL} not found — skipping`);
        return;
    }
    if (agent.credits >= floor) {
        console.log(`[demo-topoff] balance ${agent.credits} >= floor ${floor} — no top-off needed`);
        return;
    }
    // Month-to-date auto-topoff total (calendar month, UTC)
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const rows = await prisma.auditLog.findMany({
        where: { action: TOPOFF_ACTION, createdAt: { gte: startOfMonth } },
        select: { meta: true },
    });
    const monthToDate = rows.reduce((sum, r) => sum + (Number(r.meta?.amount) || 0), 0);
    const headroom = monthlyCap - monthToDate;
    if (headroom <= 0) {
        console.log(`[demo-topoff] REFUSED: monthly cap reached (${monthToDate}/${monthlyCap} this month) — demo pool dry until next month`);
        return;
    }
    const wanted = target - agent.credits; // never exceeds target
    const amount = Math.min(wanted, headroom); // never exceeds monthly cap
    if (amount <= 0) {
        console.log(`[demo-topoff] nothing to grant (wanted=${wanted} headroom=${headroom})`);
        return;
    }
    const after = agent.credits + amount;
    await prisma.$transaction([
        prisma.agent.update({
            where: { id: agent.id },
            data: { credits: { increment: amount } },
        }),
        prisma.auditLog.create({
            data: {
                agentId: agent.id,
                action: TOPOFF_ACTION,
                resource: "mcp-demo-pool",
                status: "success",
                meta: {
                    amount,
                    before: agent.credits,
                    after,
                    monthToDateBefore: monthToDate,
                    monthToDateAfter: monthToDate + amount,
                    monthlyCap,
                    target,
                    floor,
                },
            },
        }),
    ]);
    console.log(`[demo-topoff] granted ${amount} credits (${agent.credits} -> ${after}); month-to-date ${monthToDate + amount}/${monthlyCap}`);
}
// Allow direct execution: node dist/cron/demoTopoff.js
const isDirectRun = process.argv[1] && process.argv[1].endsWith("demoTopoff.js");
if (isDirectRun) {
    import("dotenv/config").then(() => runDemoTopoff()
        .then(() => prisma.$disconnect())
        .catch(async (e) => {
        console.error("[demo-topoff] failed:", e);
        await prisma.$disconnect();
        process.exit(1);
    }));
}
//# sourceMappingURL=demoTopoff.js.map