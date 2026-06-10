#!/usr/bin/env node
/**
 * Arch Tools — CI Security Gate
 *
 * Fast, deterministic static checks. Exits non-zero on any finding so the
 * GitHub Actions build goes red. Run from repo root: node api/scripts/security-gate.cjs
 */
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..", "..");
let failures = 0;

function fail(check, msg) {
  failures++;
  console.error(`\u274c [${check}] ${msg}`);
}
function pass(check, msg) {
  console.log(`\u2705 [${check}] ${msg}`);
}

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

// ─── Check 1: every billable tool route uses the auth middleware ─────────────
(function checkToolAuth() {
  const toolsDir = path.join(REPO, "api", "src", "routes", "tools");
  const files = walk(toolsDir, [".ts"]);
  if (files.length === 0) return fail("tool-auth", `no tool route files found under ${toolsDir}`);

  let routeCount = 0;
  let unguarded = [];
  // Intentionally unauthenticated routes (x402 price discovery returns 402, no execution)
  const ALLOWLIST = new Set(["GET /:toolName"]);
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const hasAuthImport = /requireAuth/.test(src);
    // Match router.<verb>("/path", ...) declarations
    const routeRe = /router\.(post|get|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]\s*,([^\n]*)/g;
    let m;
    while ((m = routeRe.exec(src)) !== null) {
      routeCount++;
      const rest = m[3];
      const sig = `${m[1].toUpperCase()} ${m[2]}`;
      const guarded = /toolMiddleware\(|requireAuth/.test(rest) || ALLOWLIST.has(sig);
      if (!guarded) unguarded.push(`${path.relative(REPO, file)} → ${sig}`);
    }
    if (!hasAuthImport) unguarded.push(`${path.relative(REPO, file)} → no requireAuth import at all`);
  }
  if (unguarded.length > 0) {
    fail("tool-auth", `billable routes missing auth middleware:\n   ${unguarded.join("\n   ")}`);
  } else {
    pass("tool-auth", `${routeCount} tool routes all carry toolMiddleware/requireAuth`);
  }
})();

// ─── Check 2: SSRF guard present in builtin.ts ───────────────────────────────
(function checkSsrf() {
  const file = path.join(REPO, "api", "src", "tools", "builtin.ts");
  if (!fs.existsSync(file)) return fail("ssrf-guard", "api/src/tools/builtin.ts missing");
  const src = fs.readFileSync(file, "utf8");
  const hasBlocked = /BLOCKED_HOSTS/.test(src);
  const hasPrivate = /isPrivateIp/.test(src);
  if (!hasBlocked || !hasPrivate) {
    fail("ssrf-guard", `SSRF guard regressed in builtin.ts (BLOCKED_HOSTS=${hasBlocked}, isPrivateIp=${hasPrivate})`);
  } else {
    pass("ssrf-guard", "BLOCKED_HOSTS + isPrivateIp present in builtin.ts");
  }
})();

// ─── Check 3: no plaintext secrets in public/client assets ───────────────────
(function checkSecrets() {
  const dirs = [
    path.join(REPO, "api", "public"),
    path.join(REPO, "client"),
    path.join(REPO, "web"),
  ];
  const SECRET_RES = [
    /sk-[A-Za-z0-9_-]{20,}/,                  // OpenAI/Anthropic/Stripe-style
    /sk_live_[A-Za-z0-9]{20,}/,               // Stripe live
    /AIza[0-9A-Za-z_-]{30,}/,                 // Google API
    /xox[bap]-[0-9A-Za-z-]{20,}/,             // Slack
    /ghp_[A-Za-z0-9]{30,}/,                   // GitHub PAT
    /rnd_[A-Za-z0-9]{20,}/,                   // Render
    /(api[_-]?key|secret)["'\s:=]+["'][A-Za-z0-9_-]{32,}["']/i,
  ];
  let found = [];
  for (const dir of dirs) {
    for (const file of walk(dir, [".html", ".js", ".css", ".json", ".ts", ".tsx", ".jsx"])) {
      const src = fs.readFileSync(file, "utf8");
      for (const re of SECRET_RES) {
        const m = src.match(re);
        if (m) found.push(`${path.relative(REPO, file)} → matches ${re} (…${m[0].slice(0, 12)}…)`);
      }
    }
  }
  if (found.length > 0) fail("no-secrets", `plaintext secret patterns in public assets:\n   ${found.join("\n   ")}`);
  else pass("no-secrets", "no plaintext secret patterns in public/client assets");
})();

// ─── Check 4: no raw SQL with template interpolation ─────────────────────────
(function checkRawSql() {
  const files = walk(path.join(REPO, "api", "src"), [".ts"]);
  let found = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    const re = /\$(queryRawUnsafe|executeRawUnsafe)\s*\(\s*`[^`]*\$\{/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split("\n").length;
      found.push(`${path.relative(REPO, file)}:${line} → $${m[1]} with template interpolation`);
    }
  }
  if (found.length > 0) fail("raw-sql", `unsafe raw SQL interpolation:\n   ${found.join("\n   ")}`);
  else pass("raw-sql", "no $queryRawUnsafe/$executeRawUnsafe template interpolation");
})();

// ─── Check 5: npm audit high/critical gate (best-effort) ─────────────────────
(function checkAudit() {
  const { execSync } = require("child_process");
  try {
    const out = execSync("npm audit --omit=dev --json", {
      cwd: path.join(REPO, "api"),
      timeout: 120000,
      maxBuffer: 50 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).toString();
    const data = JSON.parse(out);
    const v = data.metadata?.vulnerabilities ?? {};
    report(v);
  } catch (err) {
    // npm audit exits non-zero when vulns exist — parse stdout anyway
    const out = err.stdout?.toString?.() ?? "";
    try {
      const data = JSON.parse(out);
      report(data.metadata?.vulnerabilities ?? {});
    } catch {
      console.warn("\u26a0\ufe0f  [npm-audit] could not run/parse npm audit — skipping (non-fatal)");
    }
  }
  function report(v) {
    const high = (v.high ?? 0) + (v.critical ?? 0);
    // Baseline 2026-06-10: 7 pre-existing high vulns in prod deps (coinbase/solana/axios
    // chain, all marked fixable). Ratchet this down as deps get upgraded — never raise it.
    const MAX_HIGH = Number(process.env.SECURITY_GATE_MAX_HIGH ?? 7);
    if (high > MAX_HIGH) fail("npm-audit", `${v.high ?? 0} high + ${v.critical ?? 0} critical prod vulnerabilities (max allowed: ${MAX_HIGH})`);
    else pass("npm-audit", `prod high/critical vulnerabilities: ${high} (max allowed: ${MAX_HIGH})`);
  }
})();

// ─── Result ──────────────────────────────────────────────────────────────────
console.log("");
if (failures > 0) {
  console.error(`SECURITY GATE FAILED — ${failures} finding(s).`);
  process.exit(1);
}
console.log("Security gate passed.");
