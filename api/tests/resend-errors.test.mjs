/**
 * email-send error mapping — regression tests (2026-11-02).
 *
 * Resend 400/409/422 are the caller's request (e.g. a refused example.com
 * recipient) → 400 with Resend's reason; 429 → 429; 401/403/5xx are ours → 503.
 * Before this, every Resend failure surfaced as 502 and read as an ArchTools outage.
 * Runs against the compiled helper (npm run build first), like the other *.test.mjs.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapResendFailure } from "../dist/utils/resendErrors.js";

const refused = "Invalid `to` field. Please use our testing email address instead of domains like `example.com`.";
assert.deepEqual(mapResendFailure(422, refused), { status: 400, error: "invalid_request", message: refused });
assert.equal(mapResendFailure(400, "x").status, 400);
assert.equal(mapResendFailure(409, "x").status, 400);

const limited = mapResendFailure(429, "Too many requests");
assert.equal(limited.status, 429);
assert.equal(limited.error, "provider_rate_limited");

for (const ours of [401, 403, 500, 503]) {
  const f = mapResendFailure(ours, "boom");
  assert.equal(f.status, 503, `Resend ${ours} must stay a platform error (503, never 502)`);
  assert.equal(f.error, "send_error");
}
assert.equal(mapResendFailure(500).message, "Resend returned 500");

// Source pin: the email-send route must use the helper, not a hard-coded 502.
const route = readFileSync(new URL("../src/routes/tools/index.ts", import.meta.url), "utf8");
const handler = route.slice(route.indexOf('router.post("/email-send"'), route.indexOf('router.post("/email-send"') + 4000);
assert.ok(handler.includes("mapResendFailure(r.status, err.message)"), "email-send must map Resend failures via mapResendFailure");

console.log("All resend-errors tests passed.");
