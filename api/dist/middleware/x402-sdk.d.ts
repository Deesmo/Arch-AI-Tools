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
/**
 * Pre-warm the x402 SDK by triggering the facilitator /supported call in the background.
 * Call this after the server starts listening — fires async, never blocks.
 * This ensures the first real x402 request doesn't pay the CDP init cost (~1-2s).
 */
export declare function warmX402Sdk(): Promise<void>;
export declare function getX402SdkStatus(): {
    enabled: boolean;
    error: string | null;
    routeCount: number;
};
//# sourceMappingURL=x402-sdk.d.ts.map