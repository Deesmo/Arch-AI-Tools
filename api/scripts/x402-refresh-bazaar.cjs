/**
 * Keep every ArchTools tool listed in Coinbase's x402 Bazaar (the index Agentic
 * Market and other agent marketplaces search).
 *
 * The CDP facilitator lists an endpoint the first time a payment for it settles,
 * and drops it from search after 30 days without one
 * (https://docs.cdp.coinbase.com/x402/bazaar). This script pays ONE call for
 * every catalog tool that is not listed or has had no paid call for --days
 * (default 25), from a wallet you choose, and reports what it spent.
 *
 * Dry run (default; no wallet needed, nothing is paid):
 *   cd api && npm install && node scripts/x402-refresh-bazaar.cjs
 * Pay:
 *   node scripts/x402-refresh-bazaar.cjs --wallet ~/.openclaw/bazaar-buyer-wallet.json --yes
 *
 * Options:
 *   --wallet <file>   JSON file with a "privateKey" field (or set PAYER_PRIVATE_KEY)
 *   --yes             actually pay (USDC on Base)
 *   --only a,b,c      just these tools (e.g. to retry failures)
 *   --all             every tool, listed or not
 *   --days <n>        refresh tools idle this many days (default 25)
 *   --max-usd <n>     refuse to start if the total is higher (default 5)
 *   --base <url>      API to pay (default https://archtools.dev)
 * Skipped always: email-send/send-email (account-only, no anonymous x402) and
 * any tool /api/status reports unavailable (a paid call would fail).
 */

const fs = require("fs");
const path = require("path");
const { wrapFetchWithPaymentFromConfig } = require("@x402/fetch");
const { ExactEvmScheme } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BAZAAR_MERCHANT = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant";
const INPUTS = require("./x402-bazaar-inputs.json");
const ACCOUNT_ONLY = new Set(["email-send", "send-email"]);

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const flag = (name) => argv.includes(name);
const BASE = opt("--base", "https://archtools.dev").replace(/\/+$/, "");
const DAYS = Number(opt("--days", "25"));
const MAX_USD = Number(opt("--max-usd", "5"));
const ONLY = opt("--only", "") ? new Set(opt("--only", "").split(",").map((s) => s.trim())) : null;
const PAY = flag("--yes");

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`GET ${url} → HTTP ${r.status}`);
  return r.json();
}

function loadAccount() {
  let key = process.env.PAYER_PRIVATE_KEY;
  const file = opt("--wallet");
  if (!key && file) {
    const w = JSON.parse(fs.readFileSync(file.replace(/^~(?=\/)/, process.env.HOME), "utf8"));
    key = w.privateKey;
    if (!key) throw new Error(`${file} has no "privateKey" field`);
  }
  if (!key) return null;
  return privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`);
}

const toolOf = (url) => new URL(url).pathname.replace(/^\/v1\/tools\//, "");

// Price and paid-for resource from the tool's own 402 challenge (for tools the
// manifest omits). A catalog alias settles as its canonical tool (check-domain's
// challenge names domain-check), so it is listed under that name, never its own.
async function challengeInfo(tool) {
  const r = await fetch(`${BASE}/v1/tools/${tool}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(30_000),
  });
  const hdr = r.headers.get("payment-required");
  if (r.status !== 402 || !hdr) return null;
  const challenge = JSON.parse(Buffer.from(hdr, "base64").toString());
  const usdc = (challenge.accepts ?? []).find((a) => a.network === "eip155:8453" && a.asset.toLowerCase() === BASE_USDC.toLowerCase());
  if (!usdc) return null;
  const resource = challenge.resource?.url ?? usdc.resource;
  return { usd: Number(usdc.amount ?? usdc.maxAmountRequired) / 1e6, paysFor: resource ? toolOf(resource) : tool };
}

