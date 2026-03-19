/**
 * x402 SDK Middleware — Official Coinbase @x402/express integration
 *
 * Uses the official x402 SDK for proper protocol-compliant payment handling.
 * This runs alongside the existing custom x402 middleware — controlled by
 * the X402_SDK_ENABLED env var.
 *
 * When enabled, the SDK middleware handles payment verification and settlement
 * via the official facilitator, replacing our custom verify/settle logic.
 *
 * The existing custom middleware remains as fallback for non-EVM chains
 * (Solana, Cosmos, Bittensor, etc.) that the SDK doesn't yet support.
 */
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions";
import { createFacilitatorConfig } from "@coinbase/x402";
import { config } from "../config.js";
import { X402_PRICES, TOOL_OUTPUT_SCHEMAS } from "./x402.js";
// Solana mainnet CAIP-2 identifier
const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
// ─── Build x402 SDK route config from our pricing table ──────────────────────
function buildSdkRoutes() {
    const evmWallet = config.x402.walletAddress;
    const solanaWallet = process.env.SOLANA_WALLET_ADDRESS;
    if (!evmWallet && !solanaWallet)
        return {};
    const evmNetwork = config.x402.network === "base-sepolia"
        ? "eip155:84532"
        : "eip155:8453"; // Default to Base mainnet
    const routes = {};
    for (const [toolName, price] of Object.entries(X402_PRICES)) {
        // Bazaar discovery metadata — declares input schema for POST tool endpoints
        const postDiscovery = declareDiscoveryExtension({
            bodyType: "json",
            inputSchema: TOOL_OUTPUT_SCHEMAS[toolName]?.input ?? { type: "object" },
            output: TOOL_OUTPUT_SCHEMAS[toolName]?.output
                ? { schema: TOOL_OUTPUT_SCHEMAS[toolName].output }
                : undefined,
        });
        // Build accepts[] array with all supported networks for this tool
        const accepts = [];
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
            extensions: postDiscovery,
        };
        // Also register GET for x402scan compatibility (query-style discovery)
        const getDiscovery = declareDiscoveryExtension({});
        const getRouteKey = `GET /${toolName}`;
        routes[getRouteKey] = {
            accepts,
            description: `Arch Tools — ${toolName}`,
            extensions: getDiscovery,
        };
    }
    return routes;
}
// ─── Create and export the SDK middleware ─────────────────────────────────────
let _sdkMiddleware = null;
let _initError = null;
/**
 * Initialize the x402 SDK middleware.
 * Call this once at startup. Returns true if successful.
 */
export function initX402Sdk() {
    if (!config.x402.walletAddress) {
        _initError = "WALLET_ADDRESS not configured — x402 SDK disabled";
        console.log(`[x402-sdk] ${_initError}`);
        return false;
    }
    if (process.env.X402_SDK_ENABLED !== "true") {
        _initError = "X402_SDK_ENABLED not set to 'true' — SDK middleware disabled";
        console.log(`[x402-sdk] ${_initError}`);
        return false;
    }
    try {
        // Use @coinbase/x402's createFacilitatorConfig for proper CDP JWT auth
        // This handles JWT generation automatically for verify/settle/supported calls
        const hasCdpKeys = !!(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET);
        let facilitatorClient;
        if (hasCdpKeys) {
            // CDP facilitator with proper JWT auth via @coinbase/x402
            const cdpConfig = createFacilitatorConfig(process.env.CDP_API_KEY_ID, process.env.CDP_API_KEY_SECRET);
            facilitatorClient = new HTTPFacilitatorClient(cdpConfig);
            console.log(`[x402-sdk] Using CDP facilitator with JWT auth`);
        }
        else {
            // Fallback to x402.org (testnet only)
            const facilitatorUrl = config.x402.facilitatorUrl || "https://x402.org/facilitator";
            facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
            console.log(`[x402-sdk] Using fallback facilitator: ${facilitatorUrl}`);
        }
        const evmNetwork = config.x402.network === "base-sepolia"
            ? "eip155:84532"
            : "eip155:8453";
        const resourceServer = new x402ResourceServer(facilitatorClient)
            .register(evmNetwork, new ExactEvmScheme()) // Base
            .register("eip155:137", new ExactEvmScheme()) // Polygon
            .register(SOLANA_MAINNET_CAIP2, new ExactSvmScheme()) // Solana mainnet
            .registerExtension(bazaarResourceServerExtension);
        const routes = buildSdkRoutes();
        const routeCount = Object.keys(routes).length;
        if (routeCount === 0) {
            _initError = "No routes configured for x402 SDK";
            console.log(`[x402-sdk] ${_initError}`);
            return false;
        }
        // Use type assertion since our route config matches the SDK's expected shape
        _sdkMiddleware = paymentMiddleware(routes, resourceServer, undefined, // paywallConfig
        undefined, // paywall provider
        false);
        const solanaWallet = process.env.SOLANA_WALLET_ADDRESS;
        console.log(`[x402-sdk] ✅ Initialized with ${routeCount} routes`);
        console.log(`[x402-sdk]    Networks: ${evmNetwork} (Base), eip155:137 (Polygon)${solanaWallet ? `, ${SOLANA_MAINNET_CAIP2} (Solana)` : ''}`);
        console.log(`[x402-sdk]    CDP auth: ${hasCdpKeys ? 'JWT' : 'none (testnet)'}`);
        if (config.x402.walletAddress)
            console.log(`[x402-sdk]    EVM wallet: ${config.x402.walletAddress.slice(0, 6)}...${config.x402.walletAddress.slice(-4)}`);
        if (solanaWallet)
            console.log(`[x402-sdk]    Solana wallet: ${solanaWallet.slice(0, 4)}...${solanaWallet.slice(-4)}`);
        return true;
    }
    catch (err) {
        _initError = `Failed to initialize x402 SDK: ${err.message}`;
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
export function x402SdkMiddleware(req, res, next) {
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
        req.x402Paid = true;
        req.x402SdkPaid = true;
        next();
    });
}
/**
 * Get SDK initialization status for health checks / admin endpoints.
 */
export function getX402SdkStatus() {
    const routes = buildSdkRoutes();
    return {
        enabled: _sdkMiddleware !== null,
        error: _initError,
        routeCount: Object.keys(routes).length,
    };
}
//# sourceMappingURL=x402-sdk.js.map