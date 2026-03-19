/**
 * x402 SDK Middleware — Official Coinbase @x402/express integration (PRIMARY)
 *
 * Uses the official x402 SDK for protocol-compliant payment handling.
 * This is the PRIMARY payment middleware — always active when WALLET_ADDRESS is set.
 * The custom x402.ts middleware remains as fallback for non-CDP networks only.
 *
 * Handles payment verification and settlement via the CDP facilitator for:
 * - Base mainnet (EVM, USDC via EIP-3009)
 * - Polygon mainnet (EVM, USDC via Permit2)
 * - Solana mainnet (SPL USDC)
 */

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
// Bazaar + discovery extensions disabled — they cause dynamic import blocking on every request
// import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions";
import { createFacilitatorConfig } from "@coinbase/x402";
import { config } from "../config.js";
import { X402_PRICES, TOOL_OUTPUT_SCHEMAS } from "./x402.js";
import type { Request, Response, NextFunction } from "express";

// Solana mainnet CAIP-2 identifier
const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

// ─── Build x402 SDK route config from our pricing table ──────────────────────

function buildSdkRoutes(): Record<string, any> {
  const evmWallet = config.x402.walletAddress;
  const solanaWallet = process.env.SOLANA_WALLET_ADDRESS;
  if (!evmWallet && !solanaWallet) return {};

  const evmNetwork = config.x402.network === "base-sepolia"
    ? "eip155:84532"
    : "eip155:8453"; // Default to Base mainnet

  const routes: Record<string, any> = {};

  for (const [toolName, price] of Object.entries(X402_PRICES)) {
    // Discovery extensions disabled (Bazaar causes blocking dynamic imports)
    // const postDiscovery = declareDiscoveryExtension({...});

    // Build accepts[] array with all supported networks for this tool
    const accepts: any[] = [];

    // EVM: Base mainnet (primary)
    if (evmWallet) {
      accepts.push({
        scheme: "exact",
        price: `$${price}`,
        network: evmNetwork,
        payTo: evmWallet,
        maxTimeoutSeconds: 60,
      });
    }

    // EVM: Polygon (CDP-supported)
    if (evmWallet) {
      accepts.push({
        scheme: "exact",
        price: `$${price}`,
        network: "eip155:137",
        payTo: evmWallet,
        maxTimeoutSeconds: 60,
      });
    }

    // SVM: Solana mainnet (CDP-supported via @x402/svm)
    if (solanaWallet) {
      accepts.push({
        scheme: "exact",
        price: `$${price}`,
        network: SOLANA_MAINNET_CAIP2,
        payTo: solanaWallet,
        maxTimeoutSeconds: 60,
      });
    }

    // Routes are relative to /v1/tools (the mount point in index.ts)
    // app.use("/v1/tools", x402SdkMiddleware) strips the /v1/tools prefix
    const routeKey = `POST /${toolName}`;
    routes[routeKey] = {
      accepts,
      description: `Arch Tools — ${toolName}`,
      // No extensions — Bazaar extension causes blocking dynamic imports per-request
    };
  }

  return routes;
}

// ─── Create and export the SDK middleware ─────────────────────────────────────

let _sdkMiddleware: ((req: Request, res: Response, next: NextFunction) => Promise<void>) | null = null;
let _initError: string | null = null;
let _resourceServer: x402ResourceServer | null = null;

/**
 * Initialize the x402 SDK middleware.
 * Call this once at startup. Returns true if successful.
 */
