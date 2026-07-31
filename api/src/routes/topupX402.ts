/**
 * x402 USDC → credits top-up (GROWTH_50 #8) — the card-free path to credits.
 *
 * POST /v1/billing/topup-x402/:tier ($5 / $20 / $50)
 *   1. Agent calls with Authorization: Bearer <api_key> and NO payment header
 *      → 402 + PAYMENT-REQUIRED challenge priced at the tier (requirePayment:
 *      on this route an API key does NOT bypass the gate — the payment IS the
 *      point; auth only establishes WHO the credits belong to).
 *   2. Agent signs and retries with PAYMENT-SIGNATURE (or legacy X-PAYMENT)
 *      plus the same API key. requireAuth identifies the account, then the
 *      EXISTING x402 middleware verifies + settles through the facilitator —
 *      no payment verification is hand-rolled here.
 *   3. On settle success the handler grants credits at a pack-equivalent rate
 *      (lib/x402Topup.ts — routes/billing.ts CREDIT_PACKS is the rate
 *      authority) atomically with a Purchase record, idempotent on the
 *      settlement id (Purchase.stripeId = "x402:<tx-or-nonce>", unique) —
 *      the same dedupe discipline as the Stripe webhook. A replayed or
 *      duplicate settlement can never double-credit.
 *
 * Mounted at /v1/billing ONLY (deliberately NOT on the /webhooks alias that
 * routes/billing.ts also serves). Tier prices ride in as middleware options —
 * X402_PRICES and every advertised price surface are untouched, so
 * scripts/check-price-drift.mjs needs no changes.
 */

import { Router, Request, Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { x402Middleware, extractNonce, X402SettlementInfo } from "../middleware/x402.js";
import { CREDIT_PACKS } from "./billing.js";
import {
  buildTopupTiers,
  topupToolName,
  grantTopupCredits,
  TopupTier,
  TopupGrantDeps,
} from "../lib/x402Topup.js";
import { reqId } from "../utils/credits.js";
import { sendPurchaseConfirmation, sendAdminAlert } from "../services/email.js";
import { fireWebhookEvent } from "../services/webhooks.js";

const router = Router();

const SITE = process.env.PUBLIC_SITE_URL ?? "https://archtools.dev";

/** Tier catalog — derived from the billing pack authority at startup. */
export const TOPUP_TIERS: readonly TopupTier[] = buildTopupTiers(CREDIT_PACKS);

// Paranoid allow-list, mirroring ALLOWED_ONETIME_CREDITS in the Stripe webhook:
// a grant may only ever be one of the amounts this catalog computed at startup.
const ALLOWED_TOPUP_CREDITS = new Set(TOPUP_TIERS.map((t) => t.credits));

// One x402 payment gate per tier, created once at startup (same lifecycle as
// toolMiddleware). Each gate advertises its REAL endpoint as the resource and
// enforces payment even for API-key holders.
const tierGates = new Map<string, ReturnType<typeof x402Middleware>>(
  TOPUP_TIERS.map((t) => [
    t.id,
    x402Middleware(topupToolName(t.id), {
      price: t.usd,
      requirePayment: true,
      resourceUrl: `${SITE}/v1/billing/topup-x402/${t.id}`,
    }),
  ]),
);

type TopupRequest = AuthedRequest & {
  x402Paid?: boolean;
  x402Settlement?: X402SettlementInfo;
};

function tierCatalog(): object[] {
  return TOPUP_TIERS.map((t) => ({
    tier: t.id,
    price_usd: t.amountCents / 100,
    credits: t.credits,
    usd_per_credit: Number((t.amountCents / 100 / t.credits).toFixed(6)),
    endpoint: `/v1/billing/topup-x402/${t.id}`,
  }));
}

function invalidTier(res: Response): void {
  res.status(400).json({
    ok: false,
    error: "invalid_request",
    message: `tier must be one of: ${TOPUP_TIERS.map((t) => t.id).join(", ")}. POST /v1/billing/topup-x402/<tier> with your API key (e.g. /v1/billing/topup-x402/20 for a $20 USDC top-up).`,
    tiers: tierCatalog(),
    request_id: reqId(),
  });
}

// GET /v1/billing/topup-x402 — public tier catalog + how-to (no auth, no payment)
router.get("/topup-x402", (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    description:
      "Top up credits with USDC via x402 — no card needed. POST /v1/billing/topup-x402/:tier with your API key, pay the 402 challenge, credits land on settlement at a pack-equivalent rate.",
    tiers: tierCatalog(),
    auth: "Authorization: Bearer <api_key> (or x-api-key) is required — the credits must land on YOUR account.",
    payment:
      "x402 v2 (PAYMENT-SIGNATURE) or v1 (X-PAYMENT) — USDC on the networks listed in the 402 challenge accepts[].",
    request_id: reqId(),
  });
});

