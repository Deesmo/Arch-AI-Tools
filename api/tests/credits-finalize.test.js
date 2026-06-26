import assert from "assert";
import { EventEmitter } from "events";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = (...p) => path.join(__dirname, "..", "dist", ...p);

function waitForAsyncHandlers() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function mockReq() {
  return {
    headers: { "user-agent": "test-agent" },
    agent: { id: "agent_1", apiKey: "arch_test", email: "a@b.c", credits: 100, tier: "free", totalCalls: 0 },
  };
}

class MockRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.writableEnded = false;
    this.headers = {};
  }
  setHeader(name, value) {
    this.headers[name] = value;
  }
  status(code) {
    this.statusCode = code;
    return this;
  }
  json(body) {
    this.body = body;
    return this;
  }
}

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

async function main() {
  const { prisma } = await import(dist("lib", "prisma.js"));
  const { deductCredits } = await import(dist("utils", "credits.js"));

  const writes = [];
  prisma.agent.updateMany = async () => ({ count: 1 });
  prisma.agent.update = async (args) => { writes.push({ model: "agent", op: "update", args }); return {}; };
  prisma.agent.findUnique = async () => ({
    email: "a@b.c",
    totalCalls: 1,
    successCount: 1,
    errorCount: 0,
    totalSpentUsdc: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  prisma.apiRequest.create = async (args) => { writes.push({ model: "apiRequest", op: "create", args }); return {}; };
  prisma.dailyUsage.upsert = async (args) => { writes.push({ model: "dailyUsage", op: "upsert", args }); return {}; };
  prisma.webhook.findMany = async () => [];

  console.log("Credit finalization:");
  await test("finished 2xx response keeps deducted credits and logs success", async () => {
    writes.length = 0;
    const res = new MockRes();
    const ok = await deductCredits(mockReq(), res, "ai-oracle", 25);
    assert.strictEqual(ok, true);
    res.writableEnded = true;
    res.emit("finish");
    res.emit("close");
    await waitForAsyncHandlers();

    assert.ok(writes.some((w) => w.model === "apiRequest" && w.args.data.status === "SUCCESS"));
    assert.ok(!writes.some((w) => w.model === "agent" && w.args.data.credits?.increment === 25));
  });

  await test("aborted close before finish refunds deducted credits", async () => {
    writes.length = 0;
    const res = new MockRes();
    const ok = await deductCredits(mockReq(), res, "ai-oracle", 25);
    assert.strictEqual(ok, true);
    res.writableEnded = false;
    res.emit("close");
    await waitForAsyncHandlers();

    assert.ok(writes.some((w) => w.model === "agent" && w.args.data.credits?.increment === 25));
    assert.ok(writes.some((w) => w.model === "apiRequest" && w.args.data.status === "ERROR"));
  });

  if (failures > 0) {
    console.error(`\n${failures} test(s) failed`);
    process.exit(1);
  }
  console.log("\nAll credit finalization tests passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
