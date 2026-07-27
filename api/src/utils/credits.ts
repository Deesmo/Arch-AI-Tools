import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../middleware/auth.js";
import { Response } from "express";
import { fingerprintCaller } from "../lib/fingerprint.js";
import { sendLowCreditAlert, LOW_CREDIT_THRESHOLD } from "../services/email.js";
import { recordAgentCall, updateAgentReputation } from "../services/reputation.js";
import { fireWebhookEvent } from "../services/webhooks.js";
import { classifyStatus } from "./statusClass.js";

// ─── No-charge (empty-result) waiver ─────────────────────────────────────────
// A tool handler that legitimately found nothing (e.g. a search with zero
// results) can waive the charge so agents don't pay for nothing. The request
// still finishes as a 200 SUCCESS row, but the up-front deduction is refunded
// and creditsUsed is logged as 0.
const WAIVE_FLAG = "archToolChargeWaived";
const CHARGE_CTX = "archToolChargeContext";

interface ChargeContext {
  cost: number;
  agent: { credits: number };
}

/**
 * Waive the current request's credit charge (call before sending the 200
 * response). No-op when the request was not charged via deductCredits
 * (e.g. x402-paid — on-chain settlement cannot be refunded here).
 */
export function waiveCharge(res: Response): void {
  const locals = res.locals as Record<string, unknown>;
  locals[WAIVE_FLAG] = true;
  const ctx = locals[CHARGE_CTX] as ChargeContext | undefined;
  if (ctx && !res.headersSent) {
    res.setHeader("X-Credits-Used", "0");
    res.setHeader("X-Credits-Remaining", (ctx.agent.credits + ctx.cost).toString());
  }
}

export function isChargeWaived(res: Response): boolean {
  return (res.locals as Record<string, unknown>)[WAIVE_FLAG] === true;
}

export async function deductCredits(
  req: AuthedRequest,
  res: Response,
  toolName: string,
  cost: number
): Promise<boolean> {
  const requestStartMs = Date.now();
  const agent = req.agent;
  if (!agent) {
    res.status(401).json({ ok: false, error: "unauthorized", request_id: crypto.randomUUID() });
    return false;
  }

  // ATOMIC guarded deduction: decrement only if the row still has >= cost
  // credits. Prevents race-condition overdraft under concurrent requests —
  // the in-memory `agent.credits` check alone is not safe.
  const deduction = await prisma.agent.updateMany({
    where: { id: agent.id, credits: { gte: cost } },
    data: {
      credits: { decrement: cost },
      totalCalls: { increment: 1 },
    },
  });

  if (deduction.count === 0) {
    res.status(402).json({
      ok: false,
      error: "insufficient_credits",
      message: `Insufficient credits. You have ${agent.credits} credits but this tool costs ${cost}. Top up at https://archtools.dev/pricing — or earn 500 bonus credits by referring a friend (see /v1/referral/code).`,
      credits_remaining: agent.credits,
      credits_needed: cost,
      upgrade_url: "https://archtools.dev/pricing",
      referral_url: "https://archtools.dev/v1/referral/code",
      request_id: crypto.randomUUID(),
    });
    return false;
  }

  agent.credits -= cost;
  (res.locals as Record<string, unknown>)[CHARGE_CTX] = { cost, agent } satisfies ChargeContext;

  res.setHeader("X-Credits-Remaining", agent.credits.toString());
  res.setHeader("X-Credits-Used", cost.toString());
  if (agent.credits < 20) {
    res.setHeader("X-Upgrade-URL", "https://archtools.dev/pricing");
  }

  let finalized = false;
  const finalizeCharge = async (responseCompleted: boolean): Promise<void> => {
    if (finalized) return;
    finalized = true;

    // A 2xx status alone is not proof of delivery: if the socket closed before
    // the response body was fully written (client abort), the caller never got
    // a result, so we must refund rather than charge.
    const succeeded = responseCompleted && res.statusCode >= 200 && res.statusCode < 400;
    try {
      if (succeeded) {
        // Empty-result waiver: the call succeeded but found nothing, so the
        // handler asked us not to charge — refund the up-front deduction.
        const waived = isChargeWaived(res);
        if (waived) {
          await prisma.agent.update({
            where: { id: agent.id },
            data: { credits: { increment: cost } },
          });
        }

        const fp = fingerprintCaller(req.headers["user-agent"]);
        await prisma.apiRequest.create({
          data: {
            agentId: agent.id,
            toolName,
            creditsUsed: waived ? 0 : cost,
            status: "SUCCESS",
            statusCode: res.statusCode,
            responseMs: Date.now() - requestStartMs,
            callerType: fp.callerType,
            callerName: fp.callerName,
            callerVersion: fp.callerVersion ?? null,
          },
        });

        const today = new Date().toISOString().slice(0, 10);
        await prisma.dailyUsage.upsert({
          where: { date_toolName: { date: today, toolName } },
          update: { callCount: { increment: 1 } },
          create: { date: today, toolName, callCount: 1 },
        });

        void recordAgentCall(agent.id, true);
        void updateAgentReputation(agent.id);
        return;
      }

      await prisma.agent.update({
        where: { id: agent.id },
        data: {
          credits: { increment: cost },
          totalCalls: { decrement: 1 },
        },
      });

      await logError(agent.id, toolName, 0, res.statusCode, Date.now() - requestStartMs);
    } catch {
      // Non-fatal; never block the response path
    }
  };

  res.once("finish", () => { void finalizeCharge(true); });
  res.once("close", () => { void finalizeCharge(res.writableEnded); });

  if (agent.credits <= LOW_CREDIT_THRESHOLD && agent.credits > 0) {
    prisma.agent.findUnique({ where: { id: agent.id }, select: { email: true } })
      .then(a => { if (a?.email) sendLowCreditAlert(a.email, agent.credits, agent.id).catch(() => {}); })
      .catch(() => {});

    fireWebhookEvent("credits.low", agent.id, {
      credits_remaining: agent.credits,
      tool_name: toolName,
      threshold: LOW_CREDIT_THRESHOLD,
    }).catch(() => {});
  }

  if (agent.credits <= 0) {
    fireWebhookEvent("credits.depleted", agent.id, {
      credits_remaining: 0,
      tool_name: toolName,
      message: "Your credit balance has reached zero. Purchase more at https://archtools.dev/pricing",
    }).catch(() => {});
  }

  return true;
}

export async function logError(
  agentId: string,
  toolName: string,
  cost: number,
  statusCode?: number,
  responseMs?: number
): Promise<void> {
  try {
    await prisma.apiRequest.create({
      data: {
        agentId,
        toolName,
        creditsUsed: cost,
        // Three-way: 4xx = CLIENT_ERROR (caller condition), 5xx or no
        // response = ERROR (real platform failure).
        status: classifyStatus(statusCode),
        statusCode: statusCode ?? null,
        responseMs: responseMs ?? null,
      },
    });

    void recordAgentCall(agentId, false);
    void updateAgentReputation(agentId);

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

export function safeErr(e: unknown): string {
  if (process.env.NODE_ENV === "production") return "An error occurred. Please try again.";
  return String(e);
}
