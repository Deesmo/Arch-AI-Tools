import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireApiKeyAuth, requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { sendWelcomeEmail, sendAdminAlert } from "../services/email.js";
import { logger } from "../lib/logger.js";
import { config } from "../config.js";
import { stripe } from "../lib/stripe.js";
import Stripe from "stripe";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { SIGNUP_FREE_CREDITS, isDisposableEmail, issueEmailVerification, verifyEmailToken, peekEmailVerifyToken, enforceSignupLimits, recordSignupIp, normalizeEmailIdentity, allowVerificationResend, reissueEmailVerification } from "../lib/verification.js";
import { VERIFY_TOKEN_RE, renderVerifyConfirmPage, renderVerifyActivationPage, renderVerifyErrorPage, renderVerifyResendSentPage } from "../assets/verifyEmailHtml.js";
import { REFERRAL_REWARD } from "../lib/referralReward.js";

const router = Router();

const BILLABLE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);

function stripeSearchLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function cancelStripeSubscriptionsForDeletedAgent(agentId: string, email: string): Promise<number> {
  if (!stripe) return 0;

  const stripeClient = stripe;
  const seen = new Set<string>();
  let canceled = 0;

  const cancelIfBillable = async (subscription: Stripe.Subscription): Promise<void> => {
    if (!subscription.id || seen.has(subscription.id) || !BILLABLE_SUBSCRIPTION_STATUSES.has(subscription.status)) return;
    seen.add(subscription.id);
    await stripeClient.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
    canceled++;
  };

  for await (const subscription of stripeClient.subscriptions.search({
    query: `metadata['agent_id']:'${stripeSearchLiteral(agentId)}'`,
    limit: 100,
  })) {
    await cancelIfBillable(subscription);
  }

  // Stripe search is eventually consistent; a just-created Checkout subscription
  // may not be indexed yet. Fall back to the Checkout customer_email path, but
  // still require matching agent metadata before canceling anything.
  if (email) {
    for await (const customer of stripeClient.customers.list({ email, limit: 100 })) {
      for await (const subscription of stripeClient.subscriptions.list({ customer: customer.id, status: "all", limit: 100 })) {
        if (subscription.metadata?.agent_id === agentId) await cancelIfBillable(subscription);
      }
    }
  }

  return canceled;
}

