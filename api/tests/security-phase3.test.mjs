/**
 * Security follow-ups from the 2026-11-02 audit (findings 4, 6, 7, 8, 9, 10, 11, 14).
 *
 *  4  Public submission forms are bounded (rate limit, field sizes, queue cap)
 *     and non-tool routes take at most 256 KB of JSON (413 above).
 *  6  An async handler that throws reaches the JSON error handler instead of
 *     hanging the request or exiting the process.
 *  7  research-report's BYOK discount needs the caller's keys for ALL paid work.
 *  8  Referral rewards: same private domain refused; per-domain and lifetime caps.
 *  9  Sending email needs a verified account; both email tools share one limit;
 *     every message carries an "API user" footer.
 * 10  OAuth: http(s)-only redirect URIs, destination host + unverified-app
 *     warning on consent, Cancel as a link, one-click consent when signed in.
 * 11  req.ip is the visitor (CF-Connecting-IP from Cloudflare hops only).
 * 14  Rotating the API key revokes OAuth tokens.
 *
 * Static + pure checks always run (they import the built dist/). Live checks
 * run only against a local server (TEST_BASE_URL=http://localhost:…).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.JWT_SECRET ??= "test-only-secret";
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// 11 — real visitor IP
const { realClientIp, isCloudflareIp } = await import("../dist/lib/clientIp.js");
assert.equal(isCloudflareIp("172.71.146.207"), true, "prod-observed edge IP is Cloudflare");
assert.equal(isCloudflareIp("2606:4700::1"), true);
assert.equal(isCloudflareIp("75.189.50.1"), false);
assert.equal(realClientIp("172.71.146.207", "75.189.50.1"), "75.189.50.1", "Cloudflare hop → CF-Connecting-IP");
assert.equal(realClientIp("::ffff:172.71.146.207", "75.189.50.1"), "75.189.50.1", "IPv4-mapped hop");
assert.equal(realClientIp("203.0.113.9", "1.2.3.4"), "203.0.113.9", "direct-to-Render can't spoof the header");
assert.equal(realClientIp("172.71.146.207", "not-an-ip"), "172.71.146.207", "garbage header ignored");
assert.ok(src("src/index.ts").includes("app.use(useRealClientIp);"));
for (const f of ["src/middleware/analytics.ts", "src/routes/affiliate.ts"]) {
  assert.ok(!src(f).includes('headers["x-forwarded-for"]'), `${f}: no client-settable X-Forwarded-For reads`);
}

// 6 — async errors
assert.ok(src("src/index.ts").includes('import "./lib/asyncErrors.js";'), "async-error shim is loaded");

// 7 — research-report discount
const tools = src("src/routes/tools/index.ts");
assert.ok(tools.includes("const rrFullByok = !!(byokTavilyKeyRR || byokBraveKeyRR) && !!byokAnthropicKeyRR;"));
assert.ok(tools.includes("const tavilyKey = byokTavilyKeyRR || (rrFullByok ? undefined : process.env.TAVILY_API_KEY);"), "no platform fallback when discounted");

// 9 — email
assert.equal((tools.match(/if \(!\(await requireVerifiedSender\(req, res\)\)\) return;/g) ?? []).length, 2, "both email tools need a verified sender");
assert.ok(tools.includes('"email-send": ["email-send", "send-email"]'), "shared daily allowance");
assert.ok(tools.includes("Sent by an Arch Tools API user, not by Arch Tools."), "attribution footer");

// 8 — referral
const { privateEmailDomain, REFERRAL_DOMAIN_CAP, REFERRAL_LIFETIME_CAP } = await import("../dist/lib/referralReward.js");
assert.equal(privateEmailDomain("a@gmail.com"), null);
assert.equal(privateEmailDomain("a@Catch-All.example"), "catch-all.example");
assert.ok(REFERRAL_DOMAIN_CAP >= 1 && REFERRAL_LIFETIME_CAP >= REFERRAL_DOMAIN_CAP);

// 10 — OAuth consent
const { CONSENT_PAGE, isAllowedRedirectUri } = await import("../dist/routes/oauth.js");
for (const ok of ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3334/callback", "http://127.0.0.1:9/cb"]) assert.ok(isAllowedRedirectUri(ok), ok);
for (const bad of ["javascript://localhost/%0aalert(1)", "data:text/html,x", "http://evil.example/cb", "cursor://x/y", "not a url"]) assert.ok(!isAllowedRedirectUri(bad), bad);
let page = CONSENT_PAGE("Claude", "tools:execute", "arch_x", "https://evil.example/cb", "s1", "", "");
assert.ok(page.includes("evil.example"), "consent shows the real destination host");
assert.ok(page.includes("Arch Tools has not verified this app"), "unknown host warns");
assert.ok(page.includes('href="https://evil.example/cb?error=access_denied&amp;state=s1"'), "Cancel is a link (CSP blocks cross-site form posts)");
assert.ok(page.includes('placeholder="arch_..."'), "real key prefix");
page = CONSENT_PAGE("Claude", "tools:execute", "arch_x", "https://claude.ai/api/mcp/auth_callback", "", "", "", undefined, "me@example.com");
assert.ok(!page.includes("has not verified"), "known host: no warning");
assert.ok(page.includes('name="use_session" value="1"') && page.includes("Signed in as <strong>me@example.com</strong>"), "one-click consent when signed in");
assert.ok(!page.includes('name="apiKey"'), "no key prompt when signed in");

// 14 — rotation revokes OAuth
assert.ok(src("src/routes/agent.ts").includes("prisma.oAuthToken.deleteMany({ where: { agentId: agent.id } })"));

// 4 — bounded submissions
assert.ok(src("src/routes/mcp-marketplace.ts").includes('router.post("/servers/submit", submitLimiter,'));
assert.ok(src("src/routes/directory.ts").includes('router.post("/submit", directorySubmitLimiter,'));

// ── Live (local server only; creates nothing it can't, and resets on restart) ─
const BASE = (process.env.TEST_BASE_URL || "").replace(/\/$/, "");
if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) {
  const post = (path, body, raw = false) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? body : JSON.stringify(body) });
  let r = await post("/v1/agent/register", { email: 1 });
  assert.equal(r.status, 400, "non-string email is a 400 (it used to crash the process)");
  assert.equal((await fetch(BASE + "/health")).status, 200, "server still up after the malformed request");
  r = await post("/oauth/register", { client_name: "x", redirect_uris: ["javascript://localhost/alert(1)"] });
  assert.equal(r.status, 400, "javascript: redirect refused");
  r = await post("/oauth/token", { grant_type: "authorization_code", client_id: "nope", client_secret: { a: 1 }, code: "x" });
  assert.ok([400, 401].includes(r.status), `object client_secret answered (${r.status}), not hung`);
  r = await post("/v1/agent/register", JSON.stringify({ email: "a@example.com", pad: "x".repeat(300_000) }), true);
  assert.equal(r.status, 413, "256 KB cap outside tool routes");
  r = await post("/api/v1/mcp/servers/submit", { name: "n", description: "d".repeat(5000), repository: "javascript:x", contactEmail: "a@b.co", category: "x" });
  assert.equal(r.status, 400, "non-http repository refused");
}

console.log("All security-phase3 tests passed.");
