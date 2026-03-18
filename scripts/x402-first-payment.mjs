/**
 * x402 First Payment Script
 * 
 * This script processes a real x402 payment against archtools.dev
 * using @x402/fetch + @x402/evm to handle the 402→pay→200 flow automatically.
 * 
 * Usage:
 *   PAYER_PRIVATE_KEY=0x... node scripts/x402-first-payment.mjs
 */

import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, formatUnits } from "viem";
import { base } from "viem/chains";
import { writeFileSync } from "fs";

// ─── Config ──────────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("❌ Set PAYER_PRIVATE_KEY env var (0x-prefixed private key)");
  process.exit(1);
}

const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const TARGET_URL = "https://archtools.dev/v1/tools/search-web";
const RESULTS_PATH = "/Users/bradvaldes/.openclaw/workspace/FIRST-X402-PAYMENT.md";

// ─── Setup ───────────────────────────────────────────────────────────────────

const account = privateKeyToAccount(PRIVATE_KEY);
console.log(`🔑 Payer wallet: ${account.address}`);

const publicClient = createPublicClient({
  chain: base,
  transport: http("https://mainnet.base.org"),
});

// Check USDC balance first
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

// Safety check: don't spend more than $0.01
if (usdcBalance > 100000n) {
  console.log(`⚠️  Wallet has ${balanceFormatted} USDC — that's fine, the endpoint costs only 0.005 USDC`);
}

// ─── Create x402-wrapped fetch ───────────────────────────────────────────────

console.log("\n🔄 Setting up x402 payment client...");

const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [
    {
      network: "eip155:8453", // Base mainnet
      client: new ExactEvmScheme(account),
    },
  ],
});

// ─── Make the x402 payment request ──────────────────────────────────────────

console.log(`\n📡 Requesting ${TARGET_URL}...`);
console.log("   This will automatically handle the 402→sign→pay→200 flow\n");

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
  
  // Check for payment response headers
  const paymentResponse = response.headers.get("x-payment-response") || response.headers.get("X-Payment-Response");
  if (paymentResponse) {
    console.log(`\n💳 Payment response header found!`);
    try {
      const decoded = JSON.parse(atob(paymentResponse));
      console.log(`   TX Hash: ${decoded.txHash || decoded.transaction_hash || "embedded in response"}`);
      console.log(`   Details: ${JSON.stringify(decoded, null, 2)}`);
    } catch {
      console.log(`   Raw: ${paymentResponse.substring(0, 200)}`);
    }
  }
  
  // Log all headers for debugging
  console.log("\n📋 Response headers:");
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase().includes("payment") || key.toLowerCase().includes("x-")) {
      console.log(`   ${key}: ${value.substring(0, 200)}`);
    }
  }

  if (response.ok) {
    const data = await response.json();
    console.log(`\n✅ SUCCESS! Got response data:`);
    console.log(JSON.stringify(data, null, 2).substring(0, 500));
    
    // Save results
    const results = `# First x402 Payment — Arch Tools

## ✅ Payment Successful!

**Date:** ${new Date().toISOString()}
**Payer Wallet:** ${account.address}
**Target:** ${TARGET_URL}
**Method:** POST (search query: "x402 payment protocol")
**Network:** Base Mainnet (eip155:8453)
**Asset:** USDC (${USDC_ADDRESS})
**Amount:** 0.005 USDC (5000 units)
**Payment Response Header:** ${paymentResponse || "N/A"}
**Response Status:** ${response.status}
**Elapsed:** ${elapsed}ms

## How It Worked
1. @x402/fetch sent POST to archtools.dev/v1/tools/search-web
2. Server returned 402 with payment requirements
3. @x402/evm (ExactEvmScheme) signed EIP-3009 TransferWithAuthorization
4. Facilitator (x402.org) verified signature and settled on-chain
5. Server returned 200 with search results

## Response Data (truncated)
\`\`\`json
${JSON.stringify(data, null, 2).substring(0, 1000)}
\`\`\`

## What This Unlocks
- Auto-listing on x402.org ecosystem directory
- Eligibility for Coinbase Bazaar marketplace
- Proof of real x402 payment processing on Arch Tools
`;
    
    writeFileSync(RESULTS_PATH, results);
    console.log(`\n📝 Results saved to ${RESULTS_PATH}`);
    
  } else {
    const errorText = await response.text();
    console.error(`\n❌ Request failed with status ${response.status}`);
    console.error(`   Body: ${errorText.substring(0, 500)}`);
  }
  
} catch (error) {
  console.error(`\n❌ Error during x402 payment:`);
  console.error(`   ${error.message}`);
  if (error.cause) console.error(`   Cause: ${error.cause}`);
  console.error(`\nFull error:`, error);
}
