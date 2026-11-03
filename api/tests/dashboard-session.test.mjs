/**
 * Dashboard sign-in (2026-11-03).
 *
 * Keys are stored only as a hash, so after sign-in the browser never has the
 * full key. The dashboard used to ask /auth/api-key for it, always got null,
 * and showed "Session error". It now reads the account with the session cookie
 * on a short list of account routes, and "New key" replaces a lost key.
 *
 * Static checks always run. Live checks run against TEST_BASE_URL (default
 * prod) and change nothing. TEST_ALLOW_SIGNUP=1 also runs the full flow
 * (register → session → usage → new key → first password); use it only
 * against a local server.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── Static ──────────────────────────────────────────────────────────────────
const dash = src("src/assets/dashboardHtml.ts");
assert.ok(!dash.includes('"/auth/api-key"'), "dashboard must not ask for the full key (only its hash exists)");
assert.ok(!/localStorage\.setItem\("arch_api_key"/.test(dash), "dashboard must not keep the key in browser storage");
assert.ok(!/Authorization: "Bearer " \+/.test(dash), "dashboard calls ride the session, not a key");
assert.ok(dash.includes('fetch("/v1/agent/usage", { credentials: "include" })'), "dashboard loads usage with the session");
assert.ok(dash.includes('fetch("/v1/agent/keys/rotate"'), "dashboard can replace a lost key");

const login = src("src/assets/loginHtml.ts");
assert.ok(login.includes("var next = safeNext(params.get('next'));"), "login must sanitise ?next=");
assert.ok(!login.includes("sessionStorage.setItem('arch_api_key'"), "login must not keep the key in browser storage");
assert.ok(login.includes(String.raw`/^\\/(?![\\/\\\\])/`), "safeNext must only allow same-site paths");
const safeNext = (n) => (typeof n === "string" && /^\/(?![\/\\])/.test(n)) ? n : "/dashboard";
assert.equal(safeNext("/pricing"), "/pricing");
assert.equal(safeNext("https://evil.example"), "/dashboard");
assert.equal(safeNext("//evil.example"), "/dashboard");
assert.equal(safeNext("/\\evil.example"), "/dashboard");
assert.equal(safeNext(null), "/dashboard");

const index = src("src/index.ts");
const optIn = index.match(/app\.use\(\s*\[([^\]]+)\],\s*allowSessionAuth,?\s*\)/);
assert.ok(optIn, "session opt-in must be an explicit route list");
assert.ok(!/\/v1\/tools/.test(optIn[1]), "tool routes must never accept the session cookie");
assert.ok(!/"\/v1\/agent"[,\]]/.test(optIn[1]), "account deletion (DELETE /v1/agent) must not accept the session cookie");

const mw = src("src/middleware/auth.ts");
assert.ok(mw.includes('req.method !== "GET" && req.method !== "HEAD" && !isSameOrigin(req)'), "session writes need a same-site Origin");

const authRoutes = src("src/routes/auth.ts");
assert.ok(authRoutes.includes('error: "password_already_set"'), "a session may set only the FIRST password");

// ── Live (read-only) ────────────────────────────────────────────────────────
const BASE = (process.env.TEST_BASE_URL || "https://archtools.dev").replace(/\/$/, "");
const fetchNo = (path, init = {}) => fetch(BASE + path, { redirect: "manual", ...init });

let r = await fetchNo("/dashboard");
assert.equal(r.status, 302, "dashboard without a session redirects to sign-in");
assert.match(r.headers.get("location") || "", /^\/login\?next=\/dashboard/);

r = await fetchNo("/v1/agent/usage", { headers: { Cookie: "arch_session=forged.token.value" } });
assert.equal(r.status, 401, "a forged session cookie is refused");

r = await fetchNo("/v1/agent/balance", { headers: { Origin: "https://evil.example" } });
assert.equal(r.status, 403, "a page on another site gets 403, not 500");
assert.equal((await r.json()).error, "origin_not_allowed");

// ── Full flow (local only) ──────────────────────────────────────────────────
if (process.env.TEST_ALLOW_SIGNUP === "1") {
  const json = { "Content-Type": "application/json" };
  const email = `dash-${Date.now()}@example.com`;
  const reg = await (await fetchNo("/v1/agent/register", { method: "POST", headers: json, body: JSON.stringify({ email }) })).json();
  assert.ok(reg.api_key, "register returns a key");

  r = await fetchNo("/auth/login-key", { method: "POST", headers: json, body: JSON.stringify({ api_key: reg.api_key }) });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  assert.match(cookie, /^arch_session=/);
  const sess = { Cookie: cookie };
  const same = { ...sess, ...json, Origin: BASE };

  const me = await (await fetchNo("/auth/me", { headers: sess })).json();
  assert.equal(me.has_password, false);
  assert.ok(me.api_key_masked);

  r = await fetchNo("/v1/agent/usage", { headers: sess });
  assert.equal(r.status, 200, "usage loads with the session alone");
  assert.equal((await fetchNo("/v1/agent/balance", { headers: sess })).status, 401, "routes outside the opt-in list still need a key");
  assert.notEqual((await fetchNo("/v1/tools/generate-uuid", { method: "POST", headers: same, body: "{}" })).status, 200, "a session can never run a tool");
  assert.equal((await fetchNo("/v1/agent/keys/rotate", { method: "POST", headers: { ...sess, ...json }, body: "{}" })).status, 401, "a session write without Origin is refused");

  const rot = await (await fetchNo("/v1/agent/keys/rotate", { method: "POST", headers: same, body: "{}" })).json();
  assert.ok(rot.api_key && rot.api_key !== reg.api_key, "New key returns a fresh key once");
  assert.equal((await fetchNo("/v1/agent/usage", { headers: { Authorization: `Bearer ${reg.api_key}` } })).status, 401, "old key stops working");
  assert.equal((await fetchNo("/v1/agent/usage", { headers: { Authorization: `Bearer ${rot.api_key}` } })).status, 200, "new key works");

  r = await fetchNo("/auth/set-password", { method: "POST", headers: same, body: JSON.stringify({ password: "first-password-1" }) });
  assert.equal(r.status, 200, "a session can set the first password");
  r = await fetchNo("/auth/set-password", { method: "POST", headers: same, body: JSON.stringify({ password: "second-password-2" }) });
  assert.equal(r.status, 409, "a session cannot replace an existing password");
}

console.log("All dashboard-session tests passed.");
