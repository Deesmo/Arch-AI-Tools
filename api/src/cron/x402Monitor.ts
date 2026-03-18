/**
 * x402 Payment Gate Monitor — runs every 10 minutes
 * 
 * CRITICAL: Verifies the x402 payment gate is actually working.
 * Tests that an unauthenticated request to a tool endpoint returns 402 (not 200).
 * If 200 is returned, the gate is broken and payments are being bypassed.
 * 
 * This is a permanent safeguard. Any change to middleware must pass this test.
 */

import { sendAdminAlert } from "../services/email.js";
import { logger } from "../lib/logger.js";

const TOOL_ENDPOINT = process.env.PUBLIC_SITE_URL 
  ? `${process.env.PUBLIC_SITE_URL}/v1/tools/generate-hash`
  : "https://arch-ai-tools.onrender.com/v1/tools/generate-hash";

export async function runX402Monitor(): Promise<void> {
  try {
    // Test 1: Unauthenticated request with NO payment header should return 402
    const r = await fetch(TOOL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "x402-gate-test" }),
      signal: AbortSignal.timeout(10000),
    });

    if (r.status === 200) {
      // CRITICAL: Gate is broken — unauthenticated request returned 200
      const body = await r.json().catch(() => ({}));
      const message = `🚨 CRITICAL: x402 PAYMENT GATE IS BROKEN

Unauthenticated request to /v1/tools/generate-hash returned HTTP 200.
This means ANY request can bypass payment and auth — the gate is down.

Response: ${JSON.stringify(body).slice(0, 200)}

IMMEDIATE ACTION REQUIRED:
1. Check X402_SDK_ENABLED env var (should be "false")
2. Check api/src/middleware/x402-sdk.ts for next() calls on unauthenticated requests
3. Check api/src/middleware/x402.ts for any bypass logic
4. Deploy a fix immediately

Admin dashboard: https://archtools.dev/admin.html`;

      await sendAdminAlert("🚨 CRITICAL: x402 Payment Gate BROKEN", message);
      logger.error({ status: r.status, endpoint: TOOL_ENDPOINT }, "x402 gate monitor: GATE IS BROKEN");
      return;
    }

    if (r.status === 402) {
      // Gate is working correctly
      logger.info({ status: r.status }, "x402 gate monitor: OK — gate returning 402 correctly");
      return;
    }

    if (r.status === 401) {
      // 401 means auth middleware ran instead of x402 — gate may be misconfigured
      logger.warn({ status: r.status }, "x402 gate monitor: returning 401 instead of 402 — check middleware order");
      return;
    }

    // Unexpected status
    logger.warn({ status: r.status }, "x402 gate monitor: unexpected status");

  } catch (err: any) {
    // Network error — don't alert, could be a blip
    logger.warn({ err: err.message }, "x402 gate monitor: network error");
  }
}
