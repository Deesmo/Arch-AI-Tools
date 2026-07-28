/**
 * Verify-email activation flow — regression tests (2026-07-28).
 *
 * Covers the scanner-safe two-step verify flow + the credential-free
 * activation launchpad:
 *   - GET  /v1/agent/verify-email renders a confirm page WITHOUT consuming
 *     the token (email-security scanners prefetch GET links).
 *   - POST /v1/agent/verify-email consumes the token (atomic single-use)
 *     and renders the activation page.
 *   - No page reachable from the emailed link ever contains an API key,
 *     localStorage access, or any script (auto-fired calls are banned).
 *   - The enriched verification email stays factual and key-free.
 *
 * Uses the built dist with a stubbed prisma layer (same pattern as
 * starter-credits.test.mjs) plus a real express app on an ephemeral port
 * for the route wiring.
 *
 * Run: cd api && npm run build && node tests/verify-activation.test.mjs
 */
import assert from "assert";

process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:5432/stub";

const { prisma } = await import("../dist/lib/prisma.js");
const { peekEmailVerifyToken } = await import("../dist/lib/verification.js");
const { VERIFY_TOKEN_RE, renderVerifyConfirmPage, renderVerifyActivationPage, renderVerifyErrorPage } =
  await import("../dist/assets/verifyEmailHtml.js");
