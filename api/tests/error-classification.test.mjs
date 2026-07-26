/**
 * Focused test — three-way request status classification (2026-07-26 fix).
 *
 * Previously any statusCode >= 400 was recorded as ERROR, so caller
 * conditions (402 out-of-credits, 404 no-result, 429 rate-limit) inflated
 * the platform "error" rate. classifyStatus is now the single source of
 * truth used by credits.ts, x402.ts and the analytics middleware:
 *
 *   SUCCESS       — < 400
 *   CLIENT_ERROR  — 400–499 (caller condition, platform healthy)
 *   ERROR         — >= 500 or no response (real platform failure)
 *
 * Run: node api/tests/error-classification.test.mjs   (after npm run build)
 */

const { classifyStatus, isPlatformError, isClientError } = await import("../dist/utils/statusClass.js");

let passed = 0;
let failed = 0;
function assertEq(actual, expected, msg) {
  if (actual === expected) { passed++; console.log(`  ✅ ${msg}`); }
  else { failed++; console.log(`  ❌ ${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

console.log("classifyStatus — SUCCESS (< 400)");
assertEq(classifyStatus(200), "SUCCESS", "200 OK → SUCCESS");
assertEq(classifyStatus(201), "SUCCESS", "201 Created → SUCCESS");
assertEq(classifyStatus(204), "SUCCESS", "204 No Content → SUCCESS");
assertEq(classifyStatus(301), "SUCCESS", "301 redirect → SUCCESS");
assertEq(classifyStatus(399), "SUCCESS", "399 boundary → SUCCESS");

console.log("classifyStatus — CLIENT_ERROR (400–499, caller condition)");
assertEq(classifyStatus(400), "CLIENT_ERROR", "400 bad request → CLIENT_ERROR (boundary)");
assertEq(classifyStatus(402), "CLIENT_ERROR", "402 out-of-credits → CLIENT_ERROR, not a platform error");
assertEq(classifyStatus(404), "CLIENT_ERROR", "404 not-found → CLIENT_ERROR, not a platform error");
assertEq(classifyStatus(429), "CLIENT_ERROR", "429 rate-limit → CLIENT_ERROR, not a platform error");
assertEq(classifyStatus(499), "CLIENT_ERROR", "499 boundary → CLIENT_ERROR");

console.log("classifyStatus — ERROR (>= 500, real platform failure)");
assertEq(classifyStatus(500), "ERROR", "500 → ERROR (boundary)");
assertEq(classifyStatus(502), "ERROR", "502 upstream → ERROR");
assertEq(classifyStatus(503), "ERROR", "503 unavailable → ERROR");
assertEq(classifyStatus(599), "ERROR", "599 → ERROR");

console.log("classifyStatus — missing/invalid code (failed before responding)");
assertEq(classifyStatus(undefined), "ERROR", "undefined statusCode → ERROR");
assertEq(classifyStatus(null), "ERROR", "null statusCode → ERROR");
assertEq(classifyStatus(NaN), "ERROR", "NaN statusCode → ERROR");

console.log("isPlatformError / isClientError helpers (analytics rates)");
assertEq(isPlatformError(500), true, "isPlatformError(500) = true");
assertEq(isPlatformError(499), false, "isPlatformError(499) = false");
assertEq(isPlatformError(404), false, "isPlatformError(404) = false — no-result is not a platform error");
assertEq(isClientError(400), true, "isClientError(400) = true");
assertEq(isClientError(429), true, "isClientError(429) = true");
assertEq(isClientError(500), false, "isClientError(500) = false");
assertEq(isClientError(200), false, "isClientError(200) = false");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
