/**
 * Free Trial System — v1
 *
 * Provides a lightweight trial activation endpoint that creates accounts
 * with a starter credit balance. When credits hit 0, the existing x402
 * payment middleware handles the payment-required flow automatically.
 *
 * The full registration (/v1/agent/register) already gives FREE_MONTHLY_CREDITS
 * (default 1000). This trial endpoint is for quick, minimal onboarding with
 * a configurable trial credit grant (default 100) — ideal for embedded signups, widget
 * integrations, and partner landing pages.
 */

import { Router, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { logger } from "../lib/logger.js";
import { X402_PRICES } from "../middleware/x402.js";
import crypto from "crypto";
import { SIGNUP_FREE_CREDITS, isDisposableEmail, issueEmailVerification, enforceSignupLimits, recordSignupIp } from "../lib/verification.js";
import bcrypt from "bcryptjs";
import { captureEvent, identifyUser } from "../lib/posthog.js";

const router = Router();

const TRIAL_CREDITS = parseInt(process.env.TRIAL_CREDITS ?? "", 10) || SIGNUP_FREE_CREDITS;

// ─── POST /v1/trial/activate ────────────────────────────────────────────────
// Creates a trial account with TRIAL_CREDITS free credits (default 100). Simpler than full registration.
// Requires only an email. Returns API key + trial info.
router.post("/activate", async (req: Request, res: Response): Promise<void> => {
  const { email: rawEmail, name } = req.body ?? {};
  const email = rawEmail?.toLowerCase().trim();

  if (!email || typeof email !== "string") {
    res.status(400).json({
      ok: false,
      error: "email_required",
      message: "Email is required to activate a trial.",
      request_id: reqId(),
    });
    return;
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    res.status(400).json({
      ok: false,
      error: "invalid_email",
      message: "Invalid email format.",
      request_id: reqId(),
    });
    return;
  }

  if (isDisposableEmail(email)) {
    res.status(400).json({
      ok: false,
      error: "disposable_email",
      message: "Disposable email addresses are not allowed. Please use a real email address.",
      request_id: reqId(),
    });
    return;
  }

  try {
    // Check if already registered
    const existing = await prisma.agent.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({
        ok: false,
        error: "email_exists",
        message: "This email already has an account. Log in at https://archtools.dev/login",
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

    // Create trial account with limited credits
    const apiKey = `arch_${crypto.randomBytes(24).toString("hex")}`;
    const apiKeyPrefix = apiKey.slice(0, 12);
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    // Only prefix + hash are persisted — the raw key is returned ONCE below.
    const agent = await prisma.agent.create({
      data: {
        apiKeyPrefix,
        apiKeyHash,
        email,
        name: name ?? "",
        // Start at 0; grant moves to pendingCredits via issueEmailVerification
        // and only activates on verification. Fail closed if setup throws.
        credits: 0,
        tier: "free",
      },
    });
    // Count this IP only now that the account actually exists (F-4).
    recordSignupIp(req.ip);

    // Grant split: starter credits activate immediately (agents can't read
    // email); the rest stays pending until email verification. The whole grant
    // is atomically claimed per normalized identity (SignupIdentity).
    let starterCredits = 0;
    let gatedCredits = 0;
    try {
      const grant = await issueEmailVerification(agent.id, email, TRIAL_CREDITS);
      starterCredits = grant.starter;
      gatedCredits = grant.pending;
    } catch (e) {
      logger.warn({ agentId: agent.id, error: String(e) }, "Verification setup failed (credits remain 0)");
    }

    logger.info({ agentId: agent.id, email, starterCredits, pendingCredits: gatedCredits }, "Trial account activated (starter credits live, remainder pending verification)");
    captureEvent(agent.id, "trial_activated", { email, starter_credits: starterCredits, pending_credits: gatedCredits });
    identifyUser(agent.id, { email, tier: "free", credits: starterCredits, source: "trial" });

    res.status(201).json({
      ok: true,
      agent_id: agent.id,
      api_key: apiKey,
      credits: starterCredits,
      pending_credits: gatedCredits,
      email_verification_required: true,
      tier: "free",
      message: starterCredits > 0
        ? `Trial created! ${starterCredits} credits are active now — start calling tools immediately. Verify your email to unlock the remaining ${gatedCredits}. When depleted, pay per-call with USDC via x402 or purchase more at https://archtools.dev/pricing`
        : `Trial created! Check your email to verify your address — your ${gatedCredits} free credits activate on verification. When depleted, pay per-call with USDC via x402 or purchase more at https://archtools.dev/pricing`,
      upgrade_url: "https://archtools.dev/pricing",
      docs: "https://archtools.dev/docs",
      request_id: reqId(),
    });
  } catch (e) {
    logger.error({ error: e }, "Trial activation failed");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

// ─── GET /v1/trial/status ───────────────────────────────────────────────────
// Check trial status — credits remaining, whether x402 payment is needed
router.get("/status", requireAuth, async (req: AuthedRequest, res: Response): Promise<void> => {
  const agent = req.agent;
  if (!agent) {
    res.status(401).json({ ok: false, error: "unauthorized", request_id: reqId() });
    return;
  }

  try {
    const fresh = await prisma.agent.findUnique({
      where: { id: agent.id },
      select: { credits: true, tier: true, totalCalls: true, createdAt: true },
    });

    const credits = fresh?.credits ?? agent.credits;
    const needsPayment = credits <= 0;

    const response: Record<string, unknown> = {
      ok: true,
      agent_id: agent.id,
      credits_remaining: credits,
      tier: fresh?.tier ?? agent.tier,
      total_calls: fresh?.totalCalls ?? agent.totalCalls,
      trial_started: fresh?.createdAt,
      needs_payment: needsPayment,
      request_id: reqId(),
    };

    // If credits depleted, include x402 payment info for a sample tool
    if (needsPayment) {
      response.message = "Trial credits depleted. Pay per-call with USDC (x402) or purchase credits.";
      response.upgrade_url = "https://archtools.dev/pricing";
      response.x402_info = {
        description: "When calling any tool without credits, the API returns HTTP 402 with x-payment-details header containing USDC payment instructions.",
        supported_networks: ["Base", "Polygon"],
        example_prices: {
          "web-scrape": X402_PRICES["web-scrape"] ?? "0.005",
          "ai-generate": X402_PRICES["ai-generate"] ?? "0.020",
          "sentiment-analysis": X402_PRICES["sentiment-analysis"] ?? "0.008",
        },
      };

      // Set x402 hint header so agents can detect payment requirement programmatically
      res.setHeader("X-Payment-Required", "true");
      res.setHeader("X-Credits-Remaining", "0");
    }

    res.json(response);
  } catch (e) {
    logger.error({ error: e }, "Failed to get trial status");
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(e), request_id: reqId() });
  }
});

export default router;
