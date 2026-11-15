/**
 * Facilitator direct settlement fee accounting.
 *
 * Direct EIP-3009 settlement currently requires the payer authorization to send
 * the full amount to the provider wallet. Until a split-settlement flow exists,
 * Arch must not record or report a fee it did not receive on-chain.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  calculateProviderPayout,
  collectibleFeePercentForDirectSettlement,
} from "../src/services/facilitator.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "facilitator.ts"), "utf-8");

console.log("Facilitator — direct settlement fee accounting:");

const configuredFeePercent = 2.5;
const effectiveFeePercent = collectibleFeePercentForDirectSettlement(configuredFeePercent);
assert.strictEqual(effectiveFeePercent, 0, "direct provider-wallet settlement cannot collect an Arch fee");

const { fee, payout } = calculateProviderPayout("1000000", effectiveFeePercent);
assert.strictEqual(fee, "0", "fee record must not claim uncollected atomic USDC");
assert.strictEqual(payout, "1000000", "provider payout must match the full direct-settled amount");

assert.ok(
  routeSrc.includes("collectibleFeePercentForDirectSettlement(configuredFeePercent)"),
  "/settle must derive fee records from the collectible direct-settlement fee percent",
);
assert.ok(
  routeSrc.includes("feePercent: collectibleFeePercentForDirectSettlement(getDefaultFeePercent())"),
  "new provider defaults must not advertise a currently uncollectible fee",
);

console.log("  ✓ direct settlement records zero collected fee");
