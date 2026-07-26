# Recipe: x402 Autonomous Payment Flow

Call a tool with **no API key at all** → parse the `402` → pay USDC on-chain → retry the same
request. No signup, no card, no human. This documents the exact behavior of the live
middleware (`api/src/middleware/x402.ts`).

## The flow

1. **Call without credentials.** `POST /v1/tools/<name>` with no `Authorization`/`x-api-key`
   header and no payment header → HTTP **402**. The JSON body is the x402
   `PaymentRequirements` object, and the same object is base64-encoded in the
   `PAYMENT-REQUIRED` response header.
2. **Pick a payment option from `accepts[]`.** Only the options in the 402 you received are
   settleable. Live today: **USDC and USDT on Base and Polygon** (the broader multi-chain
   catalog at [`/.well-known/x402`](https://archtools.dev/.well-known/x402) shows everything
   the platform can be configured to accept). Each entry gives you everything needed to pay:

   ```json
   {
     "scheme": "exact",
     "network": "base",
     "amount": "10000",
     "maxAmountRequired": "10000",
     "resource": "https://archtools.dev/v1/tools/crypto-price",
     "payTo": "0x2583aAc89f58a63D9CCbeDaa5e3BaF2196Aa967e",
     "maxTimeoutSeconds": 60,
     "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
     "extra": { "name": "USD Coin", "version": "2" }
   }
   ```

   `amount` is in the token's atomic units — USDC has 6 decimals, so `"10000"` = **$0.01**.
   `asset` is the token contract on that network.
3. **Sign the payment.** For the `exact` scheme on EVM chains this is an EIP-3009
   `transferWithAuthorization` signature (an off-chain signature — you don't broadcast a
   transaction yourself). The x402 client SDKs do this for you (examples below).
4. **Retry the SAME request** with the signed payload, base64-encoded, in the
   **`Payment-Signature`** header (the legacy `X-Payment` header is also accepted).
5. **Server verifies, then settles on-chain, then runs the tool.** Access is granted only
   after the facilitator reports a successful settlement (`success: true`). The `200`
   response includes a **`PAYMENT-RESPONSE`** header — base64 JSON with
   `{ success, transaction, network, payer }` (your on-chain receipt).

### Failure modes (exact error codes from the middleware)

| 402 `error` value | Meaning | What to do |
|---|---|---|
| `payment_replay_detected` | that payment's nonce was already used | sign a fresh payment (each covers exactly one call) |
| `payment_invalid` | facilitator could not verify the signature | re-check the `accepts[]` entry you signed against; retry |
| `payment_settlement_failed` | verified but settlement failed — **you were not charged** | retry the same payment |

### Have a key but 0 credits?

With a valid key and not enough credits you get
`402 {"error": "insufficient_credits", "credits_remaining": ..., "credits_needed": ...}`.
The payment header takes precedence over the API key, so you can retry that same call with a
`Payment-Signature` header and pay per-call — or buy a pack at
[archtools.dev/pricing](https://archtools.dev/pricing).

## curl — inspect the 402

```bash
# No auth header on purpose: the 402 IS the price sheet
curl -s -X POST https://archtools.dev/v1/tools/crypto-price \
  -H 'content-type: application/json' -d '{"symbol":"bitcoin"}' | jq '{
    error, options: [.accepts[] | {network, token: .extra.name, amount, payTo, asset}]
  }'
```

## JavaScript — auto-pay with `x402-fetch`

Verified against the package docs (`npm install x402-fetch viem`). The server speaks x402 v1
in the 402 body and accepts both the v1 `X-Payment` and v2 `Payment-Signature` headers; the
v2 successor SDK is `@x402/fetch`.

```javascript
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";

// A wallet holding a little USDC on Base
const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY);
const wallet = createWalletClient({ account, transport: http(), chain: base });

// fetch that transparently answers 402s: sign → retry → return the tool result
const fetchWithPay = wrapFetchWithPayment(fetch, wallet);

const res = await fetchWithPay("https://archtools.dev/v1/tools/crypto-price", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ symbol: "bitcoin" }),
});
console.log(await res.json());                                   // tool result
console.log(res.headers.get("payment-response"));                // base64 settle receipt
```

## Python — explicit 402 → pay → retry with the `x402` package

`pip install "x402[requests]"` (Coinbase's official client — it builds the EIP-3009 payload;
signer setup per [docs.x402.org](https://docs.x402.org)).

```python
import base64, json, requests
from x402 import x402ClientSync
from x402.mechanisms.evm.exact import ExactEvmScheme

BASE = "https://archtools.dev"
TOOL = f"{BASE}/v1/tools/crypto-price"
BODY = {"symbol": "bitcoin"}

# 1. Call with no credentials → 402 with payment requirements
r1 = requests.post(TOOL, json=BODY)
assert r1.status_code == 402
payment_required = r1.json()          # same JSON as the PAYMENT-REQUIRED header, decoded

# 2-3. Build + sign the payment payload for one of the accepts[] options
client = x402ClientSync()
client.register("eip155:*", ExactEvmScheme(signer=my_signer))   # your EVM signer
payload = client.create_payment_payload(payment_required)

# 4. Retry the SAME request with the signed payload
r2 = requests.post(TOOL, json=BODY, headers={
    "Payment-Signature": base64.b64encode(json.dumps(payload).encode()).decode()
})
r2.raise_for_status()
print(r2.json())                                          # tool result
receipt = json.loads(base64.b64decode(r2.headers["PAYMENT-RESPONSE"]))
print("settled tx:", receipt["transaction"], "on", receipt["network"])
```

## Pricing

Per-call USD prices for all 64 tools are listed (with `payTo` targets per chain) at
[`/.well-known/x402`](https://archtools.dev/.well-known/x402). Most utility tools are
**$0.01/call**; AI-heavy tools like `ai-generate` and `research-report` are $0.04.
One payment covers exactly one call — nonces are single-use (replay-protected app-side and
consumed on-chain at settlement).
