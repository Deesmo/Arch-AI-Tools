/**
 * Session ownership regression test.
 *
 * Run against a local API + dev DB:
 *   TEST_BASE_URL=http://localhost:8787 node tests/session-ownership.test.js
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:8787";
const prisma = new PrismaClient();

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return { res, body: await res.json().catch(() => null) };
}

async function createVerifiedAgent(label, suffix) {
  const email = `session-owner-${label}-${suffix}@example.org`;
  const { res, body } = await fetchJSON("/v1/agent/register", {
    method: "POST",
    body: JSON.stringify({ email, name: `Session Owner ${label}` }),
  });
  assert.strictEqual(res.status, 201, `${label} register status ${res.status}: ${JSON.stringify(body)}`);
  assert.ok(body?.api_key?.startsWith("arch_"), `${label} api key missing`);

  const agent = await prisma.agent.findUnique({ where: { email } });
  assert.ok(agent?.verifyToken, `${label} verify token missing`);

  const verify = await fetchJSON(`/v1/agent/verify-email?token=${encodeURIComponent(agent.verifyToken)}`);
  assert.strictEqual(verify.res.status, 200, `${label} verify status ${verify.res.status}: ${JSON.stringify(verify.body)}`);

  return { email, apiKey: body.api_key, agentId: body.agent_id };
}

async function cleanup(agentIds, emails) {
  await prisma.apiRequest.deleteMany({ where: { agentId: { in: agentIds } } });
  await prisma.referral.deleteMany({
    where: { OR: [{ referrerId: { in: agentIds } }, { referredId: { in: agentIds } }] },
  });
  await prisma.signupIdentity.deleteMany({
    where: { normalizedEmail: { in: emails.map((email) => email.toLowerCase()) } },
  });
  await prisma.agent.deleteMany({ where: { id: { in: agentIds } } });
}

async function main() {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const created = [];
  try {
    const owner = await createVerifiedAgent("owner", suffix);
    created.push(owner);
    const attacker = await createVerifiedAgent("attacker", suffix);
    created.push(attacker);

    const create = await fetchJSON("/v1/tools/session-create", {
      method: "POST",
      headers: { "x-api-key": owner.apiKey },
      body: JSON.stringify({ namespace: "ownership-regression", model: "claude" }),
    });
    assert.strictEqual(create.res.status, 200, `session-create status ${create.res.status}: ${JSON.stringify(create.body)}`);
    assert.ok(create.body?.session_id?.startsWith("sess_"), "session id missing");

    const crossTenant = await fetchJSON("/v1/tools/session-message", {
      method: "POST",
      headers: { "x-api-key": attacker.apiKey },
      body: JSON.stringify({
        session_id: create.body.session_id,
        message: "poison another caller's conversation",
      }),
    });

    assert.strictEqual(crossTenant.res.status, 403, `cross-tenant status ${crossTenant.res.status}: ${JSON.stringify(crossTenant.body)}`);
    assert.strictEqual(crossTenant.body?.error, "session_forbidden");
    console.log("  ✓ session-message rejects a different API-key owner before mutating history");
  } finally {
    await cleanup(created.map((entry) => entry.agentId), created.map((entry) => entry.email)).catch((err) => {
      console.warn(`cleanup warning: ${err.message}`);
    });
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(`  ✗ ${err.message}`);
  await prisma.$disconnect();
  process.exit(1);
});
