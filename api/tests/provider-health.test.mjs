/**
 * Provider credit health: tools switch off only on a definite "no credit"
 * answer, before any charge, and come back when credit returns.
 * Run: cd api && npm run build && node tests/provider-health.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isCreditExhaustion, noteProviderResponse, unavailableProviders, runProviderProbes,
  providerHealthSnapshot, __resetProviderHealth,
} from "../dist/lib/providerHealth.js";

// What trips the breaker — real provider answers seen on 2026-11-02.
assert.equal(isCreditExhaustion(429, '{"error":{"message":"You have no credits remaining.","type":"insufficient_quota","code":"credit_balance_exhausted"}}'), true, "OpenAI out of credit");
assert.equal(isCreditExhaustion(400, "You do not have enough credits to run this task."), true, "Runway out of credit");
assert.equal(isCreditExhaustion(402, ""), true, "402 Payment Required");
assert.equal(isCreditExhaustion(429, '{"error":{"message":"You exceeded your current quota"}}'), true, "Google free tier used up");
// What must NOT trip it.
assert.equal(isCreditExhaustion(429, "Rate limit reached for requests per minute"), false, "plain rate limit");
assert.equal(isCreditExhaustion(400, "invalid prompt"), false, "caller error");
assert.equal(isCreditExhaustion(500, "insufficient_quota"), false, "5xx is not a credit answer");

// One definite failure switches the tool off; fallbacks keep it on until both are out.
__resetProviderHealth();
const originalOpenAiKey = process.env.OPENAI_API_KEY;
const originalStabilityKey = process.env.STABILITY_API_KEY;
try {
  process.env.OPENAI_API_KEY = "test";
  delete process.env.STABILITY_API_KEY;
  assert.equal(unavailableProviders("transcribe-audio"), null);
  noteProviderResponse("openai", 429, "insufficient_quota");
  assert.deepEqual(unavailableProviders("transcribe-audio"), ["openai"]);
  assert.deepEqual(unavailableProviders("design-create"), ["openai", "stability"], "an unconfigured fallback cannot keep payable image tools open");

  __resetProviderHealth();
  process.env.STABILITY_API_KEY = "test";
  noteProviderResponse("openai", 429, "insufficient_quota");
  assert.equal(unavailableProviders("design-create"), null, "configured Stability keeps design-create open");
  noteProviderResponse("stability", 402, "");
  assert.deepEqual(unavailableProviders("design-create"), ["openai", "stability"]);
  assert.equal(unavailableProviders("web-scrape"), null, "untracked tools are never gated");
} finally {
  if (originalOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiKey;
  if (originalStabilityKey === undefined) delete process.env.STABILITY_API_KEY;
  else process.env.STABILITY_API_KEY = originalStabilityKey;
}

// Recovery through the probes (fetch stubbed): OpenAI recovers when a test call succeeds;
// a balance provider recovers only when its balance ROSE (a top-up), not on a still-low balance.
const realFetch = globalThis.fetch;
const replies = new Map();
globalThis.fetch = async (url) => {
  const host = new URL(url).host;
  const [status, body] = replies.get(host) ?? [200, "{}"];
  return new Response(body, { status, headers: { "Content-Type": "application/json" } });
};
process.env.OPENAI_API_KEY = "test"; process.env.RUNWAY_API_KEY = "test";
try {
  __resetProviderHealth();
  replies.set("api.dev.runwayml.com", [200, JSON.stringify({ creditBalance: 1 })]);
  replies.set("api.openai.com", [429, '{"error":{"type":"insufficient_quota"}}']);
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().openai.exhausted, true, "OpenAI probe 429 quota -> exhausted");
  assert.equal(providerHealthSnapshot().runway.exhausted, true, "balance 1 is below one gen4.5 video (MIN_BALANCE 60) -> off");
  replies.set("api.dev.runwayml.com", [200, JSON.stringify({ creditBalance: 30 })]);
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().runway.exhausted, true, "a top-up still below one call's price stays off");
  // A live failure trips the breaker while the last (healthy) probe reading is stale and
  // high: 1000 read hours ago, real balance now 1. The baseline a top-up must beat is the
  // fresh reading, otherwise a normal top-up below 1000 would never clear the breaker.
  replies.set("api.dev.runwayml.com", [200, JSON.stringify({ creditBalance: 1000 })]);
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().runway.balance, 1000);
  replies.set("api.dev.runwayml.com", [200, JSON.stringify({ creditBalance: 1 })]);
  noteProviderResponse("runway", 400, "You do not have enough credits to run this task.");
  assert.equal(providerHealthSnapshot().runway.exhausted, true, "live credit failure -> off");
  assert.notEqual(providerHealthSnapshot().runway.balanceAtExhaustion, 1000, "stale probe balance is not the baseline");
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().runway.balanceAtExhaustion, 1, "baseline = fresh reading after the failure");
  assert.equal(providerHealthSnapshot().runway.exhausted, true, "same balance -> still off");
  replies.set("api.dev.runwayml.com", [200, JSON.stringify({ creditBalance: 500 })]);
  replies.set("api.openai.com", [200, '{"choices":[{"message":{"content":"o"}}]}']);
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().runway.exhausted, false, "top-up (even below the stale 1000) -> back on");
  assert.equal(providerHealthSnapshot().openai.exhausted, false, "successful test call -> back on");
  replies.set("api.dev.runwayml.com", [200, JSON.stringify({ creditBalance: 0 })]);
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().runway.exhausted, true, "balance 0 -> off");
  replies.set("api.dev.runwayml.com", [503, "upstream down"]);
  replies.set("api.openai.com", [503, "upstream down"]);
  __resetProviderHealth();
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().openai.exhausted, false, "a provider outage is not 'out of credit'");
} finally {
  globalThis.fetch = realFetch;
}

// Wiring: the gate runs before payment and charging; real failures feed it; probes start at boot.
const tools = readFileSync(new URL("../src/routes/tools/index.ts", import.meta.url), "utf8");
assert.ok(tools.includes("return [providerGate(toolName), x402Middleware(toolName),"), "gate runs before the x402 challenge and credit charge");
for (const p of ['"openai", r.status, err', '"openai", upstream.status', '"runway", attempt.status', '"elevenlabs", r.status', '"removebg", resp.status', '"hunter", resp.status', '"stability", sr.status']) {
  assert.ok(tools.includes(`noteProviderResponse(${p}`), `feeds ${p}`);
}
// /generate-image is gated as design-create (OpenAI or Stability), so it must have the same Stability fallback.
assert.equal((tools.match(/await stabilityImageFallback\(prompt\)/g) ?? []).length, 2, "design-create and its generate-image alias both fall back to Stability");
const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
assert.ok(index.includes("startProviderHealth();"), "probes start with the server");
assert.ok(index.includes('import("./lib/systemJobs.js")') && index.includes('import("./cron/demoTopoff.js")'), "background jobs import with .js (ESM)");

console.log("All provider-health tests passed.");
