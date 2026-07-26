/**
 * Facilitator-as-a-Service Routes
 *
 * Arch Tools becomes the x402 facilitator for other API providers.
 * Instead of running their own facilitator, providers register with us
 * and we handle payment verification + settlement.
 *
 * Endpoints:
 *   POST /api/v1/facilitator/verify     — Verify an x402 payment
 *   POST /api/v1/facilitator/settle     — Settle a verified payment on-chain
 *   POST /api/v1/facilitator/register   — Register as a provider
 *   GET  /api/v1/facilitator/dashboard  — Provider payment stats
 *   GET  /api/v1/facilitator/networks   — List supported networks
 *   GET  /api/v1/facilitator/health     — Health check
 */

import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import {
  verifyPayment,
  settlePayment,
  decodePayment,
  calculateFee,
  calculateProviderPayout,
  getDefaultFeePercent,
  getSupportedNetworks,
  type VerifyRequest,
  type SettleRequest,
} from "../services/facilitator.js";
import { requireAdmin } from "../middleware/auth.js";
import { reqId, safeErr } from "../utils/credits.js";
import { validateUrl } from "../lib/ssrf.js";

const router = Router();

// Provider registration is unauthenticated, so it gets a strict per-IP limit to
// prevent bulk provider creation / abuse of the bcrypt-hashing path.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip ?? "unknown",
  message: { ok: false, error: "rate_limited", message: "Too many registration attempts. Try again later." },
});

// ─── Provider Auth Middleware ──────────────────────────────────────────────────

interface FacilitatorRequest extends Request {
  facilitatorProvider?: {
    id: string;
    name: string;
    walletAddress: string;
    feePercent: number;
    networks: string[];
  };
}

/**
 * Authenticate a facilitator provider via API key.
 * Expects: Authorization: Bearer <facilitator_api_key>
 *       or X-Facilitator-Key: <facilitator_api_key>
 */
async function requireFacilitatorAuth(
  req: FacilitatorRequest,
  res: Response,
  next: () => void,
): Promise<void> {
  const authHeader = req.headers.authorization;
  const facilitatorKey = req.headers["x-facilitator-key"] as string | undefined;

  const apiKey = facilitatorKey || (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null);

  if (!apiKey) {
    res.status(401).json({
      ok: false,
      error: "unauthorized",
      message: "Missing facilitator API key. Use Authorization: Bearer <key> or X-Facilitator-Key header.",
    });
    return;
  }

  try {
    // Plaintext keys are no longer stored — hash-based lookup only
    // (iterate — in production, use a prefix index).
    let provider = null;
    const candidates = await prisma.facilitatorProvider.findMany({
      where: { active: true },
      select: { id: true, name: true, apiKeyHash: true, walletAddress: true, feePercent: true, networks: true },
    });

    for (const c of candidates) {
      if (c.apiKeyHash && await bcrypt.compare(apiKey, c.apiKeyHash)) {
        provider = await prisma.facilitatorProvider.findUnique({ where: { id: c.id } });
        break;
      }
    }

    if (!provider || !provider.active) {
      res.status(401).json({ ok: false, error: "invalid_api_key", message: "Invalid or inactive facilitator API key.", request_id: reqId() });
      return;
    }

    req.facilitatorProvider = {
      id: provider.id,
      name: provider.name,
      walletAddress: provider.walletAddress,
      feePercent: provider.feePercent,
      networks: provider.networks,
    };

    next();
  } catch (err) {
    console.error("[facilitator] Auth error:", err);
    res.status(500).json({ ok: false, error: "internal_error", request_id: reqId() });
  }
}

// ─── POST /verify — Verify a payment ─────────────────────────────────────────

