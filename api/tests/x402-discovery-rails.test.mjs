/**
 * x402 discovery rails — regression test for /.well-known/x402.
 *
 * The discovery endpoint must not advertise rails that the real x402 402
 * challenge filters out before verify/settle. This mounts the compiled router
 * with deliberately over-broad wallet envs and asserts the public metadata only
 * exposes CDP-supported rails.
 *
 * Run: cd api && npm run build && node tests/x402-discovery-rails.test.mjs
 */
import assert from "assert";
import express from "express";

process.env.PUBLIC_SITE_URL = "https://archtools.dev";
process.env.WALLET_ADDRESS = "0x2583aAc89f58a63D9CCbeDaa5e3BaF2196Aa967e";
process.env.SOLANA_WALLET_ADDRESS = "D6ZhtNQ5nT9ZnTHUbqXZsTx5MH2rPFiBBggX4hY1WePM";
process.env.NOBLE_WALLET_ADDRESS = "noble1unsupported";
process.env.ALGORAND_WALLET_ADDRESS = "ALGO_UNSUPPORTED";
process.env.STELLAR_WALLET_ADDRESS = "STELLAR_UNSUPPORTED";
process.env.SUI_WALLET_ADDRESS = "0xsuiunsupported";
process.env.POLKADOT_WALLET_ADDRESS = "polkadotUnsupported";
process.env.APTOS_WALLET_ADDRESS = "0xaptosunsupported";
process.env.ETH_WALLET_ADDRESS = "0x2583aAc89f58a63D9CCbeDaa5e3BaF2196Aa967e";
process.env.BNB_WALLET_ADDRESS = "0x2583aAc89f58a63D9CCbeDaa5e3BaF2196Aa967e";
process.env.NEAR_WALLET_ADDRESS = "nearunsupported";
process.env.SOL_NATIVE_WALLET_ADDRESS = "SOL_UNSUPPORTED";
process.env.TAO_WALLET_ADDRESS = "taounsupported";
process.env.UNI_WALLET_ADDRESS = "0x2583aAc89f58a63D9CCbeDaa5e3BaF2196Aa967e";

const { default: discoveryRouter } = await import("../dist/routes/discovery.js");

const app = express();
app.use(discoveryRouter);
const server = app.listen(0);

try {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/.well-known/x402`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  const rails = body.supportedRails;
  assert.ok(Array.isArray(rails), "supportedRails must be an array");

  const railNetworks = rails.map((r) => r.network);
  const networkSet = new Set(railNetworks);
  assert.ok(networkSet.has("eip155:8453"), "Base USDC/USDT rail missing");
  assert.ok(networkSet.has("eip155:137"), "Polygon USDC/USDT rail missing");
  assert.ok(networkSet.has("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"), "Solana USDC rail missing");

  const forbiddenNetworks = new Set([
    "eip155:1",
    "eip155:42161",
    "eip155:10",
    "eip155:43114",
    "eip155:130",
    "eip155:143",
    "cosmos:noble-1",
    "algorand:mainnet",
    "stellar:pubnet",
    "sui:mainnet",
    "polkadot:asset-hub",
    "aptos:mainnet",
    "eip155:56",
    "near:mainnet",
    "bittensor:finney",
  ]);
  for (const rail of rails) {
    assert.ok(!forbiddenNetworks.has(rail.network), `unsupported network leaked: ${rail.network}`);
    assert.notStrictEqual(rail.asset, "native", `native asset leaked on ${rail.network}`);
    assert.notStrictEqual(rail.asset, "0x0000000000000000000000000000000000000000", `native EVM asset leaked on ${rail.network}`);
  }

  const summaryNetworks = body.payment?.x402?.networks ?? [];
  assert.deepStrictEqual(new Set(summaryNetworks), networkSet, "payment.x402.networks must mirror filtered rails");
  assert.strictEqual(body.payment?.x402?.token, "USDC/USDT");
  console.log("x402-discovery-rails: ALL PASS");
} finally {
  await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
}
