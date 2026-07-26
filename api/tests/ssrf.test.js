/**
 * SSRF regression tests.
 *
 * Run from api/: node --loader ts-node/esm tests/ssrf.test.js
 */
import assert from "assert";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { createPinnedLookup, safeAxiosRequest, validateUrl } from "../src/lib/ssrf.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

function lookupAsync(lookup, hostname, options = {}) {
  return new Promise((resolve, reject) => {
    lookup(hostname, options, (err, address, family) => {
      if (err) reject(err);
      else resolve({ address, family });
    });
  });
}

function lookupAllAsync(lookup, hostname) {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses);
    });
  });
}

async function withLocalServer(fn) {
  let hit = false;
  const server = http.createServer((_, res) => {
    hit = true;
    res.end("internal");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = server.address().port;
    await fn(port, () => hit);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function main() {
  console.log("SSRF — URL validation:");
  await test("rejects localhost", async () => {
    await assert.rejects(() => validateUrl("http://localhost:3000"), /not allowed/);
  });
  await test("rejects private IPv4 literals", async () => {
    await assert.rejects(() => validateUrl("http://10.0.0.1/"), /private|not allowed/);
  });
  await test("rejects link-local metadata IP", async () => {
    await assert.rejects(() => validateUrl("http://169.254.169.254/latest/meta-data"), /private|not allowed/);
  });

  console.log("SSRF — pinned outbound lookup:");
  const target = {
    url: new URL("https://rebind.example/path"),
    hostname: "rebind.example",
    address: "93.184.216.34",
    family: 4,
  };
  const lookup = createPinnedLookup(target);

  await test("returns the already-validated address for connect-time lookup", async () => {
    const result = await lookupAsync(lookup, "rebind.example");
    assert.deepStrictEqual(result, { address: "93.184.216.34", family: 4 });
  });
  await test("supports all:true without re-resolving the hostname", async () => {
    const result = await lookupAllAsync(lookup, "rebind.example");
    assert.deepStrictEqual(result, [{ address: "93.184.216.34", family: 4 }]);
  });
  await test("blocks unexpected hostname lookups on the pinned agent", async () => {
    await assert.rejects(() => lookupAsync(lookup, "metadata.google.internal"), /Unexpected hostname lookup/);
  });

  console.log("SSRF — webhook-send guardrails:");
  await test("safeAxiosRequest rejects internal URLs before opening a socket", async () => {
    await withLocalServer(async (port, wasHit) => {
      await assert.rejects(
        () => safeAxiosRequest(`http://127.0.0.1:${port}/webhook`, {
          method: "POST",
          data: { ok: true },
          timeout: 500,
        }),
        /private|not allowed/
      );
      assert.strictEqual(wasHit(), false, "internal server received a request");
    });
  });
  await test("webhook-send uses the pinned Axios helper", async () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "tools", "index.ts"), "utf8");
    assert.ok(src.includes("safeAxiosRequest(webhook_url"));
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll SSRF tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
