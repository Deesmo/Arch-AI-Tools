import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../middleware/auth.js";
import { Response } from "express";
import { fingerprintCaller } from "../lib/fingerprint.js";
import { sendLowCreditAlert, LOW_CREDIT_THRESHOLD } from "../services/email.js";
import { recordAgentCall, updateAgentReputation } from "../services/reputation.js";
import { fireWebhookEvent } from "../services/webhooks.js";

export async function deductCredits(
  req: AuthedRequest,
  res: Response,
  toolName: string,
  cost: number
): Promise<boolean> {
  const agent = req.agent;
  if (!agent) {
    res.status(401).json({ ok: false, error: "unauthorized", request_id: crypto.randomUUID() });
    return false;
  }

  if (agent.credits < cost) {
    res.status(402).json({
      ok: false,
      error: "insufficient_credits",
      message: `This tool costs ${cost} credits. You have ${agent.credits}. Buy more at https://archtools.dev/pricing`,
      credits_remaining: agent.credits,
      credits_needed: cost,
      request_id: crypto.randomUUID(),
    });
    return false;
  }

  // Deduct credits atomically
  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      credits: { decrement: cost },
      totalCalls: { increment: 1 },
    },
  });

  // Update agent object in-place for use in handler
  agent.credits -= cost;

  // Low credit alert (non-blocking)
  if (agent.credits <= LOW_CREDIT_THRESHOLD && agent.credits > 0) {
    prisma.agent.findUnique({ where: { id: agent.id }, select: { email: true } })
      .then(a => { if (a?.email) sendLowCreditAlert(a.email, agent.credits, agent.id).catch(() => {}); })
      .catch(() => {});
    // Fire credits.low webhook
    fireWebhookEvent("credits.low", agent.id, {
      credits_remaining: agent.credits,
      tool_name: toolName,
      threshold: LOW_CREDIT_THRESHOLD,
    }).catch(() => {});
  }

  // Credits depleted webhook
  if (agent.credits <= 0) {
    fireWebhookEvent("credits.depleted", agent.id, {
      credits_remaining: 0,
      tool_name: toolName,
      message: "Your credit balance has reached zero. Purchase more at https://archtools.dev/pricing",
    }).catch(() => {});
  }

  // Log the request with agent fingerprint
  try {
    const fp = fingerprintCaller(req.headers["user-agent"]);
    await prisma.apiRequest.create({
      data: {
        agentId: agent.id,
        toolName,
        creditsUsed: cost,
        status: "SUCCESS",
        callerType: fp.callerType,
        callerName: fp.callerName,
        callerVersion: fp.callerVersion ?? null,
      },
    });

    // Update daily rollup
    const today = new Date().toISOString().slice(0, 10);
    await prisma.dailyUsage.upsert({
      where: { date_toolName: { date: today, toolName } },
      update: { callCount: { increment: 1 } },
      create: { date: today, toolName, callCount: 1 },
    });

    // KYA: Track success and update reputation (non-blocking)
    void recordAgentCall(agent.id, true);
    void updateAgentReputation(agent.id);
  } catch {
    // Non-fatal — don't block the response
  }

  return true;
}

export async function logError(
  agentId: string,
  toolName: string,
  cost: number
): Promise<void> {
  try {
    await prisma.apiRequest.create({
      data: {
        agentId,
        toolName,
        creditsUsed: cost,
        status: "ERROR",
      },
    });

    // KYA: Track error and update reputation (non-blocking)
    void recordAgentCall(agentId, false);
    void updateAgentReputation(agentId);

    // Fire tool.error webhook (non-blocking)
    fireWebhookEvent("tool.error", agentId, {
      tool_name: toolName,
      credits_charged: cost,
    }).catch(() => {});
  } catch {
    // Non-fatal
  }
}

export function reqId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

// Safe error message — never leak internals in production
export function safeErr(e: unknown): string {
  if (process.env.NODE_ENV === "production") return "An error occurred. Please try again.";
  return String(e);
}
