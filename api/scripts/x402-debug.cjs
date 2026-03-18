const { x402Client, wrapFetchWithPayment, x402HTTPClient } = require("@x402/fetch");
const { ExactEvmScheme } = require("@x402/evm");
const { createWalletClient, http, publicActions } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");

async function main() {
  const account = privateKeyToAccount("0x4a5e89be4f1088875fc0454e18c49bd066f27f587af51864c49819286250d859");
  console.log("🔑 Payer:", account.address);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  }).extend(publicActions);

  const evmScheme = new ExactEvmScheme(walletClient);
  
  // Just use registerV1 only since our server returns v1
  const client = new x402Client();
  client.registerV1("eip155:8453", evmScheme);

  // Hook to debug payment creation
  client.onBeforePaymentCreation((pr) => {
    console.log("🔍 Payment requirements:", JSON.stringify({
      version: pr.x402Version,
      scheme: pr.accepts?.[0]?.scheme || pr.scheme,
      network: pr.accepts?.[0]?.network || pr.network,
      payTo: pr.accepts?.[0]?.payTo || pr.payTo,
      amount: pr.accepts?.[0]?.maxAmountRequired || pr.maxAmountRequired,
    }));
    return {};
  });

  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  console.log("📡 Calling archtools.dev with x402 payment...");
  const response = await fetchWithPay("https://archtools.dev/v1/tools/search-web", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "what is x402" }),
  });

  console.log("Status:", response.status);
  const body = await response.text();
  console.log("Body:", body.substring(0, 500));
}

main().catch(e => {
  console.error("Error:", e.message);
  if (e.cause) console.error("Cause:", e.cause);
});
