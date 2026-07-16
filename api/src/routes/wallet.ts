import { Router, Response } from "express";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const router = Router();
const PROVISIONING_SENTINEL_PREFIX = "pending:";
export const WALLET_PROVISIONING_SENTINEL_TTL_MS = 15 * 60 * 1000;

export function createProvisioningSentinel(agentId: string, nowMs = Date.now()): string {
  return `${PROVISIONING_SENTINEL_PREFIX}${agentId}:${nowMs}`;
}

export function isProvisioningSentinel(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PROVISIONING_SENTINEL_PREFIX);
}

export function isStaleProvisioningSentinel(
  value: string | null | undefined,
  nowMs = Date.now(),
  ttlMs = WALLET_PROVISIONING_SENTINEL_TTL_MS,
): boolean {
  if (!isProvisioningSentinel(value)) return false;
  const timestamp = Number(value!.slice(value!.lastIndexOf(":") + 1));
  return Number.isFinite(timestamp) && nowMs - timestamp > ttlMs;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface WalletProvisionBody {
  label?: string; // optional friendly name for the wallet
}

interface WalletRecord {
  address: string;
  network: string;
  label: string;
  createdAt: string;
}

// ─── In-memory wallet store (swap for DB table when Prisma schema is updated) ─
// Maps agentId → wallet info
const walletStore = new Map<string, WalletRecord>();

// ─── GET /v1/wallet ───────────────────────────────────────────────────────────
// Returns the authenticated user's wallet address (from DB, created at signup).
router.get(
  "/",
  requireAuth,
  async (req: AuthedRequest, res: Response): Promise<void> => {
    const agentId = req.agent?.id;
    if (!agentId) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    try {
      const agent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { walletAddress: true },
      });

      const walletAddress = agent?.walletAddress;
      res.json({
        ok: true,
        wallet_address: isProvisioningSentinel(walletAddress) ? null : walletAddress ?? null,
        provisioning: isProvisioningSentinel(walletAddress),
        network: "base",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ agentId, error: message }, "Failed to fetch wallet");
      res.status(500).json({ ok: false, error: "internal_error" });
    }
  }
);

