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
import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "../lib/prisma.js";
import { verifyPayment, settlePayment, decodePayment, calculateFee, getSupportedNetworks, } from "../services/facilitator.js";
const router = Router();
/**
 * Authenticate a facilitator provider via API key.
 * Expects: Authorization: Bearer <facilitator_api_key>
 *       or X-Facilitator-Key: <facilitator_api_key>
 */
async function requireFacilitatorAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const facilitatorKey = req.headers["x-facilitator-key"];
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
        // Look up by raw key first (for backward compat), then by hash
        let provider = await prisma.facilitatorProvider.findUnique({
            where: { apiKey },
        });
        if (!provider) {
            // Try hash-based lookup (iterate — in production, use a prefix index)
            const candidates = await prisma.facilitatorProvider.findMany({
                where: { active: true },
                select: { id: true, name: true, apiKeyHash: true, walletAddress: true, feePercent: true, networks: true, apiKey: true },
            });
            for (const c of candidates) {
                if (c.apiKeyHash && await bcrypt.compare(apiKey, c.apiKeyHash)) {
                    provider = await prisma.facilitatorProvider.findUnique({ where: { id: c.id } });
                    break;
                }
            }
        }
        if (!provider || !provider.active) {
            res.status(401).json({ ok: false, error: "invalid_api_key", message: "Invalid or inactive facilitator API key." });
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
    }
    catch (err) {
        console.error("[facilitator] Auth error:", err);
        res.status(500).json({ ok: false, error: "internal_error" });
    }
}
// ─── POST /verify — Verify a payment ─────────────────────────────────────────
router.post("/verify", requireFacilitatorAuth, async (req, res) => {
    try {
        const { payment, paymentDetails } = req.body;
        if (!payment || !paymentDetails) {
            res.status(400).json({
                ok: false,
                error: "missing_fields",
                message: "Required: payment (base64 string), paymentDetails (object with scheme, network, maxAmountRequired, resource, payTo, asset)",
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
            });
            return;
        }
        const provider = req.facilitatorProvider;
        // Check network is supported
        if (!provider.networks.includes(paymentDetails.network)) {
            res.status(400).json({
                ok: false,
                error: "unsupported_network",
                message: `Network ${paymentDetails.network} is not enabled for your account. Supported: ${provider.networks.join(", ")}`,
            });
            return;
        }
        // Verify the payment
        const result = await verifyPayment(payment, paymentDetails, provider.id);
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
        });
    }
    catch (err) {
        console.error("[facilitator] Verify error:", err);
        res.status(500).json({ ok: false, error: "verification_error", message: err.message });
    }
});
// ─── POST /settle — Settle a verified payment on-chain ────────────────────────
router.post("/settle", requireFacilitatorAuth, async (req, res) => {
    try {
        const { payment, paymentDetails } = req.body;
        if (!payment || !paymentDetails) {
            res.status(400).json({
                ok: false,
                error: "missing_fields",
                message: "Required: payment (base64 string), paymentDetails (object)",
            });
            return;
        }
        const provider = req.facilitatorProvider;
        // Settle on-chain
        const result = await settlePayment(payment, paymentDetails);
        // Calculate and record fee
        const feeAmount = calculateFee(paymentDetails.maxAmountRequired, provider.feePercent);
        const amountFloat = parseFloat(paymentDetails.maxAmountRequired) / 1_000_000; // USDC has 6 decimals
        const feeFloat = parseFloat(feeAmount) / 1_000_000;
        if (result.success) {
            // Update the payment record
            const decoded = decodePayment(payment);
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
            if (!existing) {
                await prisma.facilitatorPayment.create({
                    data: {
                        providerId: provider.id,
                        paymentPayload: payment,
                        resource: paymentDetails.resource,
                        amount: paymentDetails.maxAmountRequired,
                        token: "USDC",
                        network: paymentDetails.network,
                        payerAddress: decoded?.payload?.authorization?.from || null,
                        txHash: result.txHash,
                        feeAmount,
                        status: "settled",
                        verifiedAt: new Date(),
                        settledAt: new Date(),
                    },
                }).catch((err) => console.error("[facilitator] Failed to create payment record:", err));
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
        }
        else {
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
            }).catch(() => { });
        }
        res.json({
            ok: result.success,
            success: result.success,
            txHash: result.txHash || undefined,
            network: result.network || undefined,
            error: result.errorMessage || undefined,
            fee: {
                amount: feeAmount,
                percent: provider.feePercent,
                token: "USDC",
            },
        });
    }
    catch (err) {
        console.error("[facilitator] Settle error:", err);
        res.status(500).json({ ok: false, error: "settlement_error", message: err.message });
    }
});
// ─── POST /register — Register a new provider ────────────────────────────────
router.post("/register", async (req, res) => {
    try {
        const { name, email, walletAddress, webhookUrl, networks, endpoints } = req.body;
        // Validate required fields
        if (!name || !email || !walletAddress) {
            res.status(400).json({
                ok: false,
                error: "missing_fields",
                message: "Required: name, email, walletAddress",
            });
            return;
        }
        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            res.status(400).json({ ok: false, error: "invalid_email", message: "Invalid email address" });
            return;
        }
        // Validate wallet address (EVM)
        if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
            res.status(400).json({ ok: false, error: "invalid_wallet", message: "Wallet address must be a valid EVM address (0x + 40 hex chars)" });
            return;
        }
        // Check if email already registered
        const existing = await prisma.facilitatorProvider.findUnique({ where: { email } });
        if (existing) {
            res.status(409).json({ ok: false, error: "email_exists", message: "This email is already registered as a facilitator provider." });
            return;
        }
        // Generate API key
        const apiKey = `fac_${crypto.randomBytes(32).toString("hex")}`;
        const apiKeyHash = await bcrypt.hash(apiKey, 10);
        // Supported networks (default to Base)
        const supportedNetworks = getSupportedNetworks().map(n => n.network);
        const requestedNetworks = Array.isArray(networks) ? networks.filter((n) => supportedNetworks.includes(n)) : ["eip155:8453"];
        if (requestedNetworks.length === 0) {
            requestedNetworks.push("eip155:8453");
        }
        // Create provider
        const provider = await prisma.facilitatorProvider.create({
            data: {
                name,
                email,
                apiKey,
                apiKeyHash,
                walletAddress,
                webhookUrl: webhookUrl || null,
                networks: requestedNetworks,
                endpoints: endpoints || null,
                feePercent: 1.0, // Default 1% fee
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
        });
    }
    catch (err) {
        console.error("[facilitator] Register error:", err);
        res.status(500).json({ ok: false, error: "internal_error" });
    }
});
// ─── GET /dashboard — Provider payment stats ──────────────────────────────────
router.get("/dashboard", requireFacilitatorAuth, async (req, res) => {
    try {
        const provider = req.facilitatorProvider;
        // Get full provider record with stats
        const providerRecord = await prisma.facilitatorProvider.findUnique({
            where: { id: provider.id },
        });
        if (!providerRecord) {
            res.status(404).json({ ok: false, error: "provider_not_found" });
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
        const dailyStats = {};
        for (const p of recentPayments) {
            const day = p.createdAt.toISOString().slice(0, 10);
            if (!dailyStats[day])
                dailyStats[day] = { count: 0, revenue: 0, settled: 0, failed: 0 };
            dailyStats[day].count += 1;
            dailyStats[day].revenue += parseFloat(p.amount || "0") / 1_000_000;
            if (p.status === "settled")
                dailyStats[day].settled += 1;
            if (p.status === "failed")
                dailyStats[day].failed += 1;
        }
        // Fill 30-day series
        const dailyRevenue = [];
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
        const resourceCounts = {};
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
        });
    }
    catch (err) {
        console.error("[facilitator] Dashboard error:", err);
        res.status(500).json({ ok: false, error: "internal_error" });
    }
});
// ─── GET /networks — List supported networks ──────────────────────────────────
router.get("/networks", (_req, res) => {
    res.json({
        ok: true,
        networks: getSupportedNetworks(),
        facilitatorUrl: `${process.env.PUBLIC_SITE_URL || "https://archtools.dev"}/api/v1/facilitator`,
    });
});
// ─── GET /health — Health check ───────────────────────────────────────────────
router.get("/health", async (_req, res) => {
    const hasPrivateKey = !!process.env.FACILITATOR_PRIVATE_KEY;
    const hasDatabase = true; // If we got here, Express is up
    let redisOk = false;
    try {
        const { redis } = await import("../lib/redis.js");
        if (redis) {
            await redis.ping();
            redisOk = true;
        }
    }
    catch { /* */ }
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
    });
});
export default router;
//# sourceMappingURL=facilitator.js.map