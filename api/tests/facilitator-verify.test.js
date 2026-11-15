/**
 * Focused regression test for facilitator verification durability.
 *
 * Run: npm run build && node tests/facilitator-verify.test.js
 */
import assert from "assert";
import bcrypt from "bcryptjs";
import express from "express";
import fs from "fs";
import http from "http";
import net from "net";
import path from "path";
import { fileURLToPath } from "url";
import { privateKeyToAccount } from "viem/accounts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (...p) => path.join(__dirname, "..", "dist", ...p);
const routeSrc = fs.readFileSync(
  path.join(__dirname, "..", "src", "routes", "facilitator.ts"),
  "utf-8",
);

let failures = 0;
function test(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === "function") {
      return result
        .then(() => console.log(`  ✓ ${name}`))
        .catch((e) => {
          failures++;
          console.error(`  ✗ ${name}: ${e.message}`);
        });
    }
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

const verifyRoute = routeSrc.match(
  /router\.post\("\/verify"[\s\S]*?\n\}\);\n\n\/\/ ─── POST \/settle/,
)?.[0] ?? "";

console.log("Facilitator — verification durability:");

test("verification route was found", () => {
  assert.ok(verifyRoute, "could not isolate /verify route");
});

test("releaseNonce is available to undo a verified-but-unrecorded payment", () => {
  assert.ok(
    /releaseNonce/.test(routeSrc),
    "facilitator route must import and call releaseNonce",
  );
});

test("successful verification record creation is awaited and not swallowed", () => {
  assert.ok(
    /await prisma\.facilitatorPayment\.create\(/.test(verifyRoute),
    "verified payment must be persisted before returning success",
  );
  assert.ok(
    !/facilitatorPayment\.create\([\s\S]{0,700}\)\.catch\(/.test(verifyRoute),
    "verified payment persistence failure must not be swallowed",
  );
});

test("persistence failure releases nonce and returns retryable 503", () => {
  assert.ok(
    /catch \(err\) \{[\s\S]*await releaseNonce\(nonce, provider\.id\)[\s\S]*res\.status\(503\)\.json/.test(verifyRoute),
    "verified-but-unrecorded payment must release nonce and return 503",
  );
  assert.ok(
    /verification_persistence_error/.test(verifyRoute),
    "503 response should identify verification persistence failure",
  );
});

await test("POST /verify returns 503 when durable verification write fails", async () => {
  // Local JSON-RPC stub lets collectability checks pass deterministically so
  // this test reaches the durable-write failure path without public RPC access.
  const rpcServer = await new Promise((resolve) => {
    const s = http.createServer(async (req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : {};
        let result = "0x";
        if (body.method === "eth_chainId") result = "0x14a34";
        else if (body.method === "eth_call") {
          const data = String(body.params?.[0]?.data ?? "").toLowerCase();
          // balanceOf(address) -> enough USDC; authorizationState(...) -> false.
          result = data.startsWith("0x70a08231")
            ? `0x${BigInt(1_000_000).toString(16).padStart(64, "0")}`
            : `0x${"0".repeat(64)}`;
        }
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? 1, result }));
      });
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const rpcAddress = rpcServer.address();
  process.env.BASE_SEPOLIA_RPC = `http://127.0.0.1:${rpcAddress.port}`;
  const redisServer = await new Promise((resolve) => {
    const s = net.createServer((socket) => {
      socket.on("data", (chunk) => {
        const commands = chunk.toString("utf8").split("\r\n*").length;
        socket.write("+OK\r\n".repeat(commands));
      });
    });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
  const redisAddress = redisServer.address();
  process.env.REDIS_URL = `redis://127.0.0.1:${redisAddress.port}`;

  const [{ prisma }, { default: facilitatorRouter }, { redis }] = await Promise.all([
    import(dist("lib", "prisma.js")),
    import(dist("routes", "facilitator.js")),
    import(dist("lib", "redis.js")),
  ]);

  const facilitatorKey = "fac_test_verify_persistence";
  const provider = {
    id: "provider_verify_persistence",
    name: "Verify Persistence Test Provider",
    apiKeyHash: bcrypt.hashSync(facilitatorKey, 4),
    walletAddress: "0x2222222222222222222222222222222222222222",
    feePercent: 2.5,
    networks: ["eip155:84532"],
    active: true,
  };

  const originals = {
    findMany: prisma.facilitatorProvider.findMany,
    findUnique: prisma.facilitatorProvider.findUnique,
    create: prisma.facilitatorPayment.create,
  };

  let createAttempted = false;
  prisma.facilitatorProvider.findMany = async () => [provider];
  prisma.facilitatorProvider.findUnique = async () => provider;
  prisma.facilitatorPayment.create = async () => {
    createAttempted = true;
    throw new Error("simulated db write outage");
  };

  const account = privateKeyToAccount(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  );
  const token = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const authorization = {
    from: account.address,
    to: provider.walletAddress,
    value: "1000000",
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 3600),
    nonce: `0x${"1".repeat(64)}`,
  };
  const signature = await account.signTypedData({
    domain: {
      name: "USD Coin",
      version: "2",
      chainId: 84532n,
      verifyingContract: token,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: authorization,
  });
  const payment = Buffer.from(JSON.stringify({
    scheme: "exact",
    network: "eip155:84532",
    payload: { signature, authorization },
  })).toString("base64");

  const app = express();
  app.use(express.json());
  app.use("/api/v1/facilitator", facilitatorRouter);

  const server = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });

  try {
    const address = server.address();
    const res = await fetch(`http://127.0.0.1:${address.port}/api/v1/facilitator/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${facilitatorKey}`,
      },
      body: JSON.stringify({
        payment,
        paymentDetails: {
          scheme: "exact",
          network: "eip155:84532",
          maxAmountRequired: "1000000",
          resource: "https://merchant.example/paid",
          payTo: provider.walletAddress,
          asset: token,
        },
      }),
    });
    const body = await res.json();

    assert.strictEqual(createAttempted, true, `verified payment create was not attempted; response=${JSON.stringify(body)}`);
    assert.strictEqual(res.status, 503);
    assert.strictEqual(body.ok, false);
    assert.strictEqual(body.error, "verification_persistence_error");
    assert.notStrictEqual(body.isValid, true, "must not report isValid true without a durable record");
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    prisma.facilitatorProvider.findMany = originals.findMany;
    prisma.facilitatorProvider.findUnique = originals.findUnique;
    prisma.facilitatorPayment.create = originals.create;
    await new Promise((resolve, reject) => rpcServer.close((err) => err ? reject(err) : resolve()));
    redis?.disconnect();
    await new Promise((resolve, reject) => redisServer.close((err) => err ? reject(err) : resolve()));
    delete process.env.REDIS_URL;
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}

console.log("\nAll facilitator verification durability tests passed.");