export function initX402Sdk(): boolean {
  if (!config.x402.walletAddress) {
    _initError = "WALLET_ADDRESS not configured — x402 SDK disabled";
    console.log(`[x402-sdk] ${_initError}`);
    return false;
  }

  // X402_SDK_ENABLED gate removed — SDK is now always active when WALLET_ADDRESS is set.
  // The SDK is the primary payment middleware; custom x402.ts is fallback only.

  try {
    // Use @coinbase/x402's createFacilitatorConfig for proper CDP JWT auth
    // This handles JWT generation automatically for verify/settle/supported calls
    const hasCdpKeys = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
    let facilitatorClient: HTTPFacilitatorClient;

    if (hasCdpKeys) {
      // CDP facilitator with proper JWT auth via @coinbase/x402
      const cdpConfig = createFacilitatorConfig(
        process.env.CDP_API_KEY_ID!,
        process.env.CDP_API_KEY_SECRET!,
      );
      facilitatorClient = new HTTPFacilitatorClient(cdpConfig);
      console.log(`[x402-sdk] Using CDP facilitator with JWT auth`);
    } else {
      // Fallback to x402.org (testnet only)
      const facilitatorUrl = config.x402.facilitatorUrl || "https://x402.org/facilitator";
      facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
      console.log(`[x402-sdk] Using fallback facilitator: ${facilitatorUrl}`);
    }

    const evmNetwork = config.x402.network === "base-sepolia"
      ? "eip155:84532"
      : "eip155:8453";

    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register(evmNetwork, new ExactEvmScheme())           // Base mainnet
      .register("eip155:137", new ExactEvmScheme())          // Polygon mainnet
      .register(SOLANA_MAINNET_CAIP2, new ExactSvmScheme()); // Solana mainnet (feePayer from CDP /supported)
    // NOTE: Bazaar extension NOT registered — it causes route-level blocking via dynamic import on every request
    // Re-enable only after verifying bazaar doesn't block in this Express setup

    const routes = buildSdkRoutes();
    const routeCount = Object.keys(routes).length;

    if (routeCount === 0) {
      _initError = "No routes configured for x402 SDK";
      console.log(`[x402-sdk] ${_initError}`);
      return false;
    }

    // Use type assertion since our route config matches the SDK's expected shape
    // syncFacilitatorOnStart=false: Lazy init — don't block server startup waiting for CDP.
    // We manually pre-warm the facilitator connection after the server starts listening.
    // See warmX402Sdk() in index.ts which fires 2s after server start.
    _sdkMiddleware = paymentMiddleware(
      routes as any,
      resourceServer,
      undefined, // paywallConfig
      undefined, // paywall provider
      false,     // syncFacilitatorOnStart — lazy, we pre-warm manually in background
    );

    // Store resource server ref for manual pre-warming at startup
    _resourceServer = resourceServer;

    const solanaWallet = process.env.SOLANA_WALLET_ADDRESS;
    console.log(`[x402-sdk] ✅ Initialized with ${routeCount} routes`);
    console.log(`[x402-sdk]    Networks: ${evmNetwork} (Base), eip155:137 (Polygon)${solanaWallet ? `, ${SOLANA_MAINNET_CAIP2} (Solana)` : ''}`);
    console.log(`[x402-sdk]    CDP auth: ${hasCdpKeys ? 'JWT' : 'none (testnet)'}`);
    if (config.x402.walletAddress) console.log(`[x402-sdk]    EVM wallet: ${config.x402.walletAddress.slice(0, 6)}...${config.x402.walletAddress.slice(-4)}`);
    if (solanaWallet) console.log(`[x402-sdk]    Solana wallet: ${solanaWallet.slice(0, 4)}...${solanaWallet.slice(-4)}`);
    return true;
  } catch (err) {
    _initError = `Failed to initialize x402 SDK: ${(err as Error).message}`;
    console.error(`[x402-sdk] ❌ ${_initError}`);
    return false;
  }
}

/**
 * Express middleware that wraps the x402 SDK.
 * If the SDK is not initialized, passes through silently (no-op).
 *
 * When a request has a valid X-PAYMENT header and the SDK processes it,
 * we set req.x402Paid = true so downstream handlers can skip credit deduction.
 */
export function x402SdkMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!_sdkMiddleware) {
    // SDK not enabled — pass through to existing custom middleware
    next();
    return;
  }

  // If the request has an API key/Bearer token, skip x402 — let auth handle it
  const authHeader = req.headers.authorization;
  const apiKey = req.headers["x-api-key"];
  if (authHeader?.startsWith("Bearer ") || apiKey) {
    next();
    return;
  }

  // Let the SDK middleware handle this request.
  // If payment is valid, it calls next() and we mark the request as paid.
  // If payment is missing/invalid, the SDK returns a proper 402 response.
  _sdkMiddleware(req, res, () => {
    // SDK called next() — payment was verified and settled
    (req as Request & { x402Paid?: boolean; x402SdkPaid?: boolean }).x402Paid = true;
    (req as Request & { x402SdkPaid?: boolean }).x402SdkPaid = true;
    next();
  });
}

/**
 * Get SDK initialization status for health checks / admin endpoints.
 */
/**
 * Pre-warm the x402 SDK by triggering the facilitator /supported call in the background.
 * Call this after the server starts listening — fires async, never blocks.
 * This ensures the first real x402 request doesn't pay the CDP init cost (~1-2s).
 */
export async function warmX402Sdk(): Promise<void> {
  if (!_resourceServer) return;
  try {
    // Trigger the facilitator /supported call by making a dummy internal request
    // The SDK caches the response for all future requests
    await (_resourceServer as any).initialize?.();
    console.log("[x402-sdk] Pre-warm complete — CDP /supported fetched");
  } catch (err) {
    // Non-fatal — SDK will re-try on first real request
    console.warn("[x402-sdk] Pre-warm failed (non-fatal):", (err as Error).message);
  }
}

export function getX402SdkStatus(): { enabled: boolean; error: string | null; routeCount: number } {
  const routes = buildSdkRoutes();
  return {
    enabled: _sdkMiddleware !== null,
    error: _initError,
    routeCount: Object.keys(routes).length,
  };
}
