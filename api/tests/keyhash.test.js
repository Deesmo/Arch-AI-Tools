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
  const { requireAuth } = await import(dist("middleware", "auth.js"));

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
  const collidingKeyA = `arch_${"a".repeat(7)}${"1".repeat(41)}`;
  const collidingKeyB = `arch_${"a".repeat(7)}${"2".repeat(41)}`;
  const collidingAgentA = {
    id: "agent_collision_a", apiKeyPrefix: collidingKeyA.slice(0, 12),
    apiKeyHash: bcrypt.hashSync(collidingKeyA, 4),
    email: "ca@b.c", credits: 100, tier: "free", totalCalls: 0,
  };
  const collidingAgentB = {
    id: "agent_collision_b", apiKeyPrefix: collidingKeyB.slice(0, 12),
    apiKeyHash: bcrypt.hashSync(collidingKeyB, 4),
    email: "cb@b.c", credits: 100, tier: "free", totalCalls: 0,
  };
  const rows = [existingAgent, newAgent, collidingAgentA, collidingAgentB];
  prisma.agent.findMany = async ({ where }) =>
    rows.filter((r) => r.apiKeyPrefix === where.apiKeyPrefix);
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

  await test("API key prefix collision scans all matching hashes", async () => {
    const req = mockReq(collidingKeyB); const res = mockRes();
    let nexted = false;
    await requireAuth(req, res, () => { nexted = true; });
    assert.strictEqual(nexted, true, "next() not called");
    assert.strictEqual(req.agent.id, "agent_collision_b");
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
  await test("auth middleware no longer uses single-row prefix findFirst", () => {
    assert.ok(!/findFirst\(\{\s*where:\s*\{\s*apiKeyPrefix/.test(authMw), "prefix lookup must scan all collision candidates");
  });

  if (failures > 0) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
  console.log("\nAll Phase B key-hashing tests passed.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
