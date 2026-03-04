import { prisma } from "../db.js";
export async function recordJobRun(opts) {
    const { jobName, status, durationMs, message, meta } = opts;
    try {
        await prisma.systemJobRun.upsert({
            where: { jobName },
            create: {
                jobName,
                lastRunAt: new Date(),
                lastStatus: status,
                lastDurationMs: durationMs ?? null,
                lastMessage: message ?? null,
                meta: meta ?? null,
            },
            update: {
                lastRunAt: new Date(),
                lastStatus: status,
                lastDurationMs: durationMs ?? null,
                lastMessage: message ?? null,
                meta: meta ?? null,
            },
        });
    }
    catch (err) {
        // Never let job-run tracking fail the actual job
        // eslint-disable-next-line no-console
        console.warn("recordJobRun failed:", err?.message || err);
    }
}
//# sourceMappingURL=systemJobs.js.map