/**
 * Signup success activation block — render + council-constraint checks.
 *
 * Verifies the opt-in "Run your first call" button, the onboarding
 * attribution tag, escaped response rendering, the 2s no-hanging-spinner
 * budget, the prefilled curl fallback, and the MCP connector block —
 * plus the X-Arch-Source → callerName allowlist in the credits layer.
 *
 * Run: cd api && npm run build && node tests/signup-firstcall.test.mjs
 */
import assert from "assert";

process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:5432/stub";

const { SIGNUP_HTML } = await import("../dist/assets/signupHtml.js");
const { callerNameFromArchSource } = await import("../dist/utils/credits.js");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log("Signup first-call activation block:");

// ── (1) Opt-in button, never auto-fired ──
test("first-call button exists with informed-consent label (1 credit, free-credit count)", () => {
  assert.ok(SIGNUP_HTML.includes('id="first-call-btn"'));
  assert.ok(SIGNUP_HTML.includes("Run your first call (uses 1 of your ' + credits + ' free credits)"));
});

test("call fires ONLY from the click handler — exactly one call site, wired to addEventListener('click')", () => {
  const callSites = SIGNUP_HTML.split("runFirstCall(").length - 1;
  // one function declaration + one invocation inside the click closure
  assert.strictEqual(callSites, 2, `expected 2 occurrences of runFirstCall(, got ${callSites}`);
  assert.ok(SIGNUP_HTML.includes("fcBtn.addEventListener('click', function() { runFirstCall(apiKey, fcBtn); })"));
  // never invoked on load/DOMContentLoaded/timer
  assert.ok(!/(?:DOMContentLoaded|window\.onload|addEventListener\('load')[^]{0,120}runFirstCall/.test(SIGNUP_HTML));
});

test("request is tagged with X-Arch-Source: onboarding and hits generate-uuid", () => {
  assert.ok(SIGNUP_HTML.includes("'X-Arch-Source': 'onboarding'"));
  assert.ok(SIGNUP_HTML.includes("fetch('/v1/tools/generate-uuid'"));
});

// ── (2) Escaped rendering + credits + no hanging spinner ──
test("API response rendered via textContent, never innerHTML", () => {
  assert.ok(SIGNUP_HTML.includes("pre.textContent = rendered"));
  assert.ok(!SIGNUP_HTML.includes("innerHTML = rendered"));
});

test("credits remaining surfaced from X-Credits-Remaining header", () => {
  assert.ok(SIGNUP_HTML.includes("res.headers.get('X-Credits-Remaining')"));
  assert.ok(SIGNUP_HTML.includes("'Credits remaining: ' + remaining"));
});

test("2s abort budget with static curl fallback on error/timeout", () => {
  assert.ok(SIGNUP_HTML.includes("ctrl.abort(); }, 2000)"));
  assert.ok(SIGNUP_HTML.includes("showFirstCallFallback"));
  assert.ok(SIGNUP_HTML.includes("Run it from your terminal instead"));
});

// ── (3) Prefilled curl + MCP connector block ──
test("copy-paste curl prefilled with the fresh key (textContent, format-checked)", () => {
  assert.ok(SIGNUP_HTML.includes('id="first-call-curl"'));
  assert.ok(SIGNUP_HTML.includes("curl -X POST https://archtools.dev/v1/tools/generate-uuid"));
  assert.ok(SIGNUP_HTML.includes("curlEl.textContent ="));
  assert.ok(SIGNUP_HTML.includes("arch_[A-Za-z0-9]{16,96}"), "key format-checked before prefill");
});

test("MCP connector block: URL + Claude and ChatGPT connect lines", () => {
  assert.ok(SIGNUP_HTML.includes("https://archtools.dev/mcp"));
  assert.ok(SIGNUP_HTML.includes("Claude: Settings"));
  assert.ok(SIGNUP_HTML.includes("ChatGPT: Settings"));
});

test("?key= URL param only accepted in strict arch_-hex format (no markup via key)", () => {
  assert.ok(!SIGNUP_HTML.includes("preKey.startsWith('arch_')"));
  assert.ok(/\/\^arch_\[A-Za-z0-9\]\{16,96\}\$\/\.test\(preKey\)/.test(SIGNUP_HTML));
});

// ── (4) credits-layer attribution allowlist ──
test("callerNameFromArchSource maps onboarding → web-onboarding, rejects everything else", () => {
  assert.strictEqual(callerNameFromArchSource("onboarding"), "web-onboarding");
  assert.strictEqual(callerNameFromArchSource(" Onboarding "), "web-onboarding");
  assert.strictEqual(callerNameFromArchSource("evil<script>"), null);
  assert.strictEqual(callerNameFromArchSource(""), null);
  assert.strictEqual(callerNameFromArchSource(undefined), null);
  assert.strictEqual(callerNameFromArchSource(["onboarding"]), null);
  assert.strictEqual(callerNameFromArchSource("__proto__"), null);
});

console.log(failures > 0 ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures > 0 ? 1 : 0);