router.post("/verify", requireFacilitatorAuth, async (req: FacilitatorRequest, res: Response): Promise<void> => {
  try {
    const { payment, paymentDetails } = req.body as VerifyRequest;

    if (!payment || !paymentDetails) {
      res.status(400).json({
        ok: false,
        error: "missing_fields",
        message: "Required: payment (base64 string), paymentDetails (object with scheme, network, maxAmountRequired, resource, payTo, asset)",
        request_id: reqId(),
      });
      return;
    }

    // Validate paymentDetails
    if (!paymentDetails.scheme || !paymentDetails.network || !paymentDetails.maxAmountRequired ||
        !paymentDetails.resource || !paymentDetails.payTo || !paymentDetails.asset) {
      res.status(400).json({
        ok: false,
        error: "invalid_payment_details",
        message: "paymentDetails must include: scheme, network, maxAmountRequired, resource, payTo, asset",
        request_id: reqId(),
      });
      return;
    }

    const provider = req.facilitatorProvider!;

    // Check network is supported
    if (!provider.networks.includes(paymentDetails.network)) {
      res.status(400).json({
        ok: false,
        error: "unsupported_network",
        message: `Network ${paymentDetails.network} is not enabled for your account. Supported: ${provider.networks.join(", ")}`,
        request_id: reqId(),
      });
      return;
    }

    // Verify the payment
    const result = await verifyPayment(payment, paymentDetails, provider.id, provider.walletAddress);

    // Log the verification attempt
    const decoded = decodePayment(payment);
    if (result.isValid) {
      await prisma.facilitatorPayment.create({
        data: {
          providerId: provider.id,
          paymentPayload: payment,
          resource: paymentDetails.resource,
          amount: paymentDetails.maxAmountRequired,
          token: "USDC",
          network: paymentDetails.network,
          payerAddress: decoded?.payload?.authorization?.from || null,
          status: "verified",
          verifiedAt: new Date(),
        },
      }).catch((err) => console.error("[facilitator] Failed to log verification:", err));
    }

    res.json({
      ok: true,
      isValid: result.isValid,
      invalidReason: result.invalidReason || undefined,
      request_id: reqId(),
    });
  } catch (err) {
    console.error("[facilitator] Verify error:", err);
    res.status(500).json({
      ok: false,
      error: "verification_error",
      message: "Unable to verify payment.",
      request_id: reqId(),
    });
  }
});

// ─── POST /settle — Settle a verified payment on-chain ────────────────────────

