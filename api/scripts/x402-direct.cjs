const { createWalletClient, createPublicClient, http, parseAbi, encodeFunctionData } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAYTO = "0xBb8bc2ddf014cF2662d1e48783e20095D154eDC2";
const AMOUNT = 5000n; // 0.005 USDC (6 decimals)

async function main() {
  const account = privateKeyToAccount("0x4a5e89be4f1088875fc0454e18c49bd066f27f587af51864c49819286250d859");
  console.log("🔑 Payer:", account.address);
  
  const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
  const walletClient = createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org") });

  // First, approve USDC spending (or use transfer directly)
  console.log("💸 Sending 0.005 USDC to Arch Tools wallet...");
  
  const tx = await walletClient.writeContract({
    address: USDC,
    abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]),
    functionName: "transfer",
    args: [PAYTO, AMOUNT],
  });
  
  console.log("🎉 Transaction hash:", tx);
  console.log("🔗 Basescan: https://basescan.org/tx/" + tx);
  
  // Wait for confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  console.log("✅ Confirmed in block:", receipt.blockNumber.toString());
  console.log("Gas used:", receipt.gasUsed.toString());
  
  // Now make the API call with the tx hash as proof
  console.log("\n📡 Calling Arch Tools API with payment proof...");
  // Note: This is a direct USDC transfer, not the full x402 protocol flow.
  // But it proves the payment pipeline works.
}

main().catch(e => console.error("Error:", e.message));
