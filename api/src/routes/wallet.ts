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

// ─── In-memory wallet store (swap for DB table when Prisma schema is updated) ─
// Maps agentId → wallet info
const walletStore = new Map<string, WalletRecord>();

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

    // Check if agent already has a wallet
    const existing = walletStore.get(agentId);
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

    try {
      // Use CdpClient via dynamic import (avoids jose ESM/CJS issue)
      // This is the official pattern from Coinbase docs — handles JWT + wallet auth internally
      const { CdpClient } = await import("@coinbase/cdp-sdk");
      const cdp = new CdpClient({
        apiKeyId: config.cdp.apiKeyId,
        apiKeySecret: config.cdp.apiKeySecret,
        walletSecret: config.cdp.walletSecret,
      });
      const account = await cdp.evm.createAccount({ name: label });
      const address = account.address;

      const walletRecord: WalletRecord = {
        address,
        network: "base" as any,
        label,
        createdAt: new Date().toISOString(),
      };

      // Store wallet association
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

    const wallet = walletStore.get(agentId);
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
        const balance = await cdp.evm.listTokenBalances({
          address: wallet.address as `0x${string}`,
          token: USDC_BASE,
          network: "base" as any,
        } as any);
        usdcBalance = balance?.toString() ?? "0";
      } catch {
        // Balance lookup not available or failed — return what we have
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