router.post("/settle", requireFacilitatorAuth, async (req: FacilitatorRequest, res: Response): Promise<void> => {
  try {
    const { payment, paymentDetails } = req.body as SettleRequest;

    if (!payment || !paymentDetails) {
      res.status(400).json({
        ok: false,
        error: "missing_fields",
        message: "Required: payment (base64 string), paymentDetails (object)",
        request_id: reqId(),
      });
      return;
    }

    const provider = req.facilitatorProvider!;

    // SECURITY (F-06): never settle an unverified payment. If this payment was
    // not already verified (verify→settle flow), verify it now (one-step flow).
    // verifyPayment enforces signature (fail-closed), amount, recipient, expiry,
    // and nonce dedup before we spend gas on-chain.
    const alreadyVerified = await prisma.facilitatorPayment.findFirst({
      where: { providerId: provider.id, paymentPayload: payment, status: "verified" },
    });
    if (!alreadyVerified) {
      const verifyResult = await verifyPayment(payment, paymentDetails, provider.id, provider.walletAddress, {
        allowLocalNonceFallback: true,
      });
      if (!verifyResult.isValid) {
        res.status(400).json({
          ok: false,
          error: "verification_failed",
          invalidReason: verifyResult.invalidReason,
          message: "Payment failed verification and was not settled.",
          request_id: reqId(),
        });
        return;
      }
    }

    // Settle on-chain
    const result = await settlePayment(payment, paymentDetails, provider.walletAddress);

    // Calculate fee — use provider-specific fee or env default.
    // SECURITY (F-07): the settlement amount is the value the payer actually
    // SIGNED (auth.value), NOT the client-supplied paymentDetails.maxAmountRequired,
    // so fee/revenue accounting reflects real funds moved.
    const effectiveFeePercent = provider.feePercent > 0 ? provider.feePercent : getDefaultFeePercent();
    const settledAmount = decodePayment(payment)?.payload?.authorization?.value ?? paymentDetails.maxAmountRequired;
    const { fee: feeAmount, payout: providerPayout } = calculateProviderPayout(
      settledAmount,
      effectiveFeePercent,
    );
    const amountFloat = parseFloat(settledAmount) / 1_000_000; // USDC has 6 decimals
    const feeFloat = parseFloat(feeAmount) / 1_000_000;
    const payoutFloat = parseFloat(providerPayout) / 1_000_000;

    if (result.success) {
      // Update the payment record
      const decoded = decodePayment(payment);
      const today = new Date().toISOString().slice(0, 10);

      await prisma.facilitatorPayment.updateMany({
        where: {
          providerId: provider.id,
          paymentPayload: payment,
          status: "verified",
        },
        data: {
          txHash: result.txHash,
          feeAmount,
          status: "settled",
          settledAt: new Date(),
        },
      }).catch((err) => console.error("[facilitator] Failed to update payment:", err));

      // If no verified record exists (verify + settle in one step), create one
      const existing = await prisma.facilitatorPayment.findFirst({
        where: { providerId: provider.id, paymentPayload: payment },
      });

      let paymentRecordId = existing?.id;

      if (!existing) {
        const created = await prisma.facilitatorPayment.create({
          data: {
            providerId: provider.id,
            paymentPayload: payment,
            resource: paymentDetails.resource,
            amount: settledAmount,
            token: "USDC",
            network: paymentDetails.network,
            payerAddress: decoded?.payload?.authorization?.from || null,
            txHash: result.txHash,
            feeAmount,
            status: "settled",
            verifiedAt: new Date(),
            settledAt: new Date(),
          },
        }).catch((err) => { console.error("[facilitator] Failed to create payment record:", err); return null; });
        paymentRecordId = created?.id;
      }

      // Record granular fee record for revenue tracking
      if (paymentRecordId) {
        await prisma.facilitatorFeeRecord.create({
          data: {
            providerId: provider.id,
            paymentId: paymentRecordId,
            settlementAmount: settledAmount,
            feeAmount,
            feePercent: effectiveFeePercent,
            providerPayout,
            network: paymentDetails.network,
            date: today,
          },
        }).catch((err) => console.error("[facilitator] Failed to create fee record:", err));
      }

      // Update provider stats
      await prisma.facilitatorProvider.update({
        where: { id: provider.id },
        data: {
          totalPayments: { increment: 1 },
          totalRevenue: { increment: amountFloat },
          totalFees: { increment: feeFloat },
        },
      }).catch((err) => console.error("[facilitator] Failed to update provider stats:", err));
    } else {
      // Record the failure
      await prisma.facilitatorPayment.updateMany({
        where: {
          providerId: provider.id,
          paymentPayload: payment,
          status: "verified",
        },
        data: {
          status: "failed",
          errorMessage: result.errorMessage,
        },
      }).catch(() => {});
    }

    res.json({
      ok: result.success,
      success: result.success,
      txHash: result.txHash || undefined,
      network: result.network || undefined,
      error: result.errorMessage || undefined,
      fee: {
        amount: feeAmount,
        percent: effectiveFeePercent,
        token: "USDC",
      },
      providerPayout: result.success ? {
        amount: providerPayout,
        amountUsdc: payoutFloat.toFixed(6),
      } : undefined,
      request_id: reqId(),
    });
  } catch (err) {
    console.error("[facilitator] Settle error:", err);
    res.status(500).json({
      ok: false,
      error: "settlement_error",
      message: "Unable to settle payment.",
      request_id: reqId(),
    });
  }
});

// ─── POST /register — Register a new provider ────────────────────────────────

