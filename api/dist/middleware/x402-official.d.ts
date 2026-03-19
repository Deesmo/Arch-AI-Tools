/**
 * x402 Official Middleware — per Coinbase quickstart docs exactly.
 *
 * Uses paymentMiddleware from @x402/express with full-path routes mounted at root.
 * ExactEvmScheme for Base + Polygon, ExactSvmScheme for Solana.
 * createFacilitatorConfig from @coinbase/x402 for CDP JWT auth.
 */
import type { Request, Response, NextFunction } from "express";
export declare function initOfficialX402(): void;
/**
 * Express middleware that uses the official @x402/express paymentMiddleware.
 * If not initialized, passes through silently.
 * If the request has an API key or Bearer token, skip x402 — let auth handle it.
 */
export declare function officialX402Middleware(req: Request, res: Response, next: NextFunction): void;
//# sourceMappingURL=x402-official.d.ts.map