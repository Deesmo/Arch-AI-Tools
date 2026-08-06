/**
 * Verify-email RESEND endpoint — regression tests (2026-07-28).
 *
 * POST /v1/agent/verify-email/resend is the recovery path for expired/lost
 * verification links. Covers:
 *   - ANTI-ENUMERATION: byte-identical neutral 200 body for unknown email,
 *     already-verified account, and cooldown no-op — account state never leaks.
 *   - Happy path: existing unverified account with an expired token gets a
 *     fresh token (single write rotating ONLY verifyToken/verifyTokenExpiry —
 *     credit fields must NEVER be touched; the old issueEmailVerification
 *     path would have zeroed pendingCredits).
 *   - Cooldown: a token minted moments ago is NOT re-minted.
 *   - Rate limit: 4th request for the same email+IP within the hour → 429,
 *     counted BEFORE any DB read (unknown emails burn the same budget).
 *   - Browser form posts get a neutral script-free HTML page.
 *   - Recovery links render on the verify error page + signup success card.
 *
 * Uses the built dist with a stubbed prisma layer (same pattern as
 * verify-activation.test.mjs) plus a real express app on an ephemeral port.
 *
 * Run: cd api && npm run build && node tests/verify-resend.test.mjs
 */
import assert from "assert";

process.env.DATABASE_URL ??= "postgresql://stub:stub@127.0.0.1:5432/stub";
process.env.JWT_SECRET ??= "test-secret-do-not-use-in-prod";

const { prisma } = await import("../dist/lib/prisma.js");
const { renderVerifyErrorPage, renderVerifyResendSentPage } = await import("../dist/assets/verifyEmailHtml.js");
const { SIGNUP_HTML } = await import("../dist/assets/signupHtml.js");

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}
async function atest(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

// Pages reachable from an emailed link must be credential-free and inert.
function assertCredentialFree(html, label) {
  assert.ok(!/arch_[a-f0-9]/i.test(html), `${label}: must not contain an API key`);
  assert.ok(!html.toLowerCase().includes("localstorage"), `${label}: must not touch localStorage`);
  assert.ok(!html.toLowerCase().includes("sessionstorage"), `${label}: must not touch sessionStorage`);
  assert.ok(!html.toLowerCase().includes("<script"), `${label}: must contain zero scripts`);
}

const TTL_MS = 30 * 60 * 1000; // mirrors VERIFY_TOKEN_TTL_MS

// ─── 1. Recovery-surface renders ─────────────────────────────────────────────
console.log("Recovery surfaces:");

test("error page: script-free resend form posting to the real route", () => {
  const html = renderVerifyErrorPage();
  assert.ok(html.includes('action="/v1/agent/verify-email/resend"'), "form targets the resend route");
  assert.ok(html.includes('method="POST"'), "form must POST");
  assert.ok(html.includes('type="email"'), "email input present");
  assert.ok(html.toLowerCase().includes("didn't get the email"), "recovery copy present");
  assertCredentialFree(html, "error page");
});

test("resend-sent page: neutral (no existence claim), script-free", () => {
  const html = renderVerifyResendSentPage();
  assert.ok(html.includes("If an unverified account exists"), "conditional, non-confirming copy");
  assert.ok(!html.toLowerCase().includes("account found"), "never confirms existence");
  assertCredentialFree(html, "resend-sent page");
});

test("signup success card: resend link wired to the resend route, click-only", () => {
  assert.ok(SIGNUP_HTML.includes("fetch('/v1/agent/verify-email/resend'"), "posts to the resend route");
  assert.ok(SIGNUP_HTML.includes('id="resend-verify-link"'), "resend link present");
  assert.ok(SIGNUP_HTML.includes("resendLink.addEventListener('click'"), "fires only on click");
  // server message mirrored via textContent, never innerHTML
  assert.ok(SIGNUP_HTML.includes("note.textContent = (d && d.message)"), "response rendered inert");
  assert.ok(!/innerHTML\s*=\s*\(d && d\.message\)/.test(SIGNUP_HTML), "no markup-capable sink for the response");
});

// ─── 2. Route behavior — real express app, stubbed prisma ───────────────────
console.log("\nRoute behavior:");

const { default: agentRouter } = await import("../dist/routes/agent.js");
const express = (await import("express")).default;
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/v1/agent", agentRouter);
const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

// prisma stubs — reissueEmailVerification resolves the account via a
// normalized-identity $queryRaw (Gmail dot/plus/googlemail alias forms must
// match the stored row), so the raw query is the stub point. Rows come back
// with the raw snake_case column names.
let agentRow = null;          // what the normalized-identity lookup returns
let updates = [];             // captured update() calls
let lookupParams = [];        // captured $queryRaw bind values
const rawRow = () => ({
  id: agentRow.id,
  email: agentRow.email ?? "stored@example.com",
  email_verified: agentRow.emailVerified,
  pending_credits: agentRow.pendingCredits,
  verify_token_expiry: agentRow.verifyTokenExpiry,
});
const stubLookup = async (_strings, ...values) => { lookupParams = values; return agentRow ? [rawRow()] : []; };
prisma.$queryRaw = stubLookup;
prisma.agent.update = async (args) => { updates.push(args); return {}; };

async function postResend(email, headers = {}) {
  const res = await fetch(`${BASE}/v1/agent/verify-email/resend`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ email }),
  });
  const text = await res.text();
  return { res, text };
}