// ─── POST /v1/wallet/provision ────────────────────────────────────────────────
// Creates a new CDP wallet for an authenticated agent.
// @coinbase/cdp-sdk v1.45 installed. @coinbase/agentkit requires separate install.
router.post(
  "/provision",
  requireAuth,
  async (req: AuthedRequest, res: Response): Promise<void> => {
    const agentId = req.agent?.id;
    if (!agentId) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    // Check if agent already has a wallet (DB first, then in-memory fallback)
    const agentRecord = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { walletAddress: true },
    });
    const existing = agentRecord?.walletAddress
      ? { address: agentRecord.walletAddress, network: "base", label: "" }
      : walletStore.get(agentId);
    if (existing) {
      res.status(409).json({
        ok: false,
        error: "wallet_exists",
        message: "Agent already has a provisioned wallet.",
        wallet: {
          address: existing.address,
          network: existing.network,
          label: existing.label,
        },
      });
      return;
    }

    // Validate CDP config is present
    if (!config.cdp.apiKeyId || !config.cdp.apiKeySecret || !config.cdp.walletSecret) {
      logger.error("CDP API keys or wallet secret not configured — cannot provision wallet");
      res.status(503).json({
        ok: false,
        error: "cdp_not_configured",
        message: "Wallet provisioning is not yet available. CDP keys or wallet secret not configured.",
      });
      return;
    }

    const body = req.body as WalletProvisionBody;
    const label = body.label?.slice(0, 64) ?? `agent-${agentId.slice(0, 8)}`;

    // Atomically claim the provisioning slot BEFORE calling the CDP API so two
    // concurrent requests cannot both create a wallet (TOCTOU). Only the request
    // that flips walletAddress null→sentinel proceeds; it is overwritten with the
    // real address on success, or reset to null on failure.
    const provisioningSentinel = createProvisioningSentinel(agentId);
    const claim = await prisma.agent.updateMany({
      where: { id: agentId, walletAddress: null },
      data: { walletAddress: provisioningSentinel },
    });
    if (claim.count !== 1) {
      const cur = await prisma.agent.findUnique({ where: { id: agentId }, select: { walletAddress: true } });
      if (cur?.walletAddress && isStaleProvisioningSentinel(cur.walletAddress)) {
        const released = await prisma.agent.updateMany({
          where: { id: agentId, walletAddress: cur.walletAddress },
          data: { walletAddress: null },
        });
        if (released.count === 1) {
          res.status(409).json({
            ok: false,
            error: "wallet_provision_stale",
            message: "A previous wallet provisioning attempt expired. Please retry.",
          });
          return;
        }
      }
      const hasReal = cur?.walletAddress && !isProvisioningSentinel(cur.walletAddress);
      res.status(409).json({
        ok: false,
        error: "wallet_exists",
        message: "Agent already has a provisioned wallet (or one is being provisioned).",
        wallet: hasReal ? { address: cur!.walletAddress, network: "base", label: "" } : undefined,
      });
      return;
    }

    try {
      // Use axiosHooks from cdp-sdk/auth subpath (proven working — same import as x402.ts)
      // axiosHooks.withAuth handles Bearer JWT + Wallet Auth JWT internally — no manual headers
      const axios = (await import("axios")).default;
      const { axiosHooks } = await import("@coinbase/cdp-sdk/auth");

      const axiosClient = axios.create({
        baseURL: "https://api.cdp.coinbase.com",
      });

      axiosHooks.withAuth(axiosClient, {
        apiKeyId: config.cdp.apiKeyId,
        apiKeySecret: config.cdp.apiKeySecret,
        walletSecret: config.cdp.walletSecret,
      });

      const response = await axiosClient.post("/platform/v2/evm/accounts", {
        name: label,
      });

      const address = response.data?.address;
      if (!address) {
        throw new Error("CDP API returned no wallet address");
      }

      const walletRecord: WalletRecord = {
        address,
        network: "base" as any,
        label,
        createdAt: new Date().toISOString(),
      };

      // Persist the real wallet address before caching or reporting success. If
      // this fails after the external CDP call, returning 201 would lose the
      // wallet on restart and leave the account stuck on the pending sentinel.
      const persisted = await prisma.agent.updateMany({
        where: { id: agentId, walletAddress: provisioningSentinel },
        data: { walletAddress: address },
      });
      if (persisted.count !== 1) {
        throw new Error("Wallet provisioning claim was lost before persistence");
      }
      walletStore.set(agentId, walletRecord);

      logger.info({ agentId, address, network: "base" as any }, "Wallet provisioned for agent");

      res.status(201).json({
        ok: true,
        wallet: {
          address,
          network: "base" as any,
          label,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ agentId, error: message }, "Failed to provision CDP wallet");

      // Release the provisioning claim so the agent can retry (only if we still
      // hold the sentinel — never clobber a real address written concurrently).
      await prisma.agent.updateMany({
        where: { id: agentId, walletAddress: provisioningSentinel },
        data: { walletAddress: null },
      }).catch(() => {});

      // Distinguish "module not installed" from actual CDP errors
      if (message.includes("Cannot find module") || message.includes("ERR_MODULE_NOT_FOUND")) {
        res.status(503).json({
          ok: false,
          error: "dependency_missing",
          message: "Wallet provisioning requires @coinbase/agentkit. Run npm install first.",
        });
        return;
      }

      res.status(500).json({
        ok: false,
        error: "wallet_provision_failed",
        message: "Failed to create wallet. Please try again later.",
      });
    }
  }
);