router.post("/register", registerLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, walletAddress, webhookUrl, networks, endpoints } = req.body;

    // Validate required fields
    if (!name || !email || !walletAddress) {
      res.status(400).json({
        ok: false,
        error: "missing_fields",
        message: "Required: name, email, walletAddress",
        request_id: reqId(),
      });
      return;
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ ok: false, error: "invalid_email", message: "Invalid email address", request_id: reqId() });
      return;
    }

    // Validate wallet address (EVM)
    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({ ok: false, error: "invalid_wallet", message: "Wallet address must be a valid EVM address (0x + 40 hex chars)", request_id: reqId() });
      return;
    }

    if (webhookUrl) {
      try {
        const parsed = new URL(webhookUrl);
        if (parsed.protocol !== "https:") {
          res.status(400).json({ ok: false, error: "invalid_webhook_url", message: "Webhook URL must use HTTPS", request_id: reqId() });
          return;
        }
        await validateUrl(webhookUrl);
      } catch (err) {
        res.status(400).json({
          ok: false,
          error: "invalid_webhook_url",
          message: err instanceof Error ? err.message : "Invalid webhook URL",
          request_id: reqId(),
        });
        return;
      }
    }

    // Check if email already registered
    const existing = await prisma.facilitatorProvider.findUnique({ where: { email } });
    if (existing) {
      res.status(409).json({ ok: false, error: "email_exists", message: "This email is already registered as a facilitator provider.", request_id: reqId() });
      return;
    }

    // Generate API key
    const apiKey = `fac_${crypto.randomBytes(32).toString("hex")}`;
    const apiKeyHash = await bcrypt.hash(apiKey, 10);

    // Supported networks (default to Base)
    const supportedNetworks = getSupportedNetworks().map(n => n.network);
    const requestedNetworks = Array.isArray(networks) ? networks.filter((n: string) => supportedNetworks.includes(n)) : ["eip155:8453"];

    if (requestedNetworks.length === 0) {
      requestedNetworks.push("eip155:8453");
    }

    // Create provider — only the bcrypt hash is persisted; raw key returned ONCE below.
    const provider = await prisma.facilitatorProvider.create({
      data: {
        name,
        email,
        apiKeyHash,
        walletAddress,
        webhookUrl: webhookUrl || null,
        networks: requestedNetworks,
        endpoints: endpoints || null,
        feePercent: getDefaultFeePercent(),  // Default from FACILITATOR_FEE_PERCENT env (2.5%)
      },
    });

    res.status(201).json({
      ok: true,
      provider: {
        id: provider.id,
        name: provider.name,
        email: provider.email,
        walletAddress: provider.walletAddress,
        networks: provider.networks,
        feePercent: provider.feePercent,
        createdAt: provider.createdAt.toISOString(),
      },
      // IMPORTANT: API key is only shown once at registration
      apiKey,
      facilitatorUrl: `${process.env.PUBLIC_SITE_URL || "https://archtools.dev"}/api/v1/facilitator`,
      usage: {
        verify: "POST /api/v1/facilitator/verify",
        settle: "POST /api/v1/facilitator/settle",
        dashboard: "GET /api/v1/facilitator/dashboard",
        docs: `${process.env.PUBLIC_SITE_URL || "https://archtools.dev"}/facilitator`,
      },
      request_id: reqId(),
    });
  } catch (err) {
    console.error("[facilitator] Register error:", err);
    res.status(500).json({ ok: false, error: "internal_error", message: safeErr(err), request_id: reqId() });
  }
});

// ─── GET /dashboard — Provider payment stats ──────────────────────────────────

