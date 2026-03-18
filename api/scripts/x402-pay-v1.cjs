const { x402Client, x402HTTPClient } = require("@x402/fetch");
const { ExactEvmScheme } = require("@x402/evm");
const { createWalletClient, http } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { base } = require("viem/chains");

async function main() {
  const PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY;
  if (!PRIVATE_KEY) throw new Error("Set PAYER_PRIVATE_KEY env var");

  const account = privateKeyToAccount(PRIVATE_KEY);
  console.log("🔑 Payer:", account.address);

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http("https://mainnet.base.org"),
  });

  // Create x402 client and register for BOTH v1 and v2
  const evmScheme = new ExactEvmScheme(walletClient);
  const client = new x402Client()
    .register("eip155:8453", evmScheme)       // v2 (default)
    .register("eip155:8453", evmScheme, 1);   // v1 protocol

  const httpClient = new x402HTTPClient(client);

  // Wrap fetch
  const { wrapFetchWithPayment } = require("@x402/fetch");
  const fetchWithPay = wrapFetchWithPayment(fetch, client);

  console.log("📡 Making x402 payment to archtools.dev...");
  try {
    const response = await fetchWithPay("https://archtools.dev/v1/tools/search-web", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "what is x402 protocol" }),
    });

    console.log("Status:", response.status);
    if (response.ok) {
      const data = await response.json();
      console.log("🎉 SUCCESS! First x402 payment processed!");
      console.log("Response:", JSON.stringify(data).substring(0, 500));
      
      // Check for payment response header
      const paymentResponse = response.headers.get("PAYMENT-RESPONSE") || response.headers.get("X-PAYMENT-RESPONSE");
      if (paymentResponse) {
        console.log("Payment response:", paymentResponse);
      }
    } else {
      const text = await response.text();
      console.log("Response:", text.substring(0, 500));
    }
  } catch (e) {
    console.error("Error:", e.message);
  }
}

main();
