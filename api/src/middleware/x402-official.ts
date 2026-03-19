/**
 * x402 Official Middleware — per Coinbase quickstart docs exactly.
 *
 * Uses paymentMiddleware from @x402/express with full-path routes mounted at root.
 * ExactEvmScheme for Base + Polygon, ExactSvmScheme for Solana.
 * createFacilitatorConfig from @coinbase/x402 for CDP JWT auth.
 */

import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createFacilitatorConfig } from "@coinbase/x402";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";
import { X402_PRICES } from "./x402.js";

const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

let _middleware: ((req: Request, res: Response, next: NextFunction) => void) | null = null;

export function initOfficialX402(): void {
  const evmWallet = config.x402.walletAddress;
  if (!evmWallet) {
    console.log("[x402-official] No WALLET_ADDRESS configured — disabled");
    return;
  }

  const solWallet = process.env.SOLANA_WALLET_ADDRESS;
  const hasCdpKeys = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);

  let facilitatorClient: HTTPFacilitatorClient;

  if (hasCdpKeys) {
    // CDP facilitator with proper JWT auth via @coinbase/x402
    const cdpConfig = createFacilitatorConfig(
      process.env.CDP_API_KEY_ID!,
      process.env.CDP_API_KEY_SECRET!,
    );
    facilitatorClient = new HTTPFacilitatorClient(cdpConfig);
    console.log("[x402-official] Using CDP facilitator with JWT auth");
  } else {
    // Fallback to x402.org (testnet)
    const facilitatorUrl = config.x402.facilitatorUrl || "https://x402.org/facilitator";
    facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
    console.log(`[x402-official] Using fallback facilitator: ${facilitatorUrl}`);
  }

  const evmNetwork = config.x402.network === "base-sepolia" ? "eip155:84532" : "eip155:8453";

  const server = new x402ResourceServer(facilitatorClient)
    .register(evmNetwork, new ExactEvmScheme())        // Base
    .register("eip155:137", new ExactEvmScheme());      // Polygon

  if (solWallet) {
    server.register(SOLANA_MAINNET, new ExactSvmScheme()); // Solana
  }

  // Build routes with full paths (mounted at root, not /v1/tools)
  const routes: Record<string, any> = {};

  for (const [toolName, price] of Object.entries(X402_PRICES)) {
    const accepts: any[] = [
      { scheme: "exact", price: `$${price}`, network: evmNetwork, payTo: evmWallet },
      { scheme: "exact", price: `$${price}`, network: "eip155:137", payTo: evmWallet },
    ];
    if (solWallet) {
      accepts.push({
        scheme: "exact",
        price: `$${price}`,
        network: SOLANA_MAINNET,
        payTo: solWallet,
      });
    }
    routes[`POST /v1/tools/${toolName}`] = {
      accepts,
      description: `Arch Tools — ${toolName}`,
    };
  }

  const routeCount = Object.keys(routes).length;

  _middleware = paymentMiddleware(
    routes as any,
    server,
    undefined, // paywallConfig
    undefined, // paywall provider
    true,      // syncFacilitatorOnStart
  );

  console.log(`[x402-official] ✅ Initialized with ${routeCount} routes`);
  console.log(`[x402-official]    Networks: ${evmNetwork} (Base), eip155:137 (Polygon)${solWallet ? `, ${SOLANA_MAINNET} (Solana)` : ""}`);
  console.log(`[x402-official]    CDP auth: ${hasCdpKeys ? "JWT" : "none (testnet)"}`);
  if (evmWallet) console.log(`[x402-official]    EVM wallet: ${evmWallet.slice(0, 6)}...${evmWallet.slice(-4)}`);
  if (solWallet) console.log(`[x402-official]    Solana wallet: ${solWallet.slice(0, 4)}...${solWallet.slice(-4)}`);
}

/**
 * Express middleware that uses the official @x402/express paymentMiddleware.
 * If not initialized, passes through silently.
 * If the request has an API key or Bearer token, skip x402 — let auth handle it.
 */
export function officialX402Middleware(req: Request, res: Response, next: NextFunction): void {
  if (!_middleware) {
    next();
    return;
  }

  // If the request has auth credentials, skip x402 payment flow
  if (req.headers.authorization?.startsWith("Bearer ") || req.headers["x-api-key"]) {
    next();
    return;
  }

  _middleware(req, res, () => {
    (req as any).x402Paid = true;
    next();
  });
}