// POST /v1/agent/register
router.post("/register", async (req: Request, res: Response): Promise<void> => {
  const { name, email: rawEmail, password } = req.body as { name?: string; email?: string; password?: string };
  const email = rawEmail?.toLowerCase().trim();
  if (!email) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "email is required", request_id: reqId() });
    return;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "Invalid email format", request_id: reqId() });
    return;
  }

  if (isDisposableEmail(email)) {
    res.status(400).json({ ok: false, error: "disposable_email", message: "Disposable email addresses are not allowed. Please use a real email address.", request_id: reqId() });
    return;
  }

  try {
    // Check if already registered (use raw to handle corrupted records with null apiKey)
    let existing: { id: string } | null = null;
    try {
      existing = await prisma.agent.findUnique({ where: { email } });
    } catch {
      // Corrupted record (e.g. null apiKey) — check via raw SQL
      const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Agent" WHERE email=${email} LIMIT 1`;
      if (rows.length > 0) existing = rows[0];
    }
    if (existing) {
      res.status(409).json({
        ok: false,
        error: "email_exists",
        message: "Email already registered. Use your existing API key.",
        request_id: reqId(),
      });
      return;
    }

    // Anti-farming: normalized-email identity + per-IP daily signup caps
    const limitBlock = await enforceSignupLimits(email, req.ip);
    if (limitBlock) {
      res.status(limitBlock.status).json({ ok: false, error: limitBlock.error, message: limitBlock.message, request_id: reqId() });
      return;
    }

    const apiKey = `arch_${crypto.randomBytes(24).toString("hex")}`;
    // Security: only the bcrypt hash (saltRounds=10) + 12-char prefix are persisted.
    // The raw key is returned to the user ONCE in this response and never stored.
    const apiKeyPrefix = apiKey.slice(0, 12);
    const apiKeyHash = await bcrypt.hash(apiKey, 10);
    const freeCredits = SIGNUP_FREE_CREDITS;

    const agent = await prisma.agent.create({
      data: {
        apiKeyPrefix,
        apiKeyHash,
        email,
        name: name ?? "",
        // Start at 0 — issueEmailVerification activates the starter allowance
        // immediately and gates the remainder in pendingCredits until email
        // verification. If verification setup fails, the user keeps 0 credits
        // (fail closed), never an unclaimed grant.
        credits: 0,
        // Security (#12): new accounts are ALWAYS free tier. A client-supplied
        // `plan`/`tier` must never self-promote to a paid tier — paid tiers are
        // only ever set by the Stripe subscription webhook (see lib/tiers.ts).
        tier: "free",
      },
    });
    // Count this IP only now that the account actually exists (F-4).
    recordSignupIp(req.ip);

    // Save password hash if provided
    if (password && password.length >= 8) {
      const bcrypt = await import("bcryptjs");
      const passwordHash = await bcrypt.hash(password, 10);
      await prisma.agent.update({ where: { id: agent.id }, data: { passwordHash } });
    }

    // ─── Embedded Wallet Auto-Creation (best-effort, non-fatal) ─────────
    let walletAddress: string | null = null;
    try {
      if (config.cdp.apiKeyId && config.cdp.apiKeySecret) {
        const { axiosHooks } = await import("@coinbase/cdp-sdk/auth");
        const axios = (await import("axios")).default;

        const axiosClient = axios.create({
          baseURL: "https://api.cdp.coinbase.com",
        });

        axiosHooks.withAuth(axiosClient, {
          apiKeyId: config.cdp.apiKeyId,
          apiKeySecret: config.cdp.apiKeySecret,
          walletSecret: config.cdp.walletSecret,
        });

        const walletResp = await axiosClient.post("/platform/v2/evm/accounts", {
          name: `user-${agent.id.slice(0, 8)}`,
        });

        const address = walletResp.data?.address;
        if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
          walletAddress = address;
          await prisma.agent.update({
            where: { id: agent.id },
            data: { walletAddress: address },
          });
          logger.info({ agentId: agent.id, walletAddress: address }, "Embedded wallet created on signup");
        }
      } else {
        logger.debug("CDP keys not configured — skipping auto wallet creation");
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      logger.warn({ agentId: agent.id, error: errMsg }, "Wallet auto-creation failed (non-fatal)");
    }

    // Grant split: starter credits activate immediately (agents can't read
    // email); the rest stays pending until email verification. The whole grant
    // is atomically claimed per normalized identity (SignupIdentity).
    let starterCredits = 0;
    let gatedCredits = 0;
    try {
      const grant = await issueEmailVerification(agent.id, email, freeCredits);
      starterCredits = grant.starter;
      gatedCredits = grant.pending;
    } catch (e) {
      // Fail closed: do NOT grant credits if the verification gate could not be
      // set up. Recovery: POST /v1/agent/verify-email/resend (below) re-issues
      // the token for any unverified account.
      console.error("Verification setup failed (credits remain 0, user can resend via /v1/agent/verify-email/resend):", e);
    }

    res.status(201).json({
      ok: true,
      agent_id: agent.id,
      api_key: apiKey,
      credits: starterCredits,
      pending_credits: gatedCredits,
      email_verification_required: true,
      wallet_address: walletAddress,
      message: starterCredits > 0
        ? `Welcome! ${starterCredits} credits are active now — start calling tools immediately. Verify your email to unlock the remaining ${gatedCredits}.`
        : `Welcome! Check your email to verify your address — your ${gatedCredits} free credits activate on verification.`,
      docs: "https://archtools.dev",
      request_id: reqId(),
    });

    // Create referral code for the new user (non-blocking)
    let referralCode: string | undefined;
    try {
      const code = `ARCH-${crypto.randomBytes(4).toString("hex")}`;
      await prisma.referral.create({
        data: {
          referrerId: agent.id,
          code,
          status: "pending",
          rewardCredits: REFERRAL_REWARD,
        },
      });
      referralCode = code;
    } catch {
      // Non-fatal — referral code creation failed
    }

    // Send welcome email (non-blocking — don't delay the response)
    if (email) {
      sendWelcomeEmail(email, agent.id, apiKey, freeCredits, referralCode).catch(() => {});
      // Admin new signup alert
      sendAdminAlert(
        `👤 New Arch Tools signup — ${email}`,
        `New user registered!\n\nEmail: ${email}\nName: ${name ?? "(not provided)"}\nStarting credits: ${freeCredits}\nReferral code: ${referralCode ?? "N/A"}\nAgent ID: ${agent.id}`
      ).catch(() => {});
    }
  } catch (e) {
    console.error("Register error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// GET /v1/agent/verify-email?token=... — renders a confirm page WITHOUT
// consuming the token. Email-security scanners prefetch GET links from
// inboxes; consuming on GET burned tokens before the human ever clicked.
// The page's Confirm button POSTs the token back (below) to consume it.
router.get("/verify-email", async (req: Request, res: Response): Promise<void> => {
  const token = String(req.query.token ?? "");
  try {
    // Hex-only format gate: rejects garbage early AND guarantees the token is
    // safe to embed in the confirm form (no HTML/attribute injection possible).
    if (!VERIFY_TOKEN_RE.test(token)) {
      res.status(400).send(renderVerifyErrorPage());
      return;
    }
    const peek = await peekEmailVerifyToken(token);
    if (!peek) {
      res.status(400).send(renderVerifyErrorPage());
      return;
    }
    res.send(renderVerifyConfirmPage(token, peek.pendingCredits));
  } catch (e) {
    console.error("verify-email error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// POST /v1/agent/verify-email — consumes the token (atomic single-use) and
// activates pending credits, then renders the credential-free activation
// launchpad. Token accepted from the form body (confirm page) or query string
// (programmatic verifiers).
router.post("/verify-email", async (req: Request, res: Response): Promise<void> => {
  const token = String((req.body?.token ?? req.query.token) ?? "");
  try {
    if (!VERIFY_TOKEN_RE.test(token)) {
      res.status(400).send(renderVerifyErrorPage());
      return;
    }
    const result = await verifyEmailToken(token);
    if (!result) {
      res.status(400).send(renderVerifyErrorPage());
      return;
    }
    res.send(renderVerifyActivationPage(result.creditsActivated));
  } catch (e) {
    console.error("verify-email error:", e);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// POST /v1/agent/verify-email/resend — recovery for expired/lost verification
// links: re-issues the token for an existing UNVERIFIED account and re-sends
// the email. ANTI-ENUMERATION: the response is ALWAYS the same neutral 200
// (JSON for API clients, a script-free HTML page for browser form posts)
// whether the account exists, is already verified, or is inside the resend
// cooldown — nothing about account state is ever revealed. The only non-200s
// are 400 (no usable email supplied) and 429 (rate limit, counted on the
// SUBMITTED email+IP BEFORE any DB read, so it can't leak existence either).
router.post("/verify-email/resend", async (req: Request, res: Response): Promise<void> => {
  const email = String((req.body?.email ?? "")).toLowerCase().trim();
  // Browser form posts (Accept: text/html) get a page; fetch/API clients
  // (Accept: */* or application/json) get JSON — json listed first wins */*.
  const wantsHtml = req.accepts(["json", "html"]) === "html";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ ok: false, error: "invalid_request", message: "A valid email is required.", request_id: reqId() });
    return;
  }
  if (!allowVerificationResend(email, req.ip)) {
    res.status(429).json({ ok: false, error: "rate_limited", message: "Too many resend requests for this email. Try again in an hour.", request_id: reqId() });
    return;
  }
  try {
    // Return value intentionally ignored — the response below is identical
    // for every internal outcome (see anti-enumeration note above).
    await reissueEmailVerification(email);
  } catch (e) {
    // Still neutral: an internal failure must not become an enumeration or
    // availability oracle.
    console.error("verify-email resend error:", e);
  }
  if (wantsHtml) {
    res.send(renderVerifyResendSentPage());
    return;
  }
  res.json({
    ok: true,
    message: "If an unverified account exists for that email, a new verification link has been sent. Check your inbox and spam folder.",
    request_id: reqId(),
  });
});

// GET /v1/agent/usage
router.get("/usage", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const [callsToday, recentActivity] = await Promise.all([
      prisma.apiRequest.count({ where: { agentId: agent.id, createdAt: { gte: new Date(today) } } }),
      prisma.apiRequest.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { toolName: true, creditsUsed: true, status: true, createdAt: true },
      }),
    ]);

    res.json({
      ok: true,
      agent_id: agent.id,
      credits_remaining: agent.credits,
      calls_today: callsToday,
      total_calls: agent.totalCalls,
      tier: agent.tier,
      recent_activity: recentActivity,
      buy_credits: "https://archtools.dev/pricing",
      purchase_history: await prisma.purchase.findMany({
        where: { agentId: agent.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { credits: true, amountCents: true, createdAt: true },
      }).catch(() => []),
      request_id: reqId(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// GET /v1/agent/balance
router.get("/balance", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }
  try {
    const fresh = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { credits: true, tier: true, totalCalls: true, email: true },
    });
    res.json({
      ok: true,
      credits: fresh?.credits ?? agent.credits,
      tier: fresh?.tier ?? agent.tier,
      total_calls: fresh?.totalCalls ?? agent.totalCalls,
      email: fresh?.email ?? agent.email,
      buy_credits: "https://archtools.dev/#pricing",
      request_id: reqId(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /v1/agent/me ────────────────────────────────────────────────────────
// Account snapshot: balance + verification status. Agents need a zero-guess
// way to see whether their credits are active or still pending verification.
router.get("/me", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }
  try {
    const fresh = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { id: true, email: true, name: true, credits: true, pendingCredits: true, emailVerified: true, tier: true, totalCalls: true, createdAt: true },
    });
    if (!fresh) { res.status(404).json({ ok: false, error: "not_found", request_id: reqId() }); return; }

    // Referral surface: the account's shareable code (created at signup). If
    // it's missing (legacy accounts / a failed non-blocking create), both
    // fields are null — clients can call GET /v1/referral/code, which creates
    // one on demand.
    const siteUrl = (process.env.PUBLIC_SITE_URL || "https://archtools.dev").replace(/\/$/, "");
    const myReferral = await prisma.referral.findFirst({
      where: { referrerId: agent.id, referredId: null },
      orderBy: { createdAt: "desc" },
      select: { code: true },
    }).catch(() => null);

    res.json({
      ok: true,
      agent_id: fresh.id,
      email: fresh.email,
      name: fresh.name,
      credits: fresh.credits,
      pending_credits: fresh.pendingCredits,
      email_verified: fresh.emailVerified,
      tier: fresh.tier,
      total_calls: fresh.totalCalls,
      created_at: fresh.createdAt,
      referral_code: myReferral?.code ?? null,
      referral_url: myReferral ? `${siteUrl}/signup?ref=${myReferral.code}` : null,
      referral_reward_credits: REFERRAL_REWARD,
      ...(fresh.emailVerified ? {} : { verify_hint: `Verify your email to activate ${fresh.pendingCredits} pending credits.` }),
      buy_credits: "https://archtools.dev/pricing",
      request_id: reqId(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

export default router;

// ─── POST /v1/agent/keys/rotate ──────────────────────────────────────────────
// Generate a new API key, invalidate the old one. Returns new key ONCE.
router.post("/keys/rotate", requireAuth, requireApiKeyAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }

  try {
    const crypto = await import("crypto");
    const bcrypt = await import("bcryptjs");
    
    const newKey = `arch_${crypto.default.randomBytes(24).toString("hex")}`;
    const newPrefix = newKey.slice(0, 12);
    const newHash = await bcrypt.default.hash(newKey, 10);

    // Only prefix + hash are persisted — the raw key is returned ONCE below.
    await prisma.agent.update({
      where: { id: agent.id },
      data: { apiKeyPrefix: newPrefix, apiKeyHash: newHash },
    });

    res.json({
      ok: true,
      message: "API key rotated successfully. Save this key — it won't be shown again.",
      api_key: newKey,
      prefix: newPrefix,
      request_id: reqId(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "server_error", message: safeErr(err), request_id: reqId() });
  }
});

// ─── DELETE /v1/agent/keys/:prefix ───────────────────────────────────────────
// Revoke a specific API key by prefix (for multi-key accounts in future)
router.delete("/keys/:prefix", requireAuth, requireApiKeyAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  const { prefix } = req.params;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }
  
  // For now, can only revoke own current key prefix (req.agent.apiKey is the
  // caller-presented key verified by requireAuth — plaintext is not stored).
  if (!agent.apiKey?.startsWith(String(prefix))) {
    res.status(403).json({ ok: false, error: "forbidden", message: "Can only revoke your own key", request_id: reqId() });
    return;
  }

  try {
    // Invalidate by clearing the stored hash + prefix — no key can match.
    await prisma.agent.update({
      where: { id: agent.id },
      data: { apiKeyPrefix: null, apiKeyHash: null },
    });

    res.json({ ok: true, message: "API key revoked. Generate a new key via POST /v1/agent/keys/rotate.", request_id: reqId() });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "key_revocation_failed", message: safeErr(err), request_id: reqId() });
  }
});

// ─── DELETE /v1/agent — GDPR Art.17 / CCPA account deletion ──────────────────
// Backs the deletion right promised on the privacy page. Requires the full API key
// (requireApiKeyAuth blocks OAuth-scoped tokens from destroying an account) plus an
// explicit confirmation so it can't fire by accident. Erases all PII + usage logs;
// retains ANONYMIZED financial rows (Purchase / X402Payment) under the GDPR Art.17(3)
// legal-obligation exemption (tax/accounting). Verified 2026-07-27: those tables hold
// NO personal data — Purchase = {agentId, stripeId, paymentIntentId, credits, amount,
// status}; X402Payment = {agentId, toolName, amountUsdc, txHash, network} (card/address
// live only in Stripe, a separate processor with its own deletion; txHash is public
// on-chain). requireApiKeyAuth blocks OAuth-scoped tokens (auth.ts) so only the account
// holder's real API key can trigger this.
router.delete("/", requireAuth, requireApiKeyAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) { res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() }); return; }
  // Body-only confirmation (not a query param — query strings leak into access logs).
  const confirm = (req.body as { confirm?: string })?.confirm;
  if (confirm !== "DELETE") {
    res.status(400).json({
      ok: false,
      error: "confirmation_required",
      message: "Account deletion is permanent. Re-send with body {\"confirm\":\"DELETE\"} to proceed. This erases your profile, keys, and usage history. Financial records are retained in anonymized form as required by tax law.",
      request_id: reqId(),
    });
    return;
  }

  try {
    const email = agent.email ?? "";
    const canceledSubscriptions = await cancelStripeSubscriptionsForDeletedAgent(agent.id, email);
    const result = await prisma.$transaction(async (tx) => {
      const reqs = await tx.apiRequest.deleteMany({ where: { agentId: agent.id } });
      const toks = await tx.oAuthToken.deleteMany({ where: { agentId: agent.id } });
      const codes = await tx.oAuthAuthCode.deleteMany({ where: { agentId: agent.id } });
      // Erase the email suppression record so no plaintext email remains (GDPR erasure
      // wins over the bounded free-signup-again risk).
      const ident = email ? await tx.signupIdentity.deleteMany({ where: { normalizedEmail: normalizeEmailIdentity(email) } }) : { count: 0 };
      // Anonymize the Agent row in place — keeps Purchase/X402Payment FK integrity for
      // financial retention while removing every PII field.
      await tx.agent.update({
        where: { id: agent.id },
        data: {
          email: `deleted-${agent.id}@deleted.invalid`,
          name: null, description: null,
          apiKeyHash: null, apiKeyPrefix: null, passwordHash: null,
          resetToken: null, resetTokenExpiry: null,
          verifyToken: null, verifyTokenExpiry: null,
          walletAddress: null, callbackUrl: null,
          credits: 0, pendingCredits: 0,
          emailVerified: false, isPublic: false,
        },
      });
      const counts = { apiRequests: reqs.count, oauthTokens: toks.count, oauthCodes: codes.count, signupIdentity: ident.count, stripeSubscriptions: canceledSubscriptions };

      // Durable deletion audit trail (GDPR Art.5(2) accountability). Written
      // INSIDE the transaction so a deletion can never commit without its audit
      // row (and vice versa). Contains NO direct identifiers: the agent id is
      // stored only as a SHA-256 hash, and requester evidence carries the auth
      // method plus truncated hashes of the presented key prefix and source IP.
      const audit = await tx.dataDeletionAudit.create({
        data: {
          agentIdHash: crypto.createHash("sha256").update(agent.id).digest("hex"),
          erasedSummary: JSON.stringify({ ...counts, agentRowAnonymized: true }),
          requesterEvidence: JSON.stringify({
            method: "api_key", // requireApiKeyAuth: only the full API key can trigger deletion
            keyPrefixHash: crypto.createHash("sha256").update(agent.apiKey.slice(0, 12)).digest("hex").slice(0, 16),
            ipHash: req.ip ? crypto.createHash("sha256").update(req.ip).digest("hex").slice(0, 16) : null,
            confirm: "DELETE",
          }),
        },
      });

      return { counts, auditId: audit.id };
    });

    // Structured log mirrors the DataDeletionAudit row (no PII — counts + audit id).
    logger.info(`[gdpr] account deleted agent=${agent.id} erased=${JSON.stringify(result.counts)} audit=${result.auditId} at=${new Date().toISOString()}`);

    res.json({
      ok: true,
      message: "Account deleted. Your profile, API keys, OAuth grants, active Stripe subscriptions, and usage history have been erased. Anonymized financial records are retained as required by tax law. This cannot be undone.",
      erased: result.counts,
      deletion_audit_id: result.auditId,
      retained: "anonymized purchase/payment records (tax/accounting compliance — no personal data)",
      request_id: reqId(),
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: "account_deletion_failed", message: safeErr(err), request_id: reqId() });
  }
});