// POST without a tier — answer with the exact corrective call (lost-sale guard,
// same philosophy as billing.ts checkout's pack/plan mixup handling).
router.post("/topup-x402", requireAuth, (_req: Request, res: Response): void => {
  invalidTier(res);
});

/** :tier path param as a plain string ("" when absent/array-shaped). */
function tierParam(req: Request): string {
  const t = (req.params as Record<string, unknown>).tier;
  return typeof t === "string" ? t : "";
}

// Per-request tier dispatch to the pre-built payment gates.
function topupGate(req: Request, res: Response, next: NextFunction): void {
  const gate = tierGates.get(tierParam(req));
  if (!gate) {
    invalidTier(res);
    return;
  }
  void gate(req, res, next);
}

// Real Prisma wiring for the grant core: payment record + credit increment in
// ONE transaction; Purchase.stripeId's unique constraint enforces idempotency.
const grantDeps: TopupGrantDeps = {
  findPurchase: async (dedupeId) =>
    prisma.purchase.findUnique({
      where: { stripeId: dedupeId },
      select: { agentId: true, credits: true },
    }),
  createPurchaseAndCredit: async ({ agentId, dedupeId, credits, amountCents }) => {
    const [, updated] = await prisma.$transaction([
      prisma.purchase.create({
        data: { agentId, stripeId: dedupeId, credits, amountCents, status: "completed" },
      }),
      prisma.agent.update({
        where: { id: agentId },
        data: { credits: { increment: credits } },
      }),
    ]);
    return { balance: updated.credits };
  },
};

