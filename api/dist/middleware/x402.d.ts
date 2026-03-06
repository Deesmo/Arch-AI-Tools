/**
 * x402 Payment Middleware — v15
 *
 * Implements the Coinbase x402 protocol for HTTP-native USDC payments.
 * AI agents that don't have pre-purchased credits can pay per-call with USDC on Base.
 *
 * Flow:
 *   1. Agent hits /v1/tools/:tool with no API key (or insufficient credits)
 *   2. Server returns 402 with x-payment-details header
 *   3. Agent signs USDC payment, retries request with X-Payment header
 *   4. Middleware verifies payment with facilitator, then allows request through
 *
 * Official package: npm install x402-express (swap this in for production if preferred)
 */
import { Request, Response, NextFunction } from "express";
export declare const X402_PRICES: Record<string, string>;
/**
 * x402 middleware — attach to any tool route.
 * Checks for X-Payment header; if missing + no valid API key, returns 402.
 * If X-Payment present, verifies with facilitator and logs payment.
 */
export declare function x402Middleware(toolName: string): (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=x402.d.ts.map