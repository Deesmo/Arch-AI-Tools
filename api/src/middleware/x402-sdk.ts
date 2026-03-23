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
// Bazaar discovery extensions — static import (evaluated once at startup, zero per-request overhead)
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";
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
    // Bazaar discovery declarations built per-tool below in buildSdkRoutes();

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
    const routeKey = `POST /${toolName}`;
    // Build Bazaar discovery metadata from TOOL_OUTPUT_SCHEMAS
    const schema = TOOL_OUTPUT_SCHEMAS[toolName];
    const extensions: Record<string, any> = {};
    if (schema) {
      const discoveryConfig: any = {
        output: {
          example: { result: "success", data: {} },
          schema: schema.output || { type: "object" },
        },
      };
      if (schema.input?.bodyFields) {
        discoveryConfig.input = { example: {}, schema: { properties: schema.input.bodyFields, type: "object" } };
        discoveryConfig.bodyType = "json";
      }
      Object.assign(extensions, declareDiscoveryExtension(discoveryConfig));
    }
    routes[routeKey] = {
      accepts,
      description: `Arch Tools — ${toolName}`,
      extensions,
    };
  }

  return routes;
}

// ─── Create and export the SDK middleware ─────────────────────────────────────

let _sdkMiddleware: ((req: Request, res: Response, next: NextFunction) => Promise<void>) | null = null;
let _initError: string | null = null;
let _resourceServer: x402ResourceServer | null = null;
let _x402OrgServer: x402ResourceServer | null = null;

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
    // Support both naming conventions: CDP_API_KEY_ID or CDP_API_KEY, CDP_API_KEY_SECRET or CDP_API_SECRET
    const cdpKeyId = process.env.CDP_API_KEY_ID || process.env.CDP_API_KEY;
    const cdpKeySecret = process.env.CDP_API_KEY_SECRET || process.env.CDP_API_SECRET;
    const hasCdpKeys = !!(cdpKeyId && cdpKeySecret);
    let facilitatorClient: HTTPFacilitatorClient;

    if (hasCdpKeys) {
      // CDP facilitator with proper JWT auth via @coinbase/x402
      const cdpConfig = createFacilitatorConfig(
        cdpKeyId!,
        cdpKeySecret!,
      );
      facilitatorClient = new HTTPFacilitatorClient(cdpConfig);
      console.log(`[x402-sdk] Using CDP facilitator with JWT auth`);
    } else {
      // No CDP keys — use x402.org as primary
      const facilitatorUrl = config.x402.facilitatorUrl || "https://x402.org/facilitator";
      facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
      console.log(`[x402-sdk] Using x402.org facilitator (no CDP keys configured)`);
    }
    // Secondary facilitator: always register x402.org for dual-catalog coverage
    // This ensures tools appear in BOTH CDP Bazaar AND x402.org discovery catalog
    const x402OrgClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
    _x402OrgServer = new x402ResourceServer(x402OrgClient)
      .register(evmNetwork, new ExactEvmScheme())
      .registerExtension(bazaarResourceServerExtension);

    const evmNetwork = config.x402.network === "base-sepolia"
      ? "eip155:84532"
      : "eip155:8453";

    const resourceServer = new x402ResourceServer(facilitatorClient)
      .register(evmNetwork, new ExactEvmScheme())           // Base mainnet
      .register("eip155:137", new ExactEvmScheme())          // Polygon mainnet
      .register(SOLANA_MAINNET_CAIP2, new ExactSvmScheme()) // Solana mainnet
      .registerExtension(bazaarResourceServerExtension);    // Bazaar discovery catalog (CDP)

    const routes = buildSdkRoutes();
    const routeCount = Object.keys(routes).length;

    if (routeCount === 0) {
      _initError = "No routes configured for x402 SDK";
      console.log(`[x402-sdk] ${_initError}`);
      return false;
    }

    // syncFacilitatorOnStart=true: On first request, middleware awaits CDP /supported call.
    // This runs once and is shared across all requests — subsequent requests are instant.
    _sdkMiddleware = paymentMiddleware(
      routes as any,
      resourceServer,
      undefined, // paywallConfig
      undefined, // paywall provider
      true,      // syncFacilitatorOnStart — SDK awaits CDP /supported on first request
    );

    _resourceServer = resourceServer;

    const solanaWallet = process.env.SOLANA_WALLET_ADDRESS;
    console.log(`[x402-sdk] ✅ Initialized with ${routeCount} routes (dual-catalog: CDP Bazaar + x402.org)`);
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
    // Warm primary facilitator (CDP or x402.org depending on config)
    await (_resourceServer as any).initialize?.();
    console.log("[x402-sdk] Pre-warm complete — primary facilitator /supported fetched");
  } catch (err) {
    console.warn("[x402-sdk] Pre-warm failed (non-fatal):", (err as Error).message);
  }
  // Also warm x402.org secondary facilitator for dual-catalog coverage
  if (_x402OrgServer) {
    try {
      await (_x402OrgServer as any).initialize?.();
      console.log("[x402-sdk] x402.org secondary warm complete");
    } catch (err) {
      console.warn("[x402-sdk] x402.org warm failed (non-fatal):", (err as Error).message);
    }
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
