/**
 * Front door (2026-11-03): what a visitor or an SDK meets first.
 *
 * - No page points at packages, hosts or accounts that don't exist.
 * - The published SDKs' default host (arch-ai-tools.onrender.com) serves API
 *   calls in place: an HTTP client drops the Authorization header when it
 *   follows a redirect to another host, so redirecting them made every SDK
 *   call an unauthenticated 402.
 * - /status reads /api/status (the public /health is { ok } only).
 * - The enterprise form posts to our own server (CSP form-action 'self'
 *   blocked the old formsubmit.co target).
 *
 * Static checks always run; live checks use TEST_BASE_URL (default prod) and
 * change nothing. The Host-header check runs only against a local server.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import http from "node:http";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const walk = (dir) => readdirSync(new URL(dir, root)).flatMap((f) => {
  const p = `${dir}/${f}`;
  return statSync(new URL(p, root)).isDirectory() ? walk(p) : [p];
});

// ── Static ──────────────────────────────────────────────────────────────────
const DEAD = [
  "@archtools/sdk",          // never published; real: @deesmo/arch-tools-sdk
  "@arch-tools/client",
  "@arch-tools/mcp-server",
  "npx arch-tools-mcp",      // real: npx -y @deesmo/arch-tools-mcp
  "archtools.dev/mcp/mcp",   // 404; real: https://archtools.dev/mcp
  "archtools.dev/mcp/sse",   // 404; SSE lives on arch-tools-mcp.onrender.com/sse
  "x.com/AiArchTools",       // account does not exist
  "github.com/AiArchTools",
  "formsubmit.co",
];
const files = [...walk("public"), ...walk("src/assets"), "src/routes/chat.ts", "src/routes/discovery.ts", "src/data/mcp-servers.json"]
  .filter((f) => /\.(html|txt|json|ts|rss|xml)$/.test(f));
for (const f of files) {
  const s = read(f);
  for (const d of DEAD) assert.ok(!s.includes(d), `${f} still mentions ${d}`);
}

// "/signin" means sign in (→ /login); signup CTAs must link /signup directly.
for (const f of files) assert.ok(!read(f).includes('href="/signin'), `${f}: signup CTAs link /signup, not /signin`);

const enterprise = read("public/enterprise.html");
assert.ok(enterprise.includes('action="/api/enterprise/inquiry"'), "enterprise form posts to our own server");
assert.ok(read("public/status.html").includes("fetch('/api/status'"), "status page reads /api/status");

const index = read("src/index.ts");
const m = index.match(/const API_PATH = (\/.*\/);/);
assert.ok(m, "canonical redirect must exempt API paths");
const API_PATH = eval(m[1]);
for (const p of ["/v1/tools/generate-uuid", "/v1/agent/balance", "/api/status", "/mcp", "/oauth/token", "/auth/login", "/health", "/.well-known/x402"]) assert.ok(API_PATH.test(p), `${p} is served in place`);
for (const p of ["/", "/docs", "/pricing", "/v1tools", "/mcp-setup"]) assert.ok(!API_PATH.test(p), `${p} is a page and still redirects`);

for (const f of ["../sdk/python/arch_tools/client.py", "../sdk/typescript/src/index.ts"]) {
  assert.ok(!read(f).includes("onrender.com"), `${f}: SDK source defaults to archtools.dev`);
}

// ── Live (read-only) ────────────────────────────────────────────────────────
const BASE = (process.env.TEST_BASE_URL || "https://archtools.dev").replace(/\/$/, "");

let r = await fetch(`${BASE}/api/status`);
assert.equal(r.status, 200, "/api/status is up");
const st = await r.json();
assert.equal(st.components?.database, "operational");
assert.ok(Array.isArray(st.tools_unavailable));
assert.ok(!("dependencies" in st), "no internals on the public status");

// dist/ is built on deploy (no longer committed), so the build must copy
// src/data/*.json next to the compiled routes that read them.
assert.ok(JSON.parse(read("package.json")).scripts.build.includes("cpSync('src/data','dist/data'"), "build copies src/data into dist/data");
r = await fetch(`${BASE}/api/v1/x402/directory`);
assert.ok((await r.json()).services?.length > 0, "x402 directory lists services");
r = await fetch(`${BASE}/api/v1/mcp/servers`);
assert.ok((await r.json()).servers?.length > 0, "MCP marketplace lists servers");

r = await fetch(`${BASE}/health`);
assert.deepEqual(await r.json(), { ok: true }, "public /health stays { ok } only");

r = await fetch(`${BASE}/api/enterprise/inquiry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "x" }) });
assert.equal(r.status, 400, "an incomplete inquiry is refused (and sends nothing)");

if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) {
  const u = new URL(BASE);
  const viaRender = (path, method = "GET") => new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers: { Host: "arch-ai-tools.onrender.com", "Content-Type": "application/json" } }, (res) => { res.resume(); resolve(res); });
    req.on("error", reject);
    req.end(method === "POST" ? "{}" : undefined);
  });
  let res = await viaRender("/v1/tools/generate-uuid", "POST");
  assert.notEqual(res.statusCode, 301, "SDK calls on the Render host are served in place");
  res = await viaRender("/pricing");
  assert.equal(res.statusCode, 301, "pages on the Render host still redirect to archtools.dev");
  assert.equal(res.headers.location, "https://archtools.dev/pricing");
}

console.log("All site-front-door tests passed.");
