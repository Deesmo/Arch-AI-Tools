/**
 * x402 USDC → credits top-up — unit fixtures (GROWTH_50 #8).
 *
 * Covers the money-critical units without a DB or facilitator:
 *   - pack-equivalent tier math (CREDIT_PACKS is the rate authority; numbers
 *     are PINNED so a pack price change fails loud here, mirroring the
 *     intent-funnel pack pin — update deliberately, never silently)
 *   - buildPaymentRequired/V2 resourceUrl override (and default unchanged)
 *   - x402Middleware options: requirePayment (API key must NOT bypass the 402
 *     on top-up routes), price override, and unchanged default tool behavior
 *   - grantTopupCredits idempotency: grant / replay / race / conflict / failure
 *
 * Requires a build first (imports the compiled module):
 *   cd api && npm run build && node tests/x402-topup.test.mjs
 */
import assert from "assert";

process.env.WALLET_ADDRESS = process.env.WALLET_ADDRESS || "0x2583aAc89f58a63D9CCbeDaa5e3BaF2196Aa967e";
process.env.SOLANA_WALLET_ADDRESS = process.env.SOLANA_WALLET_ADDRESS || "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM";

const { creditsForTopupCents, buildTopupTiers, TOPUP_TIER_CENTS, topupToolName, grantTopupCredits } =
  await import("../dist/lib/x402Topup.js");
