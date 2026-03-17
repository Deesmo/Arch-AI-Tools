/**
 * x402 First Payment Script
 * 
 * Processes a real x402 payment against archtools.dev using @x402/fetch + @x402/evm.
 * The SDK handles the full 402→sign→pay→200 flow automatically.
 * 
 * Usage:
 *   cd api && PAYER_PRIVATE_KEY=0x... node ../scripts/x402-first-payment.cjs
 */

const { wrapFetchWithPaymentFromConfig } = require("@x402/fetch");
const { ExactEvmScheme } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createPublicClient, http, formatUnits } = require("viem");
const { base } = require("viem/chains");
const { writeFileSync } = require("fs");

const PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("❌ Set PAYER_PRIVATE_KEY env var (0x-prefixed private key)");
  process.exit(1);
}

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TARGET_URL = "https://archtools.dev/v1/tools/search-web";
const RESULTS_PATH = "/Users/bradvaldes/.openclaw/workspace/FIRST-X402-PAYMENT.md";

async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log(`🔑 Payer wallet: ${account.address}`);

  const publicClient = createPublicClient({
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  // Check USDC balance
  const usdcBalance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] }],
    functionName: "balanceOf",
    args: [account.address],
  });

  const balanceFormatted = formatUnits(usdcBalance, 6);
  console.log(`💰 USDC balance: ${balanceFormatted} USDC`);

  if (usdcBalance < 5000n) {
    console.error(`❌ Insufficient USDC. Need at least 0.005 USDC (5000 units). Have: ${usdcBalance.toString()}`);
    console.error(`   Send ≥ 0.01 USDC to ${account.address} on Base network`);
    process.exit(1);
  }

  // Setup x402 payment client
  console.log("\n🔄 Setting up x402 payment client...");

  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [
      {
        network: "eip155:8453",
        client: new ExactEvmScheme(account),
      },
    ],
  });

  // Make the payment request
  console.log(`\n📡 Requesting ${TARGET_URL}...`);
  console.log("   402→sign EIP-3009→facilitator settles→200\n");

  const startTime = Date.now();

  try {
    const response = await fetchWithPayment(TARGET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "x402 payment protocol", limit: 3 }),
    });

    const elapsed = Date.now() - startTime;
    console.log(`📨 Response status: ${response.status}`);
    console.log(`⏱️  Elapsed: ${elapsed}ms`);

    // Check all payment-related headers
    console.log("\n📋 Payment-related headers:");
    for (const [key, value] of response.headers.entries()) {
      if (key.toLowerCase().includes("payment") || key.toLowerCase().startsWith("x-")) {
        console.log(`   ${key}: ${value.substring(0, 300)}`);
      }
    }

    if (response.ok) {
      const data = await response.json();
      console.log(`\n✅ SUCCESS! x402 payment processed!`);
      console.log(JSON.stringify(data, null, 2).substring(0, 500));

      // Try to extract tx hash from payment response
      let txHash = "See payment response header";
      const paymentResp = response.headers.get("x-payment-response");
      if (paymentResp) {
        try {
          const decoded = JSON.parse(Buffer.from(paymentResp, "base64").toString());
          txHash = decoded.txHash || decoded.transaction_hash || decoded.tx || JSON.stringify(decoded);
        } catch {
          txHash = paymentResp.substring(0, 200);
        }
      }

      const results = `# First x402 Payment — Arch Tools

## ✅ Payment Successful!

**Date:** ${new Date().toISOString()}
**Payer Wallet:** ${account.address}
**Receiver (payTo):** 0xBb8bc2ddf014cF2662d1e48783e20095D154eDC2
**Target Endpoint:** ${TARGET_URL}
**Method:** POST (query: "x402 payment protocol")
**Network:** Base Mainnet (eip155:8453)
**Asset:** USDC (${USDC_ADDRESS})
**Cost:** 0.005 USDC (5000 units)
**TX Hash / Receipt:** ${txHash}
**Response Status:** ${response.status}
**Elapsed:** ${elapsed}ms

## How It Worked
1. \`@x402/fetch\` sent POST to archtools.dev/v1/tools/search-web
2. Server returned HTTP 402 with payment requirements (scheme: exact, network: eip155:8453)
3. \`@x402/evm\` (ExactEvmScheme) signed EIP-3009 TransferWithAuthorization for 0.005 USDC
4. Facilitator (x402.org) verified signature and settled on-chain (gasless for payer)
5. Server returned HTTP 200 with search results

## What This Unlocks
- ✅ Proof of real x402 payment processing on Arch Tools
- ✅ Auto-listing eligibility on x402.org ecosystem directory
- ✅ Eligibility for Coinbase Bazaar marketplace
- ✅ Demonstrates production-ready x402 monetization

## Response Data (truncated)
\`\`\`json
${JSON.stringify(data, null, 2).substring(0, 1500)}
\`\`\`
`;

      writeFileSync(RESULTS_PATH, results);
      console.log(`\n📝 Results saved to ${RESULTS_PATH}`);
    } else {
      const errorText = await response.text();
      console.error(`\n❌ Request failed: ${response.status}`);
      console.error(`   ${errorText.substring(0, 500)}`);
    }
  } catch (error) {
    console.error(`\n❌ Error:`, error.message);
    if (error.stack) console.error(error.stack.split("\n").slice(0, 5).join("\n"));
  }
}

main();
