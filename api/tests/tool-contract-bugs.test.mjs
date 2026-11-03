/**
 * Tool bugs found while writing input schemas from the handlers (2026-11-03).
 *  - barcode-generate drew one bar per set bit of each character (not Code 128,
 *    unscannable) and "qr" drew the same bars → bwip-js symbologies.
 *  - crypto-sentiment 404'd on tickers (BTC) → same ticker map as crypto-price.
 *  - ai-generate charged for requested max_tokens above the 4096 it serves.
 *  - design-create read only .url; gpt-image-1 returns b64_json.
 * Static checks always run; TEST_ALLOW_SIGNUP=1 + a local TEST_BASE_URL also
 * calls barcode-generate end to end.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const tools = readFileSync(new URL("../src/routes/tools/index.ts", import.meta.url), "utf8");
const route = (name) => { const a = tools.indexOf(`router.post("/${name}"`); return tools.slice(a, tools.indexOf("router.post(", a + 10)); };

assert.ok(route("barcode-generate").includes('await import("bwip-js")'), "barcode uses bwip-js");
assert.ok(!route("barcode-generate").includes("Simple encoding: alternate bars"), "fake encoder removed");
assert.ok(route("crypto-sentiment").includes("const id = normalizeCoinId(symbol);"), "crypto-sentiment maps tickers");
assert.ok(route("ai-generate").includes("const requestedTokens = Math.min(4096,"), "ai-generate charges up to the served 4096");
assert.ok(route("design-create").includes("img.b64_json ? `data:image/png;base64,${img.b64_json}`"), "design-create reads b64_json");
assert.ok(!/model: "gpt-image-1"/.test(tools), "gpt-image-1 is retired for generation; use OPENAI_IMAGE_MODEL");
assert.ok(tools.includes('const OPENAI_IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";'));

const { toSVG } = await import("bwip-js");
assert.match(toSVG({ bcid: "code128", text: "ARCH-1", scale: 3, height: 12 }), /^<svg viewBox="0 0 \d+ \d+"/, "bwip-js SVG has a viewBox and no fixed size (the handler sets it)");

const BASE = (process.env.TEST_BASE_URL || "").replace(/\/$/, "");
if (process.env.TEST_ALLOW_SIGNUP === "1" && /^http:\/\/(localhost|127\.0\.0\.1)/.test(BASE)) {
  const json = { "Content-Type": "application/json" };
  const { api_key } = await (await fetch(`${BASE}/v1/agent/register`, { method: "POST", headers: json, body: JSON.stringify({ email: `bc-${Date.now()}@example.com` }) })).json();
  const call = async (body) => (await fetch(`${BASE}/v1/tools/barcode-generate`, { method: "POST", headers: { ...json, Authorization: `Bearer ${api_key}` }, body: JSON.stringify(body) })).json();
  let d = await call({ value: "ARCH-123456" });
  assert.ok(d.ok && d.type === "code128" && d.svg.startsWith('<svg width="250" height="100"'));
  d = await call({ value: "https://archtools.dev", format: "qr" });
  assert.ok(d.ok && d.type === "qr" && d.width === d.height, "QR is square");
  d = await call({ value: "x", format: "ean13" });
  assert.equal(d.ok, false);
}

console.log("All tool-contract-bugs tests passed.");
