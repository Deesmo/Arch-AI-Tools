/**
 * Per-model credit multiplier — ensures expensive models aren't served at a cheap price.
 * Run: cd api && npm run build && node tests/model-cost.test.mjs
 */
import assert from "assert";
import { modelCostMultiplier, applyModelCost } from "../dist/lib/modelCost.js";

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); }
  catch (e) { failures++; console.error(`  ✗ ${name}: ${e.message}`); }
}

console.log("Model cost multipliers:");

test("Sonnet is baseline 1.0 (common path unchanged)", () => {
  assert.strictEqual(modelCostMultiplier("claude-sonnet-4-6"), 1.0);
});

test("Opus costs ~2x Sonnet", () => {
  assert.strictEqual(modelCostMultiplier("claude-opus-4-6"), 2.0);
});

test("Haiku is cheaper (0.4)", () => {
  assert.strictEqual(modelCostMultiplier("claude-haiku-4-5-20251001"), 0.4);
});

test("unknown model never undercharges (defaults to 1.0)", () => {
  assert.strictEqual(modelCostMultiplier("some-future-model"), 1.0);
  assert.strictEqual(modelCostMultiplier(undefined), 1.0);
});

test("cheap tiers floored at 0.3", () => {
  assert.ok(modelCostMultiplier("gpt-4o-mini") >= 0.3);
  assert.ok(modelCostMultiplier("gemini-2.0-flash") >= 0.3);
});

test("applyModelCost: Opus doubles the base, Sonnet unchanged", () => {
  assert.strictEqual(applyModelCost(20, "claude-sonnet-4-6"), 20);
  assert.strictEqual(applyModelCost(20, "claude-opus-4-6"), 40);
  assert.strictEqual(applyModelCost(25, "claude-opus-4-6"), 50); // ai-oracle deep
  assert.strictEqual(applyModelCost(25, "claude-sonnet-4-6"), 25); // ai-oracle standard
});

test("applyModelCost: Haiku reduces but stays >= 1 credit", () => {
  assert.strictEqual(applyModelCost(20, "claude-haiku-4-5-20251001"), 8);
  assert.strictEqual(applyModelCost(1, "claude-haiku-4-5-20251001"), 1);
});

test("applyModelCost: unknown model uses base unchanged", () => {
  assert.strictEqual(applyModelCost(20, "mystery"), 20);
});

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nAll model-cost tests passed.");
