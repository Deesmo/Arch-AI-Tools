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
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions";
import { config } from "../config.js";
import { X402_PRICES, TOOL_OUTPUT_SCHEMAS } from "./x402.js";
// ─── Build x402 SDK route config from our pricing table ──────────────────────
function buildSdkRoutes() {
    const walletAddress = config.x402.walletAddress;
    if (!walletAddress)
        return {};
    const network = config.x402.network === "base-sepolia"
        ? "eip155:84532"
        : "eip155:8453"; // Default to Base mainnet
    const baseUrl = process.env.PUBLIC_SITE_URL ?? "https://archtools.dev";
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
        // Each tool is a POST endpoint at /v1/tools/<toolName>
        const routeKey = `POST /v1/tools/${toolName}`;
        routes[routeKey] = {
            accepts: {
                scheme: "exact",
                price: `$${price}`,
                network,
                payTo: walletAddress,
                maxTimeoutSeconds: 60,
            },
            description: `Arch Tools — ${toolName}`,
            extensions: postDiscovery,
        };
        // Also register GET for x402scan compatibility (query-style discovery)
        const getDiscovery = declareDiscoveryExtension({});
        const getRouteKey = `GET /v1/tools/${toolName}`;
        routes[getRouteKey] = {
            accepts: {
                scheme: "exact",
                price: `$${price}`,
                network,
                payTo: walletAddress,
                maxTimeoutSeconds: 60,
            },
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
        const facilitatorUrl = config.x402.facilitatorUrl || "https://x402.org/facilitator";
        const facilitatorClient = new HTTPFacilitatorClient({ url: facilitatorUrl });
        const network = config.x402.network === "base-sepolia"
            ? "eip155:84532"
            : "eip155:8453";
        const resourceServer = new x402ResourceServer(facilitatorClient)
            .register(network, new ExactEvmScheme())
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
        console.log(`[x402-sdk] ✅ Initialized with ${routeCount} routes on ${network}`);
        console.log(`[x402-sdk]    Facilitator: ${facilitatorUrl}`);
        console.log(`[x402-sdk]    Wallet: ${config.x402.walletAddress.slice(0, 6)}...${config.x402.walletAddress.slice(-4)}`);
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