const { RECOMMENDABLE_PACKS } = await import("../dist/lib/creditPacks.js");
const { buildPaymentRequired, buildPaymentRequiredV2, x402Middleware, X402_PRICES } =
  await import("../dist/middleware/x402.js");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}: ${e.message}`);
  }
}

// billing.ts CREDIT_PACKS shape (amount in cents), sourced from the guarded
// pack mirror lib/creditPacks.ts (intent-funnel pins those sizes; the price
// drift guard pins billing.ts itself).
const PACKS = RECOMMENDABLE_PACKS.map((p) => ({ credits: p.credits, amount: p.priceUsd * 100 }));

console.log("x402 top-up tier math (pack-equivalent rates):");

test("$5 top-up = worst-case starter rate ($0.003/credit or cheaper) — 1667 credits", () => {
  const credits = creditsForTopupCents(500, PACKS);
  assert.strictEqual(credits, 1667);
  // effective USD/credit must be <= 0.003 (the starter pack rate)
  assert.ok(5 / credits <= 9 / 3000);
});

test("$20 top-up stays on the starter rate (pro pack not affordable at $20) — 6667 credits", () => {
  const credits = creditsForTopupCents(2000, PACKS);
  assert.strictEqual(credits, 6667);
  assert.ok(20 / credits <= 9 / 3000);
});

test("$50 top-up earns the pro pack rate ($49 pack eligible) — 25511 credits", () => {
  const credits = creditsForTopupCents(5000, PACKS);
  assert.strictEqual(credits, 25511);
  assert.ok(50 / credits <= 49 / 25000 + 1e-9); // pro rate or cheaper (ceil ≤ 1 credit)
});

test("every tier rate sits between the best pack rate and the starter rate (± 1-credit ceil)", () => {
  const bestRate = Math.min(...PACKS.map((p) => p.amount / p.credits)); // cents/credit
  for (const t of buildTopupTiers(PACKS)) {
    const rate = t.amountCents / t.credits;
    assert.ok(rate <= 900 / 3000 + 1e-9, `${t.id}: worse than starter (${rate})`);
    assert.ok(t.amountCents / (t.credits - 1) >= bestRate, `${t.id}: undercuts the best pack by more than the 1-credit rounding`);
  }
});

test("below every pack price → worst pack rate, still ceil'd in the buyer's favor", () => {
  assert.strictEqual(creditsForTopupCents(100, PACKS), Math.ceil((100 * 3000) / 900)); // 334
});

test("degenerate inputs grant ZERO credits (0 / negative / NaN / empty or invalid packs)", () => {
  assert.strictEqual(creditsForTopupCents(0, PACKS), 0);
  assert.strictEqual(creditsForTopupCents(-500, PACKS), 0);
  assert.strictEqual(creditsForTopupCents(NaN, PACKS), 0);
  assert.strictEqual(creditsForTopupCents(500, []), 0);
  assert.strictEqual(creditsForTopupCents(500, [{ credits: 0, amount: 900 }]), 0);
  assert.strictEqual(creditsForTopupCents(500, [{ credits: 3000, amount: 0 }]), 0);
});

test("buildTopupTiers: pinned catalog — ids 5/20/50, x402 price strings, credits", () => {
  const tiers = buildTopupTiers(PACKS);
  assert.deepStrictEqual(tiers.map((t) => t.id), ["5", "20", "50"]);
  assert.deepStrictEqual(tiers.map((t) => t.usd), ["5.000", "20.000", "50.000"]);
  assert.deepStrictEqual(tiers.map((t) => t.amountCents), [...TOPUP_TIER_CENTS]);
  assert.deepStrictEqual(tiers.map((t) => t.credits), [1667, 6667, 25511]);
});

test("top-up tool names never collide with X402_PRICES (drift guard stays untouched)", () => {
  for (const cents of TOPUP_TIER_CENTS) {
    const name = topupToolName(String(cents / 100));
    assert.match(name, /^credits-topup-\d+$/);
    assert.strictEqual(X402_PRICES[name], undefined);
  }
});

console.log("\nbuildPaymentRequired resourceUrl override:");

const SITE = process.env.PUBLIC_SITE_URL ?? "https://archtools.dev";

test("default resource unchanged: /v1/tools/<tool>", () => {
  const body = buildPaymentRequired("generate-hash", "0.010");
  assert.strictEqual(body.resource.url, `${SITE}/v1/tools/generate-hash`);
  for (const a of body.accepts) assert.strictEqual(a.resource, `${SITE}/v1/tools/generate-hash`);
});

test("override: every accepts[] entry + resource carry the real top-up endpoint and the tier amount", () => {
  const url = `${SITE}/v1/billing/topup-x402/20`;
  const body = buildPaymentRequired("credits-topup-20", "20.000", url);
  assert.strictEqual(body.resource.url, url);
  assert.ok(body.accepts.length > 0);
  for (const a of body.accepts) {
    assert.strictEqual(a.resource, url);
    if (a.extra?.name === "USD Coin" || a.extra?.name === "Tether USD") {
      assert.strictEqual(a.maxAmountRequired, "20000000"); // $20 in 6-decimal atomic units
    }
  }
});

test("buildPaymentRequiredV2 override: v2 wire body carries the endpoint + amount", () => {
  const url = `${SITE}/v1/billing/topup-x402/5`;
  const v2 = buildPaymentRequiredV2("credits-topup-5", "5.000", url);
  assert.strictEqual(v2.x402Version, 2);
  assert.strictEqual(v2.resource.url, url);
  assert.ok(v2.accepts.some((a) => a.amount === "5000000"));
});

console.log("\nx402Middleware options (fake req/res — no facilitator calls):");

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(c) { this.statusCode = c; return this; },
    header(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
    json(b) { this.body = b; return this; },
    once() {},
  };
}

await testAsync("requirePayment: an API key does NOT bypass — 402 challenge at the tier price + real endpoint", async () => {
  const gate = x402Middleware("credits-topup-20", {
    price: "20.000",
    requirePayment: true,
    resourceUrl: `${SITE}/v1/billing/topup-x402/20`,
  });
  const res = fakeRes();
  let nextCalled = false;
  await gate({ headers: { authorization: "Bearer at_test_key" } }, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, false, "must not fall through to the handler");
  assert.strictEqual(res.statusCode, 402);
  assert.ok(res.headers["payment-required"], "PAYMENT-REQUIRED header missing");
  const challenge = JSON.parse(Buffer.from(res.headers["payment-required"], "base64").toString("utf-8"));
  assert.strictEqual(challenge.resource.url, `${SITE}/v1/billing/topup-x402/20`);
  assert.ok(challenge.accepts.some((a) => a.amount === "20000000"));
});

await testAsync("default tool behavior unchanged: API credential still bypasses to next()", async () => {
  const gate = x402Middleware("generate-hash");
  const res = fakeRes();
  let nextCalled = false;
  await gate({ headers: { authorization: "Bearer at_test_key" } }, res, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
  assert.strictEqual(res.statusCode, 200);
});

await testAsync("no credential + no payment: tool 402 still priced from X402_PRICES (override never leaks)", async () => {
  const gate = x402Middleware("generate-hash");
  const res = fakeRes();
  await gate({ headers: {} }, res, () => {});
  assert.strictEqual(res.statusCode, 402);
  const challenge = JSON.parse(Buffer.from(res.headers["payment-required"], "base64").toString("utf-8"));
  assert.ok(challenge.accepts.some((a) => a.amount === "10000")); // $0.010
});

console.log("\ngrantTopupCredits idempotency (injected fake store):");

const TIER = { credits: 6667, amountCents: 2000 };

function fakeStore() {
  const purchases = new Map(); // dedupeId -> { agentId, credits }
  const balances = new Map(); // agentId -> credits
  return {
    purchases,
    balances,
    deps: {
      findPurchase: async (id) => purchases.get(id) ?? null,
      createPurchaseAndCredit: async ({ agentId, dedupeId, credits }) => {
        if (purchases.has(dedupeId)) throw new Error("unique constraint (P2002)");
        purchases.set(dedupeId, { agentId, credits });
        balances.set(agentId, (balances.get(agentId) ?? 0) + credits);
        return { balance: balances.get(agentId) };
      },
    },
  };
}

await testAsync("fresh settlement grants exactly the tier credits", async () => {
  const s = fakeStore();
  const r = await grantTopupCredits(s.deps, "agent-1", TIER, "x402:0xtx1");
  assert.deepStrictEqual(r, { status: "granted", creditsAdded: 6667, balance: 6667 });
});

await testAsync("replaying the SAME settlement never double-credits (already_credited)", async () => {
  const s = fakeStore();
  await grantTopupCredits(s.deps, "agent-1", TIER, "x402:0xtx1");
  const r = await grantTopupCredits(s.deps, "agent-1", TIER, "x402:0xtx1");
  assert.strictEqual(r.status, "already_credited");
  assert.strictEqual(s.balances.get("agent-1"), 6667); // unchanged
});

await testAsync("race: create loses the unique insert → idempotent already_credited, no double-credit", async () => {
  const s = fakeStore();
  let first = true;
  const racingDeps = {
    findPurchase: async (id) => (first ? null : s.deps.findPurchase(id)),
    createPurchaseAndCredit: async (args) => {
      if (first) {
        // Concurrent request wins the insert between our pre-check and create.
        first = false;
        await s.deps.createPurchaseAndCredit(args);
        throw new Error("unique constraint (P2002)");
      }
      return s.deps.createPurchaseAndCredit(args);
    },
  };
  const r = await grantTopupCredits(racingDeps, "agent-1", TIER, "x402:0xtx1");
  assert.strictEqual(r.status, "already_credited");
  assert.strictEqual(s.balances.get("agent-1"), 6667);
});

await testAsync("same settlement id on a DIFFERENT agent → conflict, credits nothing", async () => {
  const s = fakeStore();
  await grantTopupCredits(s.deps, "agent-1", TIER, "x402:0xtx1");
  const r = await grantTopupCredits(s.deps, "agent-2", TIER, "x402:0xtx1");
  assert.strictEqual(r.status, "conflict");
  assert.strictEqual(s.balances.get("agent-2"), undefined);
});

await testAsync("store failure (not a duplicate) → failed with the reason, nothing credited", async () => {
  const s = fakeStore();
  const brokenDeps = {
    findPurchase: async () => null,
    createPurchaseAndCredit: async () => { throw new Error("db down"); },
  };
  const r = await grantTopupCredits(brokenDeps, "agent-1", TIER, "x402:0xtx1");
  assert.deepStrictEqual(r, { status: "failed", reason: "db down" });
  assert.strictEqual(s.balances.get("agent-1"), undefined);
});

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll x402 top-up tests passed.");
