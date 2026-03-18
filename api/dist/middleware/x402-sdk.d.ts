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
import type { Request, Response, NextFunction } from "express";
/**
 * Initialize the x402 SDK middleware.
 * Call this once at startup. Returns true if successful.
 */
export declare function initX402Sdk(): boolean;
/**
 * Express middleware that wraps the x402 SDK.
 * If the SDK is not initialized, passes through silently (no-op).
 *
 * When a request has a valid X-PAYMENT header and the SDK processes it,
 * we set req.x402Paid = true so downstream handlers can skip credit deduction.
 */
export declare function x402SdkMiddleware(req: Request, res: Response, next: NextFunction): void;
/**
 * Get SDK initialization status for health checks / admin endpoints.
 */
export declare function getX402SdkStatus(): {
    enabled: boolean;
    error: string | null;
    routeCount: number;
};
//# sourceMappingURL=x402-sdk.d.ts.map