/**
 * Generate a burner wallet for x402 payment testing.
 * Brad needs to send ~0.01 USDC (on Base) to this address before running the payment script.
 */

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("🔑 Burner Wallet Generated for x402 Testing");
console.log("============================================");
console.log(`Address:     ${account.address}`);
console.log(`Private Key: ${privateKey}`);
console.log("");
console.log("⚠️  SAVE THE PRIVATE KEY — you'll need it for the payment script.");
console.log("");
console.log("Next steps:");
console.log(`1. Send 0.01 USDC on Base network to: ${account.address}`);
console.log("2. Run the payment:");
console.log(`   PAYER_PRIVATE_KEY=${privateKey} node scripts/x402-first-payment.mjs`);
console.log("");
console.log("The payment costs 0.005 USDC ($0.005). The remaining 0.005 USDC stays in the burner wallet.");