const { renderVerificationEmail } = await import("../dist/services/email.js");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}
async function atest(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

const TOKEN = "a1".repeat(32); // 64 hex chars, matches crypto.randomBytes(32).toString("hex")

// A page reachable from an emailed link must be credential-free and inert.
function assertCredentialFree(html, label) {
  assert.ok(!/arch_[a-f0-9]/i.test(html), `${label}: must not contain an API key`);
  assert.ok(!html.toLowerCase().includes("localstorage"), `${label}: must not touch localStorage`);
  assert.ok(!html.toLowerCase().includes("sessionstorage"), `${label}: must not touch sessionStorage`);
  assert.ok(!html.toLowerCase().includes("<script"), `${label}: must contain zero scripts (no auto-fired calls)`);
}

// ─── 1. Render checks ───────────────────────────────────────────────────────
console.log("Page renders:");

test("token regex matches real tokens and rejects garbage", () => {
  assert.ok(VERIFY_TOKEN_RE.test(TOKEN));
  for (const bad of ["", "abc", "<script>alert(1)</script>", `${TOKEN}x`, TOKEN.slice(0, 63), `${TOKEN.slice(0, 63)}"`]) {
    assert.ok(!VERIFY_TOKEN_RE.test(bad), `should reject: ${bad.slice(0, 24)}`);
  }
});

test("confirm page: POSTs the token via a form (no GET consumption path)", () => {
  const html = renderVerifyConfirmPage(TOKEN, 75);
  assert.ok(html.includes('method="POST"'), "form must POST");
  assert.ok(html.includes('action="/v1/agent/verify-email"'), "form posts back to the verify route");
  assert.ok(html.includes(`name="token" value="${TOKEN}"`), "hidden token field present");
  assert.ok(html.includes("75"), "shows the pending credits it will activate");
  assertCredentialFree(html, "confirm page");
});

test("confirm page: zero-pending variant makes no credit claim", () => {
  const html = renderVerifyConfirmPage(TOKEN, 0);
  assert.ok(!html.includes("credits</strong>"), "no credit-activation claim when nothing is pending");
  assertCredentialFree(html, "confirm page (0 pending)");
});

test("confirm page: throws on an unvalidated token (injection defense-in-depth)", () => {
  assert.throws(() => renderVerifyConfirmPage('"><script>alert(1)</script>', 75), /validated hex/);
  assert.throws(() => renderVerifyConfirmPage(TOKEN + "ff", 75), /validated hex/);
});

test("activation page: three credential-free CTAs (MCP, curl quickstart, dashboard)", () => {
  const html = renderVerifyActivationPage(75);
  assert.ok(html.includes("75"), "credits activated shown dynamically");
  assert.ok(html.includes("https://archtools.dev/mcp"), "CTA 1: MCP connector URL");
  assert.ok(html.includes("Connectors"), "CTA 1: 2-line connector instructions");
  assert.ok(html.includes("&lt;YOUR_API_KEY&gt;"), "CTA 2: curl uses a placeholder, never a key");
  assert.ok(html.includes("/v1/tools/generate-uuid"), "CTA 2: quickstart targets a real 1-credit tool");
  assert.ok(html.includes("https://archtools.dev/docs"), "CTA 2: docs link");
  assert.ok(html.includes("https://archtools.dev/dashboard"), "CTA 3: dashboard login link");
  assertCredentialFree(html, "activation page");
});

test("activation page: zero-credit variant (already-claimed identity) stays factual", () => {
  const html = renderVerifyActivationPage(0);
  assert.ok(!html.includes("bonus credits"), "no bonus-credit claim when 0 activated");
  assert.ok(html.includes("verified"), "still confirms verification");
  assertCredentialFree(html, "activation page (0 credits)");
});

test("error page: points at the dashboard, leaks nothing", () => {
  const html = renderVerifyErrorPage();
  assert.ok(html.includes("https://archtools.dev/dashboard"));
  assert.ok(html.toLowerCase().includes("invalid"));
  assertCredentialFree(html, "error page");
});

// ─── 2. Verification email render ───────────────────────────────────────────
console.log("\nVerification email:");

const VERIFY_URL = `https://archtools.dev/v1/agent/verify-email?token=${TOKEN}`;

test("subject unchanged (deliverability)", () => {
  const { subject } = renderVerificationEmail(VERIFY_URL, 75);
  assert.strictEqual(subject, "Verify your email for Arch Tools");
});

for (const part of ["html", "text"]) {
  test(`${part}: verify CTA + factual what-you-get line, no API key`, () => {
    const out = renderVerificationEmail(VERIFY_URL, 75)[part];
    assert.ok(out.includes(VERIFY_URL), "verify link present");
    assert.ok(out.includes("75"), "pending credits stated");
    assert.ok(out.includes("63"), "63 tools stated");
    assert.ok(out.includes("archtools.dev/mcp"), "one-click connector mentioned");
    assert.ok(out.includes("30 minutes"), "expiry stated");
    assert.ok(!/arch_[a-f0-9]/i.test(out.replace(new RegExp(TOKEN, "g"), "")), "no API key in the email");
  });
  test(`${part}: zero-pending variant drops the credit claim`, () => {
    const out = renderVerificationEmail(VERIFY_URL, 0)[part];
    assert.ok(!out.includes("unlock on verification"), "no credit-unlock claim when nothing is pending");
    assert.ok(out.includes("63"), "still factual about tools");
  });
}

// ─── 3. peekEmailVerifyToken — non-consuming by construction ────────────────
console.log("\npeekEmailVerifyToken:");

let findFirstResult = null;
let writes = 0;
prisma.agent.findFirst = async () => findFirstResult;
prisma.agent.updateMany = async () => { writes++; return { count: 1 }; };
prisma.agent.update = async () => { writes++; return {}; };

await atest("valid unexpired token → pending credits, ZERO writes", async () => {
  writes = 0;
  findFirstResult = { pendingCredits: 75, verifyTokenExpiry: new Date(Date.now() + 60_000) };
  const peek = await peekEmailVerifyToken(TOKEN);
  assert.deepStrictEqual(peek, { pendingCredits: 75 });
  assert.strictEqual(writes, 0, "peek must never write (scanner GETs cannot burn the token)");
});

await atest("expired token → null", async () => {
  findFirstResult = { pendingCredits: 75, verifyTokenExpiry: new Date(Date.now() - 1000) };
  assert.strictEqual(await peekEmailVerifyToken(TOKEN), null);
});

await atest("unknown token → null", async () => {
  findFirstResult = null;
  assert.strictEqual(await peekEmailVerifyToken(TOKEN), null);
});

await atest("short/garbage token → null without a DB call", async () => {
  findFirstResult = { pendingCredits: 75, verifyTokenExpiry: null };
  assert.strictEqual(await peekEmailVerifyToken("short"), null);
  assert.strictEqual(await peekEmailVerifyToken(""), null);
});

// ─── 4. Route wiring — real express app, stubbed prisma ─────────────────────
console.log("\nRoute wiring (GET renders / POST consumes):");

const { default: agentRouter } = await import("../dist/routes/agent.js");
const express = (await import("express")).default;
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/v1/agent", agentRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

const AGENT_ROW = {
  id: "agent-verify-1",
  email: "verify@example.com",
  emailVerified: false,
  pendingCredits: 75,
  verifyTokenExpiry: new Date(Date.now() + 60_000),
};

await atest("GET with a valid token → 200 confirm page, token NOT consumed", async () => {
  writes = 0;
  findFirstResult = { ...AGENT_ROW };
  const res = await fetch(`${BASE}/v1/agent/verify-email?token=${TOKEN}`);
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.ok(html.includes('method="POST"'), "renders the confirm form");
  assert.ok(html.includes(TOKEN), "form carries the token");
  assert.strictEqual(writes, 0, "GET performed zero writes");
  assertCredentialFree(html, "GET confirm page");
});

await atest("GET with a malformed token → 400 error page, injection never echoed", async () => {
  const evil = encodeURIComponent('"><script>alert(1)</script>');
  const res = await fetch(`${BASE}/v1/agent/verify-email?token=${evil}`);
  const html = await res.text();
  assert.strictEqual(res.status, 400);
  assert.ok(!html.includes("<script>alert(1)</script>"), "payload not reflected");
});

await atest("GET with an unknown token → 400 error page", async () => {
  findFirstResult = null;
  const res = await fetch(`${BASE}/v1/agent/verify-email?token=${"b2".repeat(32)}`);
  assert.strictEqual(res.status, 400);
});

await atest("POST (form-encoded, as the confirm button submits) → 200 activation page", async () => {
  writes = 0;
  findFirstResult = { ...AGENT_ROW };
  const res = await fetch(`${BASE}/v1/agent/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `token=${TOKEN}`,
  });
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.ok(html.includes("75"), "activated credits rendered");
  assert.ok(html.includes("https://archtools.dev/mcp"), "launchpad CTAs present");
  assert.strictEqual(writes, 1, "POST consumed the token (single atomic write)");
  assertCredentialFree(html, "POST activation page");
});

await atest("POST with a JSON body works too (programmatic verifiers)", async () => {
  findFirstResult = { ...AGENT_ROW };
  const res = await fetch(`${BASE}/v1/agent/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN }),
  });
  assert.strictEqual(res.status, 200);
});

await atest("POST with an already-used token (claim lost) → 400", async () => {
  findFirstResult = { ...AGENT_ROW };
  prisma.agent.updateMany = async () => ({ count: 0 }); // concurrent claim already won
  const res = await fetch(`${BASE}/v1/agent/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `token=${TOKEN}`,
  });
  assert.strictEqual(res.status, 400);
});

await atest("POST with a malformed token → 400 without touching the DB", async () => {
  let dbCalls = 0;
  prisma.agent.findFirst = async () => { dbCalls++; return null; };
  const res = await fetch(`${BASE}/v1/agent/verify-email`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `token=notatoken`,
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(dbCalls, 0, "format gate rejects before any DB lookup");
});

server.close();

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall verify-activation tests passed");
process.exit(0);
