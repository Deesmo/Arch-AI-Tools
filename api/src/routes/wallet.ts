import { Router, Response } from "express";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { config } from "../config.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────
interface WalletProvisionBody {
  label?: string;
}

// ─── POST /v1/wallet/provision ────────────────────────────────────────────────
// Creates a new CDP wallet for an authenticated agent. Persisted to PostgreSQL.
router.post(
  "/provision",
  requireAuth,
  async (req: AuthedRequest, res: Response): Promise<void> => {
    const agentId = req.agent?.id;
    if (!agentId) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    // Check if agent already has a wallet (from DB — persists across restarts)
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { walletAddress: true, walletNetwork: true, walletLabel: true },
    });

    if (agent?.walletAddress) {
      res.status(409).json({
        ok: false,
        error: "wallet_exists",
        message: "Agent already has a provisioned wallet.",
        wallet: {
          address: agent.walletAddress,
          network: agent.walletNetwork ?? "base",
          label: agent.walletLabel ?? "",
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
      const axios = (await import("axios")).default;
      const { axiosHooks } = await import("@coinbase/cdp-sdk/auth");

      const axiosClient = axios.create({
        baseURL: "https://api.cdp.coinbase.com",
        timeout: 15000, // 15s — fail fast, don't hang requests
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

      // Persist wallet to PostgreSQL (survives server restarts and deploys)
      await prisma.agent.update({
        where: { id: agentId },
        data: {
          walletAddress: address,
          walletNetwork: "base",
          walletLabel: label,
          walletProvisionedAt: new Date(),
        },
      });

      logger.info({ agentId, address, network: "base" }, "Wallet provisioned for agent");

      res.status(201).json({
        ok: true,
        wallet: {
          address,
          network: "base",
          label,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      logger.error({ agentId, error: message }, "Failed to provision CDP wallet");

      if (message.includes("Cannot find module") || message.includes("ERR_MODULE_NOT_FOUND")) {
        res.status(503).json({
          ok: false,
          error: "dependency_missing",
          message: "Wallet provisioning requires @coinbase/agentkit. Run npm install first.",
        });
        return;
      }

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

    // Load wallet from DB (persisted across restarts)
    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: {
        walletAddress: true,
        walletNetwork: true,
        walletLabel: true,
        walletProvisionedAt: true,
      },
    });

    if (!agent?.walletAddress) {
      res.status(404).json({
        ok: false,
        error: "no_wallet",
        message: "No wallet provisioned for this agent. POST /v1/wallet/provision to create one.",
      });
      return;
    }

    // USDC on Base mainnet
    const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
    let usdcBalance = "unknown";

    try {
      const { CdpClient } = await import("@coinbase/cdp-sdk");
      const cdp = new CdpClient({
        apiKeyId: config.cdp.apiKeyId,
        apiKeySecret: config.cdp.apiKeySecret,
        walletSecret: config.cdp.walletSecret,
      });

      const result = await cdp.evm.listTokenBalances({
        address: agent.walletAddress as `0x${string}`,
        network: "base",
      });

      // Find USDC entry by contract address
      const usdcEntry = result.balances.find(
        (b: { token: { contractAddress: string }; amount: { amount: bigint; decimals: number } }) =>
          b.token.contractAddress.toLowerCase() === USDC_BASE.toLowerCase()
      );

      if (usdcEntry) {
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
        address: agent.walletAddress,
        network: agent.walletNetwork ?? "base",
        label: agent.walletLabel ?? "",
        createdAt: agent.walletProvisionedAt?.toISOString() ?? new Date().toISOString(),
        usdc_balance: usdcBalance,
      },
    });
  }
);

export default router;