// POST /v1/billing/topup-x402/:tier — auth first (WHO), then the x402 gate
// (PAYMENT), then the grant. Order matters: requireAuth must run before the
// gate so a paid request is always attributed to a verified account.
router.post(
  "/topup-x402/:tier",
  requireAuth,
  topupGate,
  async (req: Request, res: Response): Promise<void> => {
    const r = req as TopupRequest;
    const agent = r.agent;
    const tier = TOPUP_TIERS.find((t) => t.id === tierParam(req));
    if (!agent || !tier) {
      // requireAuth + topupGate guarantee both — reaching here is a wiring bug.
      res.status(500).json({ ok: false, error: "internal_error", message: "Top-up context missing after payment gate.", request_id: reqId() });
      return;
    }

    // NEVER grant without a settled payment on THIS request. x402Paid is set by
    // the middleware only after facilitator settle success===true; if the gate
    // was skipped (no WALLET_ADDRESS → Stripe-only mode) we refuse, fail-closed.
    if (r.x402Paid !== true) {
      res.status(503).json({
        ok: false,
        error: "x402_not_configured",
        message: "USDC top-ups are unavailable right now (payment gate inactive). Use card checkout instead: POST /v1/billing/checkout.",
        request_id: reqId(),
      });
      return;
    }

    // Allow-list guard (webhook parity): only startup-computed amounts may grant.
    if (!ALLOWED_TOPUP_CREDITS.has(tier.credits) || tier.credits <= 0) {
      console.error(`[topup-x402] REJECTED grant: credits=${tier.credits} not in allowed set (agent ${agent.id})`);
      sendAdminAlert("⚠️ x402 top-up credit mismatch", `A top-up grant requested an out-of-range credit amount and was NOT credited.\nagent=${agent.id} tier=$${tier.amountCents / 100} credits=${tier.credits}`).catch(() => {});
      res.status(500).json({ ok: false, error: "internal_error", message: "Top-up misconfigured — you were NOT credited. Support has been alerted.", request_id: reqId() });
      return;
    }

    // Idempotency key: on-chain tx hash, else the EIP-3009 nonce (unique per
    // authorization, consumed at settlement). A key-less settle (not expected
    // from CDP) still credits — exactly once for this request — under a random
    // key, with an admin alert for reconciliation.
    const settlement = r.x402Settlement;
    const txHash = settlement?.transaction && settlement.transaction.length > 0 ? settlement.transaction : null;
    const paymentHeader = (req.headers["payment-signature"] ?? req.headers["x-payment"]) as string | undefined;
    const nonce = paymentHeader ? extractNonce(paymentHeader) : null;
    const settlementKey = txHash ?? (nonce ? `nonce:${nonce}` : `unkeyed:${randomUUID()}`);
    if (!txHash && !nonce) {
      sendAdminAlert("⚠️ x402 top-up settled without a dedupe key", `Settle succeeded but returned no transaction hash and the payment carried no nonce.\nagent=${agent.id} tier=$${tier.amountCents / 100} key=${settlementKey}`).catch(() => {});
    }
    const dedupeId = `x402:${settlementKey}`;

    const result = await grantTopupCredits(grantDeps, agent.id, tier, dedupeId);

    if (result.status === "already_credited") {
      res.json({
        ok: true,
        already_credited: true,
        message: "This x402 settlement was already credited to your account — no double-credit.",
        credits_added: 0,
        tx: txHash,
        request_id: reqId(),
      });
      return;
    }

    if (result.status === "conflict") {
      // Same settlement id on a different account — cannot legitimately happen
      // (on-chain nonce consumption blocks replays). Alert loudly, credit nothing.
      console.error(`[topup-x402] CONFLICT: settlement ${dedupeId} already credited to a different agent (caller ${agent.id})`);
      sendAdminAlert("🚨 x402 top-up settlement conflict", `Settlement ${dedupeId} is already credited to a DIFFERENT account than the caller.\ncaller=${agent.id} tx=${txHash ?? "-"} — investigate immediately.`).catch(() => {});
      res.status(409).json({ ok: false, error: "settlement_conflict", message: "This payment is already associated with another account. Contact support.", request_id: reqId() });
      return;
    }

    if (result.status === "failed") {
      // Money moved on-chain but crediting failed — loudest possible alert;
      // tell the agent NOT to pay again.
      console.error(`[topup-x402] CRITICAL: settled but NOT credited — agent=${agent.id} tx=${txHash ?? "-"} dedupe=${dedupeId}: ${result.reason}`);
      sendAdminAlert(
        "🚨 x402 top-up SETTLED but NOT credited",
        `A USDC top-up settled on-chain but the credit grant failed — reconcile manually.\n\nAgent: ${agent.id} (${agent.email})\nTier: $${tier.amountCents / 100} → ${tier.credits.toLocaleString()} credits\nTx: ${txHash ?? "-"}\nDedupe: ${dedupeId}\nError: ${result.reason}`,
      ).catch(() => {});
      res.status(500).json({
        ok: false,
        error: "credit_grant_failed",
        message: `Your payment settled (tx ${txHash ?? "recorded"}) but crediting hit an error. Do NOT pay again — support has been alerted and your credits will be applied.`,
        tx: txHash,
        request_id: reqId(),
      });
      return;
    }

    // Granted. Non-fatal extras: attribute the middleware's X402Payment row to
    // this account, fire the payment webhook, send confirmations.
    if (txHash) {
      prisma.x402Payment
        .updateMany({ where: { txHash, toolName: topupToolName(tier.id), agentId: null }, data: { agentId: agent.id } })
        .catch(() => {});
    }
    fireWebhookEvent("payment.received", agent.id, {
      type: "x402_topup",
      credits_added: result.creditsAdded,
      amount_usd: (tier.amountCents / 100).toFixed(2),
      tx: txHash,
      network: settlement?.network ?? null,
    }).catch(() => {});
    if (agent.email) {
      sendPurchaseConfirmation(agent.email, result.creditsAdded, `USDC Top-Up ($${tier.amountCents / 100})`, result.balance).catch(() => {});
    }
    sendAdminAlert(
      `💰 New Arch Tools sale — $${(tier.amountCents / 100).toFixed(2)} (USDC x402 top-up)`,
      `USDC top-up settled and credited!\n\nCustomer: ${agent.email || agent.id}\nTier: $${tier.amountCents / 100}\nCredits: ${result.creditsAdded.toLocaleString()}\nTx: ${txHash ?? "-"}\nNetwork: ${settlement?.network ?? "-"}\nPayer: ${settlement?.payer ?? "-"}`,
    ).catch(() => {});
    console.log(`[topup-x402] +${result.creditsAdded} credits to agent ${agent.id} ($${tier.amountCents / 100} USDC, tx ${txHash ?? "-"})`);

    res.json({
      ok: true,
      credits_added: result.creditsAdded,
      balance: result.balance,
      amount_usd: tier.amountCents / 100,
      usd_per_credit: Number((tier.amountCents / 100 / tier.credits).toFixed(6)),
      tx: txHash,
      network: settlement?.network ?? null,
      payer: settlement?.payer ?? null,
      request_id: reqId(),
    });
  },
);

export default router;