router.get("/dashboard", requireFacilitatorAuth, async (req: FacilitatorRequest, res: Response): Promise<void> => {
  try {
    const provider = req.facilitatorProvider!;

    // Get full provider record with stats
    const providerRecord = await prisma.facilitatorProvider.findUnique({
      where: { id: provider.id },
    });

    if (!providerRecord) {
      res.status(404).json({ ok: false, error: "provider_not_found", request_id: reqId() });
      return;
    }

    // Get recent payments (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentPayments = await prisma.facilitatorPayment.findMany({
      where: {
        providerId: provider.id,
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    // Aggregate by day
    const dailyStats: Record<string, { count: number; revenue: number; settled: number; failed: number }> = {};
    for (const p of recentPayments) {
      const day = p.createdAt.toISOString().slice(0, 10);
      if (!dailyStats[day]) dailyStats[day] = { count: 0, revenue: 0, settled: 0, failed: 0 };
      dailyStats[day].count += 1;
      dailyStats[day].revenue += parseFloat(p.amount || "0") / 1_000_000;
      if (p.status === "settled") dailyStats[day].settled += 1;
      if (p.status === "failed") dailyStats[day].failed += 1;
    }

    // Fill 30-day series
    const dailyRevenue: Array<{ date: string; count: number; revenue: number; settled: number; failed: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      const stats = dailyStats[day] || { count: 0, revenue: 0, settled: 0, failed: 0 };
      dailyRevenue.push({
        date: day,
        count: stats.count,
        revenue: Math.round(stats.revenue * 1e6) / 1e6,
        settled: stats.settled,
        failed: stats.failed,
      });
    }

    // Top resources by payment count
    const resourceCounts: Record<string, number> = {};
    for (const p of recentPayments) {
      resourceCounts[p.resource] = (resourceCounts[p.resource] || 0) + 1;
    }
    const topResources = Object.entries(resourceCounts)
      .map(([resource, count]) => ({ resource, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    res.json({
      ok: true,
      provider: {
        id: providerRecord.id,
        name: providerRecord.name,
        walletAddress: providerRecord.walletAddress,
        networks: providerRecord.networks,
        feePercent: providerRecord.feePercent,
        active: providerRecord.active,
        createdAt: providerRecord.createdAt.toISOString(),
      },
      stats: {
        totalPayments: providerRecord.totalPayments,
        totalRevenueUsdc: Math.round(providerRecord.totalRevenue * 1e6) / 1e6,
        totalFeesUsdc: Math.round(providerRecord.totalFees * 1e6) / 1e6,
        last30Days: {
          dailyRevenue,
          topResources,
        },
      },
      recentPayments: recentPayments.slice(0, 20).map(p => ({
        id: p.id,
        resource: p.resource,
        amount: p.amount,
        token: p.token,
        network: p.network,
        payerAddress: p.payerAddress,
        txHash: p.txHash,
        feeAmount: p.feeAmount,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
      request_id: reqId(),
    });
  } catch (err) {
    console.error("[facilitator] Dashboard error:", err);
    res.status(500).json({ ok: false, error: "internal_error", request_id: reqId() });
  }
});

// ─── GET /revenue — Admin: Total facilitator fee revenue ──────────────────────

router.get("/revenue", requireAdmin, async (_req: Request, res: Response): Promise<void> => {
  try {
    const period = (_req.query.period as string) ?? "30d";
    const daysBack = period === "7d" ? 7 : period === "90d" ? 90 : period === "all" ? 3650 : 30;
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

    // Aggregate fee records
    const feeRecords = await prisma.facilitatorFeeRecord.findMany({
      where: { createdAt: { gte: cutoff } },
      orderBy: { createdAt: "desc" },
    });

    // By day
    const byDay: Record<string, { fees: number; settlements: number; count: number }> = {};
    // By provider
    const byProvider: Record<string, { fees: number; settlements: number; count: number; name?: string }> = {};

    let totalFees = 0;
    let totalSettlements = 0;

    for (const r of feeRecords) {
      const feeUsdc = parseFloat(r.feeAmount) / 1_000_000;
      const settlementUsdc = parseFloat(r.settlementAmount) / 1_000_000;
      totalFees += feeUsdc;
      totalSettlements += settlementUsdc;

      if (!byDay[r.date]) byDay[r.date] = { fees: 0, settlements: 0, count: 0 };
      byDay[r.date].fees += feeUsdc;
      byDay[r.date].settlements += settlementUsdc;
      byDay[r.date].count += 1;

      if (!byProvider[r.providerId]) byProvider[r.providerId] = { fees: 0, settlements: 0, count: 0 };
      byProvider[r.providerId].fees += feeUsdc;
      byProvider[r.providerId].settlements += settlementUsdc;
      byProvider[r.providerId].count += 1;
    }

    // Enrich provider names
    const providerIds = Object.keys(byProvider);
    if (providerIds.length > 0) {
      const providers = await prisma.facilitatorProvider.findMany({
        where: { id: { in: providerIds } },
        select: { id: true, name: true },
      });
      for (const p of providers) {
        if (byProvider[p.id]) byProvider[p.id].name = p.name;
      }
    }

    // Also get lifetime totals from provider records (fallback if no fee records yet)
    const lifetimeTotals = await prisma.facilitatorProvider.aggregate({
      _sum: { totalFees: true, totalRevenue: true, totalPayments: true },
    });

    res.json({
      ok: true,
      period,
      revenue: {
        total_fees_usdc: Math.round(totalFees * 1e6) / 1e6,
        total_settlements_usdc: Math.round(totalSettlements * 1e6) / 1e6,
        total_transactions: feeRecords.length,
        effective_rate: totalSettlements > 0 ? Math.round((totalFees / totalSettlements) * 10000) / 100 : 0,
      },
      lifetime: {
        total_fees_usdc: Math.round((lifetimeTotals._sum.totalFees ?? 0) * 1e6) / 1e6,
        total_settled_usdc: Math.round((lifetimeTotals._sum.totalRevenue ?? 0) * 1e6) / 1e6,
        total_payments: lifetimeTotals._sum.totalPayments ?? 0,
      },
      by_day: Object.entries(byDay)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, data]) => ({
          date,
          fees_usdc: Math.round(data.fees * 1e6) / 1e6,
          settlements_usdc: Math.round(data.settlements * 1e6) / 1e6,
          transactions: data.count,
        })),
      by_provider: Object.entries(byProvider)
        .sort(([, a], [, b]) => b.fees - a.fees)
        .map(([id, data]) => ({
          provider_id: id,
          name: data.name ?? "unknown",
          fees_usdc: Math.round(data.fees * 1e6) / 1e6,
          settlements_usdc: Math.round(data.settlements * 1e6) / 1e6,
          transactions: data.count,
        })),
      request_id: reqId(),
    });
  } catch (err) {
    console.error("[facilitator] Revenue error:", err);
    res.status(500).json({ ok: false, error: "internal_error", request_id: reqId() });
  }
});

// ─── GET /networks — List supported networks ──────────────────────────────────

router.get("/networks", (_req: Request, res: Response): void => {
  res.json({
    ok: true,
    networks: getSupportedNetworks(),
    facilitatorUrl: `${process.env.PUBLIC_SITE_URL || "https://archtools.dev"}/api/v1/facilitator`,
    request_id: reqId(),
  });
});

// ─── GET /health — Health check ───────────────────────────────────────────────

router.get("/health", async (_req: Request, res: Response): Promise<void> => {
  const hasPrivateKey = !!process.env.FACILITATOR_PRIVATE_KEY;
  const hasDatabase = true; // If we got here, Express is up

  let redisOk = false;
  try {
    const { redis } = await import("../lib/redis.js");
    if (redis) {
      await redis.ping();
      redisOk = true;
    }
  } catch { /* */ }

  const providerCount = await prisma.facilitatorProvider.count({ where: { active: true } }).catch(() => 0);

  res.json({
    ok: true,
    service: "arch-tools-facilitator",
    version: "1.0.0",
    capabilities: {
      verify: true,
      settle: hasPrivateKey,
      networks: getSupportedNetworks().map(n => n.network),
    },
    status: {
      database: hasDatabase,
      redis: redisOk,
      settlement: hasPrivateKey ? "ready" : "disabled (no FACILITATOR_PRIVATE_KEY)",
      activeProviders: providerCount,
    },
    request_id: reqId(),
  });
});

export default router;
