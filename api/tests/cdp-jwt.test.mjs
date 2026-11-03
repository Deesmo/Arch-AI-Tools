/**
 * lib/cdpJwt.ts replaced @coinbase/cdp-sdk/auth (2026-11-03) to drop zod 3
 * (GHSA-mrhx-c7xc-m3w5). It must keep producing the tokens CDP accepts: the
 * same header and claims the SDK built, for both key types, verifiable with
 * the matching public key; and wallet-auth tokens on account-creating calls.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { jwtVerify, decodeProtectedHeader, decodeJwt } from "jose";

const { generateJwt, generateWalletJwt, cdpAuthHeaders } = await import("../dist/lib/cdpJwt.js");
const opts = (secret) => ({ apiKeyId: "organizations/o/apiKeys/k", apiKeySecret: secret, requestMethod: "GET", requestHost: "api.cdp.coinbase.com", requestPath: "/platform/v2/evm/token-balances/base/0xabc" });

const ec = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const ed = crypto.generateKeyPairSync("ed25519");
const edSecret = Buffer.concat([
  ed.privateKey.export({ format: "der", type: "pkcs8" }).subarray(-32),
  ed.publicKey.export({ format: "der", type: "spki" }).subarray(-32),
]).toString("base64");

for (const [alg, secret, pub] of [["ES256", ec.privateKey.export({ type: "pkcs8", format: "pem" }), ec.publicKey], ["EdDSA", edSecret, ed.publicKey]]) {
  const t = await generateJwt(opts(secret));
  await jwtVerify(t, pub);
  const h = decodeProtectedHeader(t), c = decodeJwt(t);
  assert.equal(h.alg, alg); assert.equal(h.typ, "JWT"); assert.equal(h.kid, "organizations/o/apiKeys/k"); assert.match(String(h.nonce), /^[0-9a-f]{32}$/);
  assert.equal(c.sub, "organizations/o/apiKeys/k"); assert.equal(c.iss, "cdp");
  assert.deepEqual(c.uris, ["GET api.cdp.coinbase.com/platform/v2/evm/token-balances/base/0xabc"]);
  assert.equal(c.exp - c.nbf, 120); assert.equal(c.iat, c.nbf);
}
await assert.rejects(generateJwt(opts("not-a-key")), /Invalid key format/);

const w = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const walletSecret = w.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const wt = await generateWalletJwt({ walletSecret, requestMethod: "POST", requestHost: "api.cdp.coinbase.com", requestPath: "/platform/v2/evm/accounts", requestData: { b: { z: 1, a: 2 }, name: "x" } });
await jwtVerify(wt, w.publicKey);
assert.equal(decodeJwt(wt).reqHash, crypto.createHash("sha256").update(JSON.stringify({ b: { a: 2, z: 1 }, name: "x" })).digest("hex"), "reqHash over key-sorted body");

const h = await cdpAuthHeaders({ apiKeyId: "k", apiKeySecret: edSecret, walletSecret, method: "POST", path: "/platform/v2/evm/accounts", body: { name: "x" } });
assert.ok(h.Authorization.startsWith("Bearer ") && h["X-Wallet-Auth"], "account creation sends both tokens");
assert.ok(!(await cdpAuthHeaders({ apiKeyId: "k", apiKeySecret: edSecret, method: "GET", path: "/platform/v2/evm/token-balances/base/0x1" }))["X-Wallet-Auth"], "reads need no wallet token");

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
for (const dep of ["@coinbase/cdp-sdk", "@coinbase/x402", "@mendable/firecrawl-js", "@x402/express", "@x402/core", "@x402/extensions", "@x402/svm"]) {
  assert.ok(!(dep in (pkg.dependencies ?? {})), `${dep} stays out of runtime dependencies`);
}
assert.ok(/^\^4\./.test(pkg.overrides?.zod ?? ""), "zod pinned to 4 (GHSA-mrhx-c7xc-m3w5)");

console.log("All cdp-jwt tests passed.");
