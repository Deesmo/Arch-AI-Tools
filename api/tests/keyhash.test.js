/**
 * Focused tests for Phase B API-key hardening (no plaintext keys at rest):
 *  - pre-existing hashed key still authenticates (next() called, no 401)
 *  - a newly generated key (hash-only persisted) authenticates
 *  - bogus key → 401
 *  - admin /lookup compiled output no longer selects or returns full apiKey
 *  - registration/rotation compiled output no longer persists plaintext apiKey
 *
 * Run: node tests/keyhash.test.js  (requires `npm run build` first for dist/)
 */
import assert from "assert";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (...p) => path.join(__dirname, "..", "dist", ...p);

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

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}
function mockReq(key) {
  return { headers: { authorization: `Bearer ${key}` } };
}

async function main() {
  const { prisma } = await import(dist("lib", "prisma.js"));
  const { requireAuth, requireApiKeyAuth } = await import(dist("middleware", "auth.js"));

  // ── Mock DB: one pre-existing agent with ONLY prefix + bcrypt hash stored ──
  const existingKey = "arch_preexisting_key_0123456789abcdef";
  const existingAgent = {
    id: "agent_existing", apiKeyPrefix: existingKey.slice(0, 12),
    apiKeyHash: bcrypt.hashSync(existingKey, 4),
    email: "a@b.c", credits: 100, tier: "free", totalCalls: 0,
  };
  // newly created key — simulates registration path persisting hash only
  const newKey = `arch_${"f".repeat(48)}`;
  const newAgent = {
    id: "agent_new", apiKeyPrefix: newKey.slice(0, 12),
    apiKeyHash: bcrypt.hashSync(newKey, 4),
    email: "n@b.c", credits: 100, tier: "free", totalCalls: 0,
  };
  const rows = [existingAgent, newAgent];
  prisma.agent.findFirst = async ({ where }) =>
    rows.find((r) => r.apiKeyPrefix === where.apiKeyPrefix) ?? null;
  prisma.agent.findUnique = async ({ where }) =>
    rows.find((r) => r.id === where.id) ?? null;
  prisma.oAuthToken.findUnique = async ({ where }) =>
    where.accessToken === "at_oauth_readonly"
      ? {
          accessToken: "at_oauth_readonly",
          agentId: existingAgent.id,
          scope: "tools:read",
          expiresAt: new Date(Date.now() + 60_000),
        }
      : null;
  prisma.agent.update = async () => ({});

  console.log("Phase B — requireAuth (hash-only):");
  await test("pre-existing hashed key authenticates (no 401, next called)", async () => {
    const req = mockReq(existingKey); const res = mockRes();
    let nexted = false;
    await requireAuth(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, true, "next() not called");
    assert.strictEqual(res.statusCode, null, `got status ${res.statusCode}`);
    assert.strictEqual(req.agent.id, "agent_existing");
  });

  await test("new key (hash-only persisted) authenticates", async () => {
    const req = mockReq(newKey); const res = mockRes();
    let nexted = false;
    await requireAuth(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, true, "next() not called");
    assert.strictEqual(req.agent.id, "agent_new");
  });

  await test("bogus key → 401", async () => {
    const req = mockReq("arch_bogus_key_zzzzzzzzzzzzzzzzzzzzzzzz"); const res = mockRes();
    let nexted = false;
    await requireAuth(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, false, "next() should not be called");
    assert.strictEqual(res.statusCode, 401);
  });

  await test("right prefix, wrong key → 401 (bcrypt mismatch)", async () => {
    const req = mockReq(existingKey.slice(0, 12) + "WRONG_SUFFIX_000000"); const res = mockRes();
    let nexted = false;
    await requireAuth(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, false);
    assert.strictEqual(res.statusCode, 401);
  });

  console.log("OAuth — account management gate:");
  await test("OAuth token authenticates but cannot pass account-management gate", async () => {
    const req = mockReq("at_oauth_readonly"); const res = mockRes();
    let authed = false;
    await requireAuth(req, res, () => { authed = true; });
    assert.strictEqual(authed, true, "OAuth token should still authenticate");
    assert.strictEqual(req.agent.scope, "tools:read");

    let authorized = false;
    requireApiKeyAuth(req, res, () => { authorized = true; });
    assert.strictEqual(authorized, false, "OAuth token must not authorize account management");
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.error, "insufficient_authentication");
  });

  await test("API-key caller passes account-management gate", async () => {
    const req = mockReq(existingKey); const res = mockRes();
    await requireAuth(req, res, () => {});

    let authorized = false;
    requireApiKeyAuth(req, res, () => { authorized = true; });
    assert.strictEqual(authorized, true);
    assert.strictEqual(res.statusCode, null);
  });

  console.log("Phase B — no plaintext at rest (compiled-output contract):");
  const adminSrc = fs.readFileSync(dist("routes", "admin.js"), "utf8");
  await test("admin /lookup no longer selects/returns full apiKey", () => {
    assert.ok(!/apiKey:\s*true/.test(adminSrc), "lookup still selects apiKey column");
    assert.ok(!/apiKey:\s*reveal/.test(adminSrc), "lookup still returns full key on reveal");
    assert.ok(/apiKeyMasked/.test(adminSrc), "lookup missing masked form");
  });
  for (const f of ["routes/agent.js", "routes/agents.js", "routes/trial.js"]) {
    const src = fs.readFileSync(dist(...f.split("/")), "utf8");
    await test(`${f}: create/rotate persists prefix+hash only (no raw apiKey field)`, () => {
      assert.ok(!/data:\s*\{\s*apiKey[,:]/.test(src), "still persists plaintext apiKey");
      assert.ok(/apiKeyHash/.test(src), "missing apiKeyHash persistence");
    });
  }
  const authMw = fs.readFileSync(dist("middleware", "auth.js"), "utf8");
  await test("auth middleware has no plaintext fallback lookup", () => {
    assert.ok(!/where:\s*\{\s*apiKey\s*\}/.test(authMw), "plaintext fallback still present");
  });
  const accountRouteGates = [
    ["routes/webhooks.js", /router\.use\(requireAuth,\s*requireApiKeyAuth\)/],
    ["routes/agents.js", /router\.put\("\/profile",\s*requireAuth,\s*requireApiKeyAuth/],
    ["routes/wallet.js", /router\.post\(\s*"\/provision",\s*requireAuth,\s*requireApiKeyAuth/s],
    ["routes/referral.js", /router\.get\("\/code",\s*requireAuth,\s*requireApiKeyAuth/],
    ["routes/referral.js", /router\.post\("\/apply",\s*requireAuth,\s*requireApiKeyAuth/],
  ];
  for (const [file, pattern] of accountRouteGates) {
    const src = fs.readFileSync(dist(...file.split("/")), "utf8");
    await test(`${file}: OAuth tool tokens cannot reach account-management route`, () => {
      assert.ok(pattern.test(src), `${file} missing requireApiKeyAuth gate`);
    });
  }

  if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
  console.log("\nAll Phase B key-hashing tests passed.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
