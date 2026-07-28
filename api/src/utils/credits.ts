import { prisma } from "../lib/prisma.js";
import { AuthedRequest } from "../middleware/auth.js";
import { Response } from "express";
import { fingerprintCaller } from "../lib/fingerprint.js";
import { sendLowCreditAlert, sendCreditsDepletedAlert, LOW_CREDIT_THRESHOLD } from "../services/email.js";
import { recordAgentCall, updateAgentReputation } from "../services/reputation.js";
import { fireWebhookEvent } from "../services/webhooks.js";
import { classifyStatus } from "./statusClass.js";
import { recommendPack, packUrl } from "../lib/creditPacks.js";

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

// ─── Credit-alert dedup: once per depletion cycle ────────────────────────────
// sendLowCreditAlert used to fire on EVERY successful call while the balance
// sat in (0, LOW_CREDIT_THRESHOLD] — up to ~20 duplicate emails as a balance
// drained — and the depleted (0-credit) email was never wired at all (its only
// caller was the never-imported cron/lowCredits.ts). Dedup mirrors the
// demoTopoff AuditLog pattern: each send is recorded as an AuditLog row
// (action below, meta.credits = balance remaining at send time). A new alert
// cycle starts only when the pre-call balance EXCEEDS the recorded one: spends
// only lower the balance and refunds can only restore credits deducted AFTER
// the alert, so a higher pre-call balance proves credits were granted
// (purchase / referral / monthly refresh / verify) since the last alert —
// no instrumentation of the grant paths needed.
export const LOW_ALERT_ACTION = "low_credit_alert";
export const DEPLETED_ALERT_ACTION = "credits_depleted_alert";

/**
 * Pure cycle test: alert again only when the balance seen before this call is
 * strictly ABOVE the balance recorded on the last alert (i.e. a grant landed
 * in between). No prior alert (or unreadable meta) always starts a cycle.
 */
export function isNewAlertCycle(preCallCredits: number, lastRecordedCredits: number | null): boolean {
  if (lastRecordedCredits === null || !Number.isFinite(lastRecordedCredits)) return true;
  return preCallCredits > lastRecordedCredits;
}

async function maybeSendCreditAlert(opts: {
  agentId: string;
  action: string;
  /** Balance before this call's deduction (or the refused balance). */
  preCallCredits: number;
  /** Balance remaining now — recorded for the next cycle check + shown in the email. */
  creditsRemaining: number;
  toolName: string;
  send: (email: string) => Promise<void>;
}): Promise<void> {
  try {
    const last = await prisma.auditLog.findFirst({
      where: { agentId: opts.agentId, action: opts.action },
      orderBy: { createdAt: "desc" },
      select: { meta: true },
    });
    const lastRecorded = last
      ? Number((last.meta as { credits?: unknown } | null)?.credits)
      : null;
    if (!isNewAlertCycle(opts.preCallCredits, lastRecorded)) return;

    // Record BEFORE sending so a concurrent burst collapses to (at worst) the
    // handful of in-flight requests that raced past the check — never one
    // email per call.
    await prisma.auditLog.create({
      data: {
        agentId: opts.agentId,
        action: opts.action,
        resource: opts.toolName,
        status: "success",
        meta: { credits: opts.creditsRemaining, pre_call_credits: opts.preCallCredits },
      },
    });

    const a = await prisma.agent.findUnique({ where: { id: opts.agentId }, select: { email: true } });
    if (a?.email) await opts.send(a.email);
  } catch {
    // Alerts must never block or fail the request path
  }
}

// ─── Activation-source attribution ───────────────────────────────────────────
// The signup success page's opt-in "Run your first call" button tags its
// request with `X-Arch-Source: onboarding` so activation metrics can tell
// guided first calls from organic ones. When a known source is present it is
// recorded as the apiRequest row's callerName (indexed, queryable via the
// existing analytics groupBy) — strictly allowlisted, so arbitrary header
// values can never pollute the fingerprint dataset.
// Map (not a plain object) so lookups like "__proto__" can never resolve.
const ARCH_SOURCE_CALLER = new Map<string, string>([
  ["onboarding", "web-onboarding"],
]);

