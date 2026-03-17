const { x402Client, wrapFetchWithPayment } = require("@x402/fetch");
const { ExactEvmScheme } = require("@x402/evm");
const { createWalletClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");

async function main() {
  const PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY;
  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log("🔑 Payer:", account.address);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  const evmScheme = new ExactEvmScheme(walletClient);
  
  // Use registerV1 for our v1 protocol
  const client = new x402Client()
    .register("eip155:8453", evmScheme)
    .registerV1("eip155:8453", evmScheme);

  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  console.log("📡 Making x402 payment to archtools.dev...");
  const response = await fetchWithPay("https://archtools.dev/v1/tools/search-web", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "what is x402 protocol" }),
  });

  console.log("Status:", response.status);
  const text = await response.text();
  console.log("Response:", text.substring(0, 500));
  
  const payResp = response.headers.get("PAYMENT-RESPONSE") || response.headers.get("X-PAYMENT-RESPONSE");
  if (payResp) console.log("Payment header:", payResp.substring(0, 200));
}

main().catch(e => console.error("Error:", e.message));
