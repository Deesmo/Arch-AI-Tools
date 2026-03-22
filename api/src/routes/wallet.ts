import { Router, Response } from "express";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const router = Router();

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

// Wallet data is persisted in the Agent DB record (walletAddress, walletLabel, walletNetwork, walletCreatedAt)

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

    // Check if agent already has a wallet (from DB)
    const agentRecord = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { walletAddress: true, walletLabel: true, walletNetwork: true, walletCreatedAt: true },
    });
    if (agentRecord?.walletAddress) {
      res.status(409).json({
        ok: false,
        error: "wallet_exists",
        message: "Agent already has a provisioned wallet.",
        wallet: {
          address: agentRecord.walletAddress,
          network: agentRecord.walletNetwork ?? "base",
          label: agentRecord.walletLabel ?? "",
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
        throw new Error(`CDP API returned no address. Response: ${JSON.stringify(response.data)}`);
      }

      const walletRecord: WalletRecord = {
        address,
        network: "base" as any,
        label,
        createdAt: new Date().toISOString(),
      };

      // Persist wallet to database (survives server restarts)
      await prisma.agent.update({
        where: { id: agentId },
        data: {
          walletAddress: address,
          walletLabel: label,
          walletNetwork: "base",
          walletCreatedAt: new Date(),
        },
      });

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

      // Distinguish "module not installed" from actual CDP errors
      if (message.includes("Cannot find module") || message.includes("ERR_MODULE_NOT_FOUND")) {
        res.status(503).json({
          ok: false,
          error: "dependency_missing",
          message: "Wallet provisioning requires @coinbase/agentkit. Run npm install first.",
        });
        return;
      }

      // Expose detailed error temporarily for debugging (remove after fix confirmed)
      const isAxiosError = (err as any)?.response?.data;
      res.status(500).json({
        ok: false,
        error: "wallet_provision_failed",
        message: "Failed to create wallet. Please try again later.",
        _debug_cdp_error: isAxiosError ? JSON.stringify((err as any).response.data).slice(0, 300) : message.slice(0, 300),
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

    // Load wallet from database (persisted across restarts)
    const agentWallet = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { walletAddress: true, walletLabel: true, walletNetwork: true, walletCreatedAt: true },
    });
    const wallet = agentWallet?.walletAddress
      ? { address: agentWallet.walletAddress, label: agentWallet.walletLabel ?? "", network: agentWallet.walletNetwork ?? "base", createdAt: agentWallet.walletCreatedAt?.toISOString() ?? new Date().toISOString() }
      : null;
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