export function callerNameFromArchSource(headerValue: unknown): string | null {
  if (typeof headerValue !== "string") return null;
  return ARCH_SOURCE_CALLER.get(headerValue.trim().toLowerCase()) ?? null;
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
    // Depleted email at the actual refusal moment — the highest-intent instant
    // to show the purchase path. Once per depletion cycle (maybeSendCreditAlert)
    // and gated to genuinely-low balances so an agent merely under-funded for
    // one expensive tool isn't told its credits "ran out".
    if (agent.credits <= LOW_CREDIT_THRESHOLD) {
      void maybeSendCreditAlert({
        agentId: agent.id,
        action: DEPLETED_ALERT_ACTION,
        preCallCredits: agent.credits,
        creditsRemaining: Math.max(agent.credits, 0),
        toolName,
        send: (email) => sendCreditsDepletedAlert(email, agent.id, Math.max(agent.credits, 0)),
      });
    }

    // Application-level error body only — OAuth/Bearer auth errors and the
    // x402 PAYMENT-REQUIRED shape are separate surfaces and stay untouched.
    // NOTE: one-time packs go to /v1/billing/checkout — /v1/billing/subscribe
    // rejects bare pack ids by design (anti-accidental-subscription guard).
    // recommended_pack = smallest pack covering the SHORTFALL (cost minus the
    // remaining balance — not the full cost, which would oversize the pack for
    // agents that still hold credits); buy_now and X-Upgrade-URL carry the
    // pre-selected pricing URL (?pack= only highlights on the pricing page —
    // purchase requires an explicit click).
    const rec = recommendPack(cost - agent.credits);
    res.setHeader("X-Upgrade-URL", packUrl(rec.id));
    res.status(402).json({
      ok: false,
      error: "insufficient_credits",
      message: `Insufficient credits. You have ${agent.credits} credits but this tool costs ${cost}. Top up at https://archtools.dev/pricing — or earn 500 bonus credits by referring a friend (see /v1/referral/code).`,
      credits_remaining: agent.credits,
      credits_needed: cost,
      recommended_pack: { id: rec.id, credits: rec.credits, price_usd: rec.priceUsd },
      upgrade_url: "https://archtools.dev/pricing",
      referral_url: "https://archtools.dev/v1/referral/code",
      links: {
        buy_now: packUrl(rec.id),
        buy_credits: "https://archtools.dev/pricing",
        checkout_api: 'POST /v1/billing/checkout {"pack":"starter|pro|business"}',
        subscribe_api: 'POST /v1/billing/subscribe {"plan":"starter-monthly|pro-monthly|growth-monthly|business-monthly"}',
        docs: "https://archtools.dev/docs",
      },
      request_id: crypto.randomUUID(),
    });
    return false;
  }

  agent.credits -= cost;
  (res.locals as Record<string, unknown>)[CHARGE_CTX] = { cost, agent } satisfies ChargeContext;

  res.setHeader("X-Credits-Remaining", agent.credits.toString());
  res.setHeader("X-Credits-Used", cost.toString());
  if (agent.credits < 20) {
    // Pre-selected pack URL: smallest pack covering this call's cost (the
    // page only highlights that pack — buying stays an explicit click).
    res.setHeader("X-Upgrade-URL", packUrl(recommendPack(cost).id));
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
        const sourceCaller = callerNameFromArchSource(req.headers["x-arch-source"]);
        await prisma.apiRequest.create({
          data: {
            agentId: agent.id,
            toolName,
            creditsUsed: waived ? 0 : cost,
            status: "SUCCESS",
            statusCode: res.statusCode,
            responseMs: Date.now() - requestStartMs,
            callerType: fp.callerType,
            callerName: sourceCaller ?? fp.callerName,
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
    void maybeSendCreditAlert({
      agentId: agent.id,
      action: LOW_ALERT_ACTION,
      preCallCredits: agent.credits + cost,
      creditsRemaining: agent.credits,
      toolName,
      send: (email) => sendLowCreditAlert(email, agent.credits, agent.id),
    });

    // Webhook consumers dedupe machine-side — event behavior unchanged.
    fireWebhookEvent("credits.low", agent.id, {
      credits_remaining: agent.credits,
      tool_name: toolName,
      threshold: LOW_CREDIT_THRESHOLD,
    }).catch(() => {});
  }

  if (agent.credits <= 0) {
    void maybeSendCreditAlert({
      agentId: agent.id,
      action: DEPLETED_ALERT_ACTION,
      preCallCredits: agent.credits + cost,
      creditsRemaining: Math.max(agent.credits, 0),
      toolName,
      send: (email) => sendCreditsDepletedAlert(email, agent.id, Math.max(agent.credits, 0)),
    });

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
