import { prisma } from "../db.js";

export type JobStatus = "ok" | "error";

export async function recordJobRun(opts: {
  jobName: string;
  status: JobStatus;
  durationMs?: number;
  message?: string;
  meta?: any;
}) {
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
  } catch (err) {
    // Never let job-run tracking fail the actual job
    // eslint-disable-next-line no-console
    console.warn("recordJobRun failed:", (err as any)?.message || err);
  }
}
