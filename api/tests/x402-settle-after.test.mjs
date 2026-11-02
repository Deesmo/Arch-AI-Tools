/**
 * x402 settle-after-success: deferResponse holds the tool's response until the
 * payment decision, then replays it byte-for-byte or replaces it.
 * Run: cd api && npm run build && node tests/x402-settle-after.test.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import express from "express";
import { deferResponse } from "../dist/middleware/deferResponse.js";

const png = randomBytes(64 * 1024); // binary body must survive byte-for-byte
const seen = [];
const app = express();
app.use((req, res, next) =>
  deferResponse(res, next, async ({ statusCode }) => {
    seen.push([req.path, statusCode]);
    if (statusCode >= 400) return { headers: { "X-Payment-Settled": "false" } };
    if (req.path === "/settle-fails") return { replace: { status: 402, body: { ok: false, error: "payment_settlement_failed" } } };
    if (req.path === "/decide-throws") throw new Error("facilitator down");
    return { headers: { "PAYMENT-RESPONSE": "c2V0dGxlZA==" } };
  }),
);
app.get("/json", (_req, res) => { res.json({ ok: true, n: 1 }); });
app.get("/binary", (_req, res) => { res.setHeader("Content-Disposition", "inline"); res.type("image/png").send(png); });
app.get("/stream", (_req, res) => { res.write("a"); setTimeout(() => { res.write("b"); res.end("c"); }, 20); });
app.get("/fail", (_req, res) => { res.status(503).json({ ok: false, error: "upstream_unavailable" }); });
app.get("/raw-500", (_req, res) => { res.writeHead(500, { "Content-Type": "text/plain" }); res.end("boom"); });
app.get("/settle-fails", (_req, res) => { res.setHeader("Content-Disposition", "attachment"); res.type("image/png").send(png); });
app.get("/decide-throws", (_req, res) => { res.json({ ok: true }); });

const server = app.listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => { const r = await fetch(base + p); return { r, buf: Buffer.from(await r.arrayBuffer()) }; };

try {
  let { r, buf } = await get("/json");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("payment-response"), "c2V0dGxlZA==", "settled call carries PAYMENT-RESPONSE");
  assert.deepEqual(JSON.parse(buf), { ok: true, n: 1 });

  ({ r, buf } = await get("/binary"));
  assert.equal(r.status, 200);
  assert.ok(buf.equals(png), "binary body replayed byte-for-byte");
  assert.equal(r.headers.get("content-type"), "image/png");

  ({ r, buf } = await get("/stream"));
  assert.equal(buf.toString(), "abc", "chunked writes replayed in order");

  ({ r, buf } = await get("/fail"));
  assert.equal(r.status, 503);
  assert.equal(r.headers.get("payment-response"), null, "failed call is never settled");
  assert.equal(r.headers.get("x-payment-settled"), "false");
  assert.equal(JSON.parse(buf).error, "upstream_unavailable", "failed call body passes through");

  ({ r, buf } = await get("/raw-500"));
  assert.equal(r.status, 500);
  assert.equal(r.headers.get("payment-response"), null, "explicit writeHead(500) is seen as a failure");

  ({ r, buf } = await get("/settle-fails"));
  assert.equal(r.status, 402, "settlement failure replaces the tool output");
  assert.equal(JSON.parse(buf).error, "payment_settlement_failed");
  assert.equal(r.headers.get("content-disposition"), null, "tool headers that describe the old body are dropped");
  assert.match(r.headers.get("content-type"), /^application\/json/, "the 402 is labelled as JSON, not the tool's image type");

  ({ r, buf } = await get("/decide-throws"));
  assert.equal(r.status, 503, "an exception while settling never releases the paid output");
  assert.equal(JSON.parse(buf).error, "payment_processing_error");

  assert.deepEqual(seen.map(([, s]) => s), [200, 200, 200, 503, 500, 200, 200], "decision sees the handler's real status");
} finally {
  server.close();
}

// The middleware wires it behind an off-by-default switch, releasing the nonce on failure.
const mw = readFileSync(new URL("../src/middleware/x402.ts", import.meta.url), "utf8");
assert.ok(mw.includes('process.env.X402_SETTLE_AFTER_RESPONSE === "1"'), "deferred settle is behind a switch");
const deferred = mw.slice(mw.indexOf("await deferResponse(res, next"));
const failBranch = deferred.slice(deferred.indexOf("statusCode >= 400"), deferred.indexOf("settleAndRecord(false)"));
assert.ok(!failBranch.includes("releaseStoredNonce"), "a failed call keeps its nonce consumed (no replay of one signature)");
assert.ok(deferred.indexOf("settleAndRecord(false)") > deferred.indexOf("statusCode >= 400"), "settle only after the status check, without releasing the nonce");
assert.ok(mw.includes("const paymentResponse = await settleAndRecord(true);"), "settle-first order may still release the nonce (tool not run yet)");

console.log("All x402-settle-after tests passed.");