// ─── GET /v1/wallet/status ────────────────────────────────────────────────────
// Returns wallet address + USDC balance for the authenticated agent.
router.get(
  "/status",
  requireAuth,
  async (req: AuthedRequest, res: Response): Promise<void> => {
    const agentId = req.agent?.id;
    if (!agentId) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    // Check in-memory cache first, then fall back to DB
    let wallet = walletStore.get(agentId);
    if (!wallet) {
      const dbAgent = await prisma.agent.findUnique({
        where: { id: agentId },
        select: { walletAddress: true, createdAt: true },
      });
      if (dbAgent?.walletAddress && !isProvisioningSentinel(dbAgent.walletAddress)) {
        wallet = {
          address: dbAgent.walletAddress,
          network: "base",
          label: `agent-${agentId.slice(0, 8)}`,
          createdAt: dbAgent.createdAt.toISOString(),
        };
        walletStore.set(agentId, wallet); // repopulate cache
      }
    }
    if (!wallet) {
      res.status(404).json({
        ok: false,
        error: "no_wallet",
        message: "No wallet provisioned for this agent. POST /v1/wallet/provision to create one.",
      });
      return;
    }

    try {
      // Try to fetch on-chain USDC balance via CDP SDK
      const { CdpClient } = await import("@coinbase/cdp-sdk");

      const cdp = new CdpClient({
        apiKeyId: config.cdp.apiKeyId,
        apiKeySecret: config.cdp.apiKeySecret,
        walletSecret: config.cdp.walletSecret,
      });

      // USDC on Base contract address
      const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

      // Attempt to read balance — if CDP SDK doesn't support this directly,
      // fall back to returning wallet info without balance
      let usdcBalance = "unknown";
      try {
        const result = await cdp.evm.listTokenBalances({
          address: wallet.address as `0x${string}`,
          network: "base",
        });

        // Find USDC entry by contract address
        const usdcEntry = result.balances.find(
          (b: { token: { contractAddress: string }; amount: { amount: bigint; decimals: number } }) =>
            b.token.contractAddress.toLowerCase() === USDC_BASE.toLowerCase()
        );

        if (usdcEntry) {
          // amount.amount is bigint in atomic units; decimals is 6 for USDC
          const raw = BigInt(String(usdcEntry.amount.amount));
          const decimals = usdcEntry.amount.decimals;
          const divisor = BigInt(10 ** decimals);
          const whole = raw / divisor;
          const remainder = raw % divisor;
          const remainderStr = remainder.toString().padStart(decimals, "0");
          usdcBalance = `${whole}.${remainderStr}`;
        } else {
          usdcBalance = "0.000000";
        }

        console.log("[wallet/status] USDC balance:", usdcBalance, "tokens found:", result.balances.length);
      } catch (e) {
        console.error("[wallet/status] Balance lookup failed:", e);
        usdcBalance = "unavailable";
      }

      res.json({
        ok: true,
        wallet: {
          address: wallet.address,
          network: wallet.network,
          label: wallet.label,
          createdAt: wallet.createdAt,
          usdc_balance: usdcBalance,
        },
      });
    } catch (err: unknown) {
      // If CDP SDK not installed, return wallet info without balance
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("Cannot find module") || message.includes("ERR_MODULE_NOT_FOUND")) {
        res.json({
          ok: true,
          wallet: {
            address: wallet.address,
            network: wallet.network,
            label: wallet.label,
            createdAt: wallet.createdAt,
            usdc_balance: "unavailable (cdp-sdk not installed)",
          },
        });
        return;
      }

      logger.error({ agentId, error: message }, "Failed to fetch wallet status");
      res.status(500).json({
        ok: false,
        error: "status_check_failed",
        message: "Could not retrieve wallet status.",
      });
    }
  }
);

export default router;
// CDP_WALLET_SECRET updated Sun Mar 22 00:40:43 EDT 2026
// env vars updated: Sun Mar 22 12:29:21 EDT 2026