// The exact neutral body every internal outcome must produce (modulo request_id).
function neutralShape(text) {
  const body = JSON.parse(text);
  assert.strictEqual(body.ok, true);
  assert.ok(body.message.includes("If an unverified account exists"), "neutral conditional message");
  delete body.request_id;
  return JSON.stringify(body);
}

await atest("happy path: unverified account + EXPIRED token → 200, single token-only rotation", async () => {
  updates = [];
  agentRow = {
    id: "agent-resend-1",
    emailVerified: false,
    pendingCredits: 75,
    verifyTokenExpiry: new Date(Date.now() - 60_000), // expired 1 min ago (issued 31 min ago)
  };
  const { res, text } = await postResend("stranded@example.com");
  assert.strictEqual(res.status, 200);
  neutralShape(text);
  assert.strictEqual(updates.length, 1, "exactly one write");
  const data = updates[0].data;
  assert.ok(/^[a-f0-9]{64}$/.test(data.verifyToken), "fresh 64-hex token minted");
  assert.ok(data.verifyTokenExpiry > new Date(), "new expiry in the future");
  // CRITICAL: the resend must never touch credit fields (the signup-time
  // issueEmailVerification would have SET pendingCredits to 0 here).
  for (const forbidden of ["credits", "pendingCredits", "emailVerified"]) {
    assert.ok(!(forbidden in data), `resend must not write ${forbidden}`);
  }
});

let happyBody;
await atest("anti-enumeration: unknown email → SAME 200 body, zero writes", async () => {
  updates = [];
  agentRow = { id: "x", emailVerified: false, pendingCredits: 75, verifyTokenExpiry: new Date(Date.now() - 60_000) };
  const known = await postResend("known-unverified@example.com");
  const knownShape = neutralShape(known.text);
  happyBody = knownShape;

  updates = [];
  agentRow = null; // account does not exist
  const unknown = await postResend("nobody@example.com");
  assert.strictEqual(unknown.res.status, 200, "unknown email still 200");
  assert.strictEqual(neutralShape(unknown.text), knownShape, "byte-identical body shape");
  assert.strictEqual(updates.length, 0, "no writes for unknown email");
});

await atest("anti-enumeration: already-verified account → SAME 200 body, zero writes", async () => {
  updates = [];
  agentRow = { id: "agent-v", emailVerified: true, pendingCredits: 0, verifyTokenExpiry: null };
  const { res, text } = await postResend("verified@example.com");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(neutralShape(text), happyBody, "identical to the happy-path body");
  assert.strictEqual(updates.length, 0, "no token minted for a verified account");
});

await atest("cooldown: token minted moments ago → 200 but NOT re-minted", async () => {
  updates = [];
  agentRow = {
    id: "agent-cool",
    emailVerified: false,
    pendingCredits: 75,
    verifyTokenExpiry: new Date(Date.now() + TTL_MS - 1000), // issued ~1s ago
  };
  const { res, text } = await postResend("justsent@example.com");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(neutralShape(text), happyBody, "cooldown is invisible in the response");
  assert.strictEqual(updates.length, 0, "no re-mint inside the cooldown");
});

