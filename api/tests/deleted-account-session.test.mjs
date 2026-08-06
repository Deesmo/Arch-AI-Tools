/**
 * Deleted-account stale session regression.
 *
 * DELETE /v1/agent anonymizes the Agent row in-place for financial-record FK
 * retention. A stateless arch_session JWT issued before deletion must not keep
 * that anonymized row usable for browser auth or Stripe checkout.
 *
 * Run: cd api && npm run build && node tests/deleted-account-session.test.mjs
 */
import assert from "assert";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-do-not-use-in-prod";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgresql://stub:stub@127.0.0.1:5432/stub";
process.env.STRIPE_SECRET_KEY = "";

const express = (await import("express")).default;
const cookieParser = (await import("cookie-parser")).default;
const { prisma } = await import("../dist/lib/prisma.js");
const { isDeletedAgent } = await import("../dist/lib/deletedAgent.js");
const authModule = await import("../dist/routes/auth.js");
const billingRouter = (await import("../dist/routes/billing.js")).default;

const { default: authRouter, signSession } = authModule;

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ok ${name}`);
  } catch (e) {
    failures++;
    console.error(`  FAIL ${name}: ${e.message}`);
  }
}

const deletedAgent = {
  id: "agent_deleted_session",
  email: "deleted-agent_deleted_session@deleted.invalid",
  apiKeyPrefix: null,
  apiKeyHash: null,
  passwordHash: null,
  credits: 0,
  tier: "free",
  totalCalls: 0,
  createdAt: new Date("2026-08-06T00:00:00Z"),
};

const activeAgent = {
  id: "agent_active_session",
  email: "active@example.com",
  apiKeyPrefix: "arch_abcdefg",
  apiKeyHash: "$2b$10$aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  passwordHash: null,
  credits: 10,
  tier: "free",
  totalCalls: 0,
  createdAt: new Date("2026-08-06T00:00:00Z"),
};

let currentAgent = deletedAgent;
prisma.agent.findUnique = async ({ where }) => {
  return where?.id === currentAgent.id ? currentAgent : null;
};

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/auth", authRouter);
app.use("/v1/billing", billingRouter);

const server = app.listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;

function cookieFor(agentId) {
  return `arch_session=${signSession(agentId)}`;
}

async function postJson(path, body, cookie) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  return { res, json };
}

async function getJson(path, cookie) {
  const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie } });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch {}
  return { res, json };
}

function assertClearsSession(res) {
  const setCookie = res.headers.get("set-cookie") || "";
  assert.ok(setCookie.includes("arch_session="), "must emit Set-Cookie for arch_session");
  assert.ok(/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(setCookie), "must expire the stale session cookie");
}

console.log("deleted-account stale session:");

await test("helper recognizes the anonymized deleted-row marker only", () => {
  assert.strictEqual(isDeletedAgent(deletedAgent), true);
  assert.strictEqual(isDeletedAgent(activeAgent), false);
  assert.strictEqual(isDeletedAgent({ ...deletedAgent, apiKeyHash: "still-has-a-key" }), false);
});

await test("/auth/me rejects and clears a stale deleted-account session", async () => {
  currentAgent = deletedAgent;
  const { res, json } = await getJson("/auth/me", cookieFor(deletedAgent.id));
  assert.strictEqual(res.status, 401);
  assert.strictEqual(json.error, "account_deleted");
  assertClearsSession(res);
});

await test("/auth/api-key rejects and clears a stale deleted-account session", async () => {
  currentAgent = deletedAgent;
  const { res, json } = await getJson("/auth/api-key", cookieFor(deletedAgent.id));
  assert.strictEqual(res.status, 401);
  assert.strictEqual(json.error, "account_deleted");
  assertClearsSession(res);
});

await test("/v1/billing/checkout rejects a deleted-account session before Stripe", async () => {
  currentAgent = deletedAgent;
  const { res, json } = await postJson("/v1/billing/checkout", { pack: "starter" }, cookieFor(deletedAgent.id));
  assert.strictEqual(res.status, 401);
  assert.strictEqual(json.error, "unauthorized");
  assertClearsSession(res);
});

await test("active session still reaches the normal billing path", async () => {
  currentAgent = activeAgent;
  const { res, json } = await postJson("/v1/billing/checkout", { pack: "starter" }, cookieFor(activeAgent.id));
  assert.strictEqual(res.status, 503);
  assert.strictEqual(json.error, "not_configured");
});

server.close();

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll deleted-account stale-session tests passed.");
