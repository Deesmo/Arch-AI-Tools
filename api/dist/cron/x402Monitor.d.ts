/**
 * x402 Payment Gate Monitor — runs every 10 minutes
 *
 * CRITICAL: Verifies the x402 payment gate is actually working.
 * Tests that an unauthenticated request to a tool endpoint returns 402 (not 200).
 * If 200 is returned, the gate is broken and payments are being bypassed.
 *
 * This is a permanent safeguard. Any change to middleware must pass this test.
 */
export declare function runX402Monitor(): Promise<void>;
//# sourceMappingURL=x402Monitor.d.ts.map