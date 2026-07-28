/**
 * session-message pricing + context-cap regression coverage.
 *
 * Guards the 2026-07-28 stop-bleed fix: session-message previously charged a
 * flat 20 credits regardless of model (Opus = guaranteed loss), sent up to
 * 50 x 10k chars of history upstream on every call, and let x402 flat-price
 * callers hold premium-model sessions.
 *
 * Run: cd api && npm run build && node tests/session-pricing.test.mjs
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { trimSessionContext } from "../dist/lib/sessionContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const toolsSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "tools", "index.ts"), "utf8");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

function route(name) {
  const start = toolsSrc.indexOf(`router.post("/${name}"`);
  assert.ok(start >= 0, `missing route for ${name}`);
  const end = toolsSrc.indexOf("router.post(", start + 1);
  return toolsSrc.slice(start, end > start ? end : undefined);
}

const msg = (role, content) => ({ role, content });

console.log("Context cap (trimSessionContext):");

test("history within the budget is sent untouched", () => {
  const messages = [msg("user", "a".repeat(100)), msg("assistant", "b".repeat(100)), msg("user", "c")];
  const { window, truncated } = trimSessionContext(messages, 40000);
  assert.deepStrictEqual(window, messages);
  assert.strictEqual(truncated, false);
});

test("over-budget history drops oldest messages first", () => {
  // 6 alternating messages of 100 chars; budget fits only the last two.
  const messages = [];
  for (let i = 0; i < 3; i++) {
    messages.push(msg("user", `u${i}`.padEnd(100, "x")));
    messages.push(msg("assistant", `a${i}`.padEnd(100, "x")));
  }
  messages.push(msg("user", "final".padEnd(100, "x")));
  const { window, truncated } = trimSessionContext(messages, 250);
  assert.strictEqual(truncated, true);
  // Newest message always survives; the window is the tail of the history.
  assert.strictEqual(window[window.length - 1].content, "final".padEnd(100, "x"));
  assert.deepStrictEqual(window, messages.slice(messages.length - window.length));
  const chars = window.reduce((n, m) => n + m.content.length, 0);
  assert.ok(chars <= 250, `window ${chars} chars exceeds the 250 budget`);
});

test("newest message is always sent even when it alone exceeds the budget", () => {
  const messages = [msg("user", "old"), msg("assistant", "old"), msg("user", "z".repeat(500))];
  const { window, truncated } = trimSessionContext(messages, 100);
  assert.strictEqual(window.length, 1);
  assert.strictEqual(window[0].content, "z".repeat(500));
  assert.strictEqual(truncated, true);
});

test("window never opens with an assistant turn (Anthropic rejects it)", () => {
  // A cut (or the 50-message history cap) can leave an assistant message first.
  const messages = [msg("assistant", "a".repeat(50)), msg("user", "u1"), msg("assistant", "a1"), msg("user", "u2")];
  const { window } = trimSessionContext(messages, 40000);
  assert.strictEqual(window[0].role, "user");
  assert.strictEqual(window[window.length - 1].content, "u2");
});

test("stored history is not mutated by trimming", () => {
  const messages = [msg("user", "a".repeat(200)), msg("assistant", "b".repeat(200)), msg("user", "c")];
  const copy = JSON.parse(JSON.stringify(messages));
  trimSessionContext(messages, 10);
  assert.deepStrictEqual(messages, copy);
});

console.log("\nsession-message route shape:");

const sessionMessageRoute = route("session-message");
const sessionCreateRoute = route("session-create");

test("charges applyModelCost on the served model, never a flat 20", () => {
  assert.ok(!/deductCredits\(req, res, "session-message", 20\)/.test(sessionMessageRoute), "flat 20-credit deduction must be gone");
  assert.match(sessionMessageRoute, /sessionMsgCost = paid \? 0 : applyModelCost\(20, servedModel\)/);
  assert.match(sessionMessageRoute, /deductCredits\(req, res, "session-message", sessionMsgCost\)/);
});

test("success body reports the deducted cost (advertised = charged)", () => {
  assert.ok(!/credits_used:\s*20\b/.test(sessionMessageRoute), "stale flat credits_used: 20 must be gone");
  const payloads = [...sessionMessageRoute.matchAll(/credits_used:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(payloads.length >= 1, "session-message reports credits_used");
  assert.ok(payloads.every((v) => v === "sessionMsgCost"), "every payload reports the deducted cost");
});

test("x402-paid messages are pinned to the non-premium tier at serve time", () => {
  assert.match(sessionMessageRoute, /paid && modelCostMultiplier\(session\.model\) > 1\.0/);
  assert.match(sessionMessageRoute, /model_used: model/);
});

test("x402-paid session-create cannot store a premium model", () => {
  assert.match(sessionCreateRoute, /paid && modelCostMultiplier\(resolvedModel\) > 1\.0/);
});

test("upstream calls send the trimmed window, not the raw stored history", () => {
  assert.match(sessionMessageRoute, /trimSessionContext\(session\.messages, SESSION_CONTEXT_MAX_CHARS\)/);
  assert.match(sessionMessageRoute, /SESSION_CONTEXT_MAX_CHARS = parseInt\(process\.env\.SESSION_CONTEXT_MAX_CHARS \?\? "40000", 10\)/);
  assert.match(sessionMessageRoute, /messages: upstreamMessages\.map/);
  assert.match(sessionMessageRoute, /\.\.\.upstreamMessages\.map/);
  assert.ok(!/messages: session\.messages\.map/.test(sessionMessageRoute), "raw history must not be sent to Anthropic");
  assert.ok(!/\.\.\.session\.messages\.map/.test(sessionMessageRoute), "raw history must not be sent to OpenAI");
  assert.match(sessionMessageRoute, /context_truncated: true/);
});

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll session-pricing tests passed.");