async function main() {
  const account = loadAccount();
  if (PAY && !account) throw new Error("--yes needs --wallet <file> or PAYER_PRIVATE_KEY");

  // Prices and payTo from the server's own x402 manifest — no unpaid probes.
  const manifest = await getJson(`${BASE}/.well-known/x402`);
  const rail = manifest.supportedRails.find((r) => r.network === "eip155:8453" && r.asset.toLowerCase() === BASE_USDC.toLowerCase());
  if (!rail) throw new Error("The server offers no USDC-on-Base rail");
  const price = new Map(manifest.endpoints.map((e) => [toolOf(`${BASE}${e.path}`), Number(String(e.price).replace("$", ""))]));

  const catalog = (await getJson(`${BASE}/v1/tools`)).tools.map((t) => t.name);
  const status = await getJson(`${BASE}/api/status`).catch(() => ({}));
  const unavailable = new Set(status.tools_unavailable ?? []);

  // What the Bazaar already lists for this merchant, and when each was last paid.
  const listed = new Map();
  for (let offset = 0; ; offset += 100) {
    const page = await getJson(`${BAZAAR_MERCHANT}?payTo=${rail.payTo}&limit=100&offset=${offset}`);
    for (const r of page.resources ?? []) listed.set(toolOf(r.resource), r.quality?.lastCalledAt ?? null);
    if (!page.pagination || offset + 100 >= page.pagination.total) break;
  }

  // The Bazaar recomputes lastCalledAt only every six hours, so also trust our own
  // record of what this script paid (carried forward in the report file).
  const report = path.join(process.cwd(), "x402-bazaar-refresh-result.json");
  const paidByUs = {};
  try {
    const prev = JSON.parse(fs.readFileSync(report, "utf8"));
    if (prev.base !== BASE || prev.payTo !== rail.payTo) throw new Error("report is for another server");
    Object.assign(paidByUs, prev.lastPaid ?? {});
    for (const r of prev.results ?? []) {
      if (r.tx && !paidByUs[r.tool]) paidByUs[r.tool] = prev.at;
      if (r.sessionCreate?.tx && !paidByUs["session-create"]) paidByUs["session-create"] = prev.at;
    }
  } catch { /* no earlier run here */ }

  const cutoff = Date.now() - DAYS * 86_400_000;
  const plan = [];
  const skipped = [];
  for (const tool of catalog) {
    if (ONLY && !ONLY.has(tool)) continue;
    const bazaarLast = listed.get(tool);
    const last = [bazaarLast, paidByUs[tool]].filter(Boolean).sort().pop();
    const due = ONLY || flag("--all") || !last || Date.parse(last) < cutoff;
    if (!due) continue;
    if (ACCOUNT_ONLY.has(tool)) { skipped.push(`${tool} (account-only)`); continue; }
    if (unavailable.has(tool)) { skipped.push(`${tool} (unavailable now)`); continue; }
    if (!INPUTS[tool]) { skipped.push(`${tool} (no sample input in x402-bazaar-inputs.json)`); continue; }
    if (!price.has(tool)) {
      const info = await challengeInfo(tool).catch(() => null);
      if (!info) { skipped.push(`${tool} (no USDC-on-Base price)`); continue; }
      if (info.paysFor !== tool) { skipped.push(`${tool} (alias: paid and listed as ${info.paysFor})`); continue; }
      price.set(tool, info.usd);
    }
    // session-message needs a session: one extra session-create call, same wallet.
    const parts = tool === "session-message"
      ? { "session-create": price.get("session-create") ?? 0, "session-message": price.get(tool) }
      : { [tool]: price.get(tool) };
    const usd = Object.values(parts).reduce((s, v) => s + v, 0);
    plan.push({ tool, usd, parts, reason: !listed.has(tool) ? "not listed" : last ? `last paid ${last.slice(0, 10)}` : "never paid" });
  }
  // session-message's own session-create call already refreshes session-create.
  if (plan.some((p) => p.tool === "session-message")) {
    const i = plan.findIndex((p) => p.tool === "session-create");
    if (i >= 0) { plan.splice(i, 1); skipped.push("session-create (paid inside the session-message call)"); }
  }

  const total = plan.reduce((s, p) => s + p.usd, 0);
  console.log(`API ${BASE} → pays to ${rail.payTo} (USDC on Base)`);
  if (account) console.log(`Payer ${account.address}`);
  console.log(`Bazaar lists ${listed.size} of ${catalog.length} tools. ${plan.length} need a paid call; total $${total.toFixed(3)} USDC.\n`);
  for (const p of plan) console.log(`  ${p.tool.padEnd(28)} $${p.usd.toFixed(3)}  ${p.reason}`);
  for (const s of skipped) console.log(`  skip ${s}`);
  if (!plan.length) return;
  if (total > MAX_USD) throw new Error(`Total $${total.toFixed(3)} is over --max-usd ${MAX_USD}; raise it to proceed`);
  if (!PAY) {
    console.log("\nDry run: nothing paid. Add --wallet <file> --yes to pay.");
    return;
  }

  const pay = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],
    // Base USDC only, never more than $0.50 for one call.
    policies: [(_v, reqs) => reqs.filter((r) => r.network === "eip155:8453" && r.asset.toLowerCase() === BASE_USDC.toLowerCase())],
    spendControls: { maxAmountPerPayment: "$0.50" },
  });
  const call = async (tool, body) => {
    const r = await pay(`${BASE}/v1/tools/${tool}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const settled = r.headers.get("payment-response");
    const tx = settled ? JSON.parse(Buffer.from(settled, "base64").toString()).transaction || null : null;
    const json = await r.json().catch(() => null);
    return { status: r.status, tx, json };
  };

  console.log("");
  const results = [];
  for (const p of plan) {
    const row = { tool: p.tool, usd: p.usd, spentUsd: 0 };
    try {
      let body = INPUTS[p.tool];
      if (p.tool === "session-message") {
        const s = await call("session-create", INPUTS["session-create"]);
        row.sessionCreate = { status: s.status, tx: s.tx };
        if (s.tx) row.spentUsd += p.parts["session-create"];
        if (!s.json?.session_id) throw new Error(`session-create returned HTTP ${s.status}`);
        body = { ...body, session_id: s.json.session_id };
      }
      const r = await call(p.tool, body);
      Object.assign(row, { status: r.status, tx: r.tx });
      if (r.tx) row.spentUsd += p.parts[p.tool];
      else row.error = r.json?.error ?? "no settlement";
    } catch (e) {
      row.error = String(e?.message ?? e);
    }
    results.push(row);
    const note = row.tx && row.status >= 400 ? "  (paid, but the tool itself failed)" : "";
    console.log(`  ${p.tool.padEnd(28)} ${row.tx ? `HTTP ${row.status}  settled ${row.tx}${note}` : `FAILED ${row.status ?? ""} ${row.error}`}`);
  }

  // A settled payment is what gets a tool listed, even if the call itself failed.
  const settled = results.filter((r) => r.tx);
  // Every settled payment counts, including a session-create whose message then failed.
  const spent = results.reduce((s, r) => s + r.spentUsd, 0);
  const toolFailed = settled.filter((r) => r.status >= 400).map((r) => r.tool);
  if (toolFailed.length) console.log(`\nPaid but the tool returned an error: ${toolFailed.join(", ")}`);
  const at = new Date().toISOString();
  for (const r of results) {
    if (r.tx) paidByUs[r.tool] = at;
    if (r.sessionCreate?.tx) paidByUs["session-create"] = at;
  }
  fs.writeFileSync(report, JSON.stringify({ at, base: BASE, payer: account.address, payTo: rail.payTo, spentUsd: spent, lastPaid: paidByUs, results }, null, 2));
  console.log(`\nSettled ${settled.length}/${plan.length}, spent about $${spent.toFixed(3)} USDC. Report: ${report}`);
  const failed = results.filter((r) => !r.tx).map((r) => r.tool);
  if (failed.length) console.log(`Retry the failures with: --only ${failed.join(",")}`);
  console.log(`The Bazaar indexes new payments within minutes; re-run without --yes to see the updated list.`);
  if (failed.length) process.exitCode = 2;
}

main().catch((e) => {
  console.error(`❌ ${e?.message ?? e}`);
  process.exit(1);
});