await atest("no-token unverified account (failed signup setup) → recoverable", async () => {
  updates = [];
  agentRow = { id: "agent-notoken", emailVerified: false, pendingCredits: 0, verifyTokenExpiry: null };
  const { res } = await postResend("failedsetup@example.com");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(updates.length, 1, "token issued even when none existed");
});

await atest("gmail alias submitted → stored dotted account still found, token rotated", async () => {
  updates = [];
  agentRow = {
    id: "agent-alias",
    email: "j.doe.stored@gmail.com", // signup stored the dotted form
    emailVerified: false,
    pendingCredits: 75,
    verifyTokenExpiry: new Date(Date.now() - 60_000), // expired
  };
  const { res, text } = await postResend("jdoestored+recover@googlemail.com");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(neutralShape(text), happyBody);
  assert.ok(lookupParams.includes("jdoestored@gmail.com"), "lookup queries the NORMALIZED identity");
  assert.strictEqual(updates.length, 1, "stored account's token rotated despite the alias mismatch");
});

await atest("rate limit: 4th request for the same email+IP within the hour → 429 (pre-DB)", async () => {
  agentRow = null;
  let dbReads = 0;
  prisma.$queryRaw = async () => { dbReads++; return []; };
  const email = "ratelimit-me@example.com";
  for (let i = 0; i < 3; i++) {
    const { res } = await postResend(email);
    assert.strictEqual(res.status, 200, `request ${i + 1} allowed`);
  }
  const readsBefore = dbReads;
  const { res, text } = await postResend(email);
  assert.strictEqual(res.status, 429, "4th request blocked");
  const body = JSON.parse(text);
  assert.strictEqual(body.error, "rate_limited");
  assert.strictEqual(dbReads, readsBefore, "429 issued before any DB read");
  // a DIFFERENT email from the same IP is not collateral damage
  const other = await postResend("someone-else@example.com");
  assert.strictEqual(other.res.status, 200, "per-email key, not a blanket IP ban");
  prisma.$queryRaw = stubLookup;
});

await atest("gmail dot/plus aliases share one rate-limit budget (no farming around it)", async () => {
  agentRow = null;
  for (const alias of ["rl.alias@gmail.com", "rlalias+1@gmail.com", "r.l.alias@googlemail.com"]) {
    const { res } = await postResend(alias);
    assert.strictEqual(res.status, 200, `${alias} allowed`);
  }
  const { res } = await postResend("rlalias@gmail.com");
  assert.strictEqual(res.status, 429, "normalized-identity budget exhausted");
});

await atest("browser form post (urlencoded + Accept: text/html) → neutral script-free HTML page", async () => {
  agentRow = null;
  const res = await fetch(`${BASE}/v1/agent/verify-email/resend`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    body: "email=formuser%40example.com",
  });
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.ok(html.includes("If an unverified account exists"), "neutral copy");
  assert.ok(!html.includes("formuser"), "submitted email never reflected");
  assertCredentialFree(html, "resend HTML response");
});

await atest("missing/garbage email → 400 invalid_request (never a 500)", async () => {
  for (const bad of [undefined, "", "notanemail", "a@b", "x".repeat(255) + "@example.com"]) {
    const res = await fetch(`${BASE}/v1/agent/verify-email/resend`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bad === undefined ? {} : { email: bad }),
    });
    assert.strictEqual(res.status, 400, `rejected: ${String(bad).slice(0, 20)}`);
    const body = await res.json();
    assert.strictEqual(body.error, "invalid_request");
  }
});

await atest("internal DB error → still the neutral 200 (no availability oracle)", async () => {
  prisma.$queryRaw = async () => { throw new Error("db down"); };
  const { res, text } = await postResend("dbdown@example.com");
  assert.strictEqual(res.status, 200);
  assert.strictEqual(neutralShape(text), happyBody);
  prisma.$queryRaw = stubLookup;
});

server.close();

if (failures) { console.error(`\n${failures} failed`); process.exit(1); }
console.log("\nall verify-resend tests passed");
process.exit(0);
