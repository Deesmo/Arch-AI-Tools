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
assert.equal(unavailableProviders("transcribe-audio"), null);
noteProviderResponse("openai", 429, "insufficient_quota");
assert.deepEqual(unavailableProviders("transcribe-audio"), ["openai"]);
assert.equal(unavailableProviders("design-create"), null, "design-create still has Stability");
noteProviderResponse("stability", 402, "");
assert.deepEqual(unavailableProviders("design-create"), ["openai", "stability"]);
assert.equal(unavailableProviders("web-scrape"), null, "untracked tools are never gated");

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
  assert.equal(providerHealthSnapshot().runway.exhausted, false, "balance 1 alone does not trip (no guessed threshold)");
  noteProviderResponse("runway", 400, "You do not have enough credits to run this task.");
  assert.equal(providerHealthSnapshot().runway.balanceAtExhaustion, 1);
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().runway.exhausted, true, "same balance -> still off");
  replies.set("api.dev.runwayml.com", [200, JSON.stringify({ creditBalance: 5000 })]);
  replies.set("api.openai.com", [200, '{"choices":[{"message":{"content":"o"}}]}']);
  await runProviderProbes(true);
  assert.equal(providerHealthSnapshot().runway.exhausted, false, "top-up -> back on");
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
for (const p of ['"openai", r.status, err', '"runway", attempt.status', '"elevenlabs", r.status', '"removebg", resp.status', '"hunter", resp.status', '"stability", sr.status']) {
  assert.ok(tools.includes(`noteProviderResponse(${p}`), `feeds ${p}`);
}
const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
assert.ok(index.includes("startProviderHealth();"), "probes start with the server");
assert.ok(index.includes('import("./lib/systemJobs.js")') && index.includes('import("./cron/demoTopoff.js")'), "background jobs import with .js (ESM)");

console.log("All provider-health tests passed.");
