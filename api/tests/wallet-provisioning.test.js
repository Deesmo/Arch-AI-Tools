/**
 * Regression coverage for wallet provisioning sentinels.
 *
 * Run: node --loader ts-node/esm tests/wallet-provisioning.test.js
 */

import assert from "node:assert/strict";
import {
  WALLET_PROVISIONING_SENTINEL_TTL_MS,
  createProvisioningSentinel,
  isProvisioningSentinel,
  isStaleProvisioningSentinel,
} from "../src/routes/wallet.ts";

let passed = 0;

function test(name, fn) {
  fn();
  passed++;
  console.log(`  OK ${name}`);
}

console.log("\nWallet provisioning sentinel tests");

test("creates timestamped pending sentinels", () => {
  const sentinel = createProvisioningSentinel("agent_123", 123456);
  assert.equal(sentinel, "pending:agent_123:123456");
  assert.equal(isProvisioningSentinel(sentinel), true);
  assert.equal(isProvisioningSentinel("0x1234"), false);
});

test("active sentinels are not stale", () => {
  const now = 10_000;
  const sentinel = createProvisioningSentinel("agent_123", now);
  assert.equal(isStaleProvisioningSentinel(sentinel, now + WALLET_PROVISIONING_SENTINEL_TTL_MS - 1), false);
});

test("expired timestamped sentinels are stale", () => {
  const now = 10_000;
  const sentinel = createProvisioningSentinel("agent_123", now);
  assert.equal(isStaleProvisioningSentinel(sentinel, now + WALLET_PROVISIONING_SENTINEL_TTL_MS + 1), true);
});

test("legacy pending sentinels are treated as active", () => {
  assert.equal(isStaleProvisioningSentinel("pending:agent_123", Date.now()), false);
});

console.log(`Wallet provisioning sentinel tests passed: ${passed}`);
