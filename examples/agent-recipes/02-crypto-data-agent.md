# Recipe: Crypto Data Agent

`crypto-price` + `crypto-fear-greed` + `ai-generate` — pull live market data for 2 credits,
then have Claude write the take. Costs: `crypto-price` = 1, `crypto-fear-greed` = 1,
`ai-generate` = 20 credits.

> **Credit math:** the 10 instant signup credits cover the two data calls with room to spare.
> The `ai-generate` step (20) needs the verified-email grant (+90 credits), a
> [credit pack](https://archtools.dev/pricing), or a per-call x402 USDC payment
> ([recipe 03](./03-x402-autonomous-payment.md)). Skip step 3 and this recipe costs 2 credits.

## curl

```bash
# Register once if you don't have a key yet (see recipe 01)
KEY=arch_your_key_here

# 1. Live BTC price (1 credit) — symbol is a CoinGecko coin id
curl -s -X POST https://archtools.dev/v1/tools/crypto-price \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"symbol":"bitcoin"}' | jq .

# 2. Fear & Greed Index (1 credit)
curl -s -X POST https://archtools.dev/v1/tools/crypto-fear-greed \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"limit":1}' | jq .

# 3. Claude writes the market take (20 credits)
curl -s -X POST https://archtools.dev/v1/tools/ai-generate \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"prompt":"BTC is at $X with Fear & Greed at Y (Greed). Write a 3-sentence market summary for a trading journal.","max_tokens":300}' | jq .
```

## Python

```python
import requests

BASE = "https://archtools.dev"
H = {"authorization": "Bearer arch_your_key_here"}  # register once — see recipe 01

def tool(name, body):
    r = requests.post(f"{BASE}/v1/tools/{name}", headers=H, json=body)
    if r.status_code == 402:
        raise SystemExit(f"402 on {name}: {r.json()}")  # top up, verify email, or x402-pay
    r.raise_for_status()
    return r.json()

price = tool("crypto-price", {"symbol": "bitcoin"})          # 1 credit
fg    = tool("crypto-fear-greed", {"limit": 1})              # 1 credit

prompt = (f"Bitcoin market data: {price}. Fear & Greed: {fg}. "
          "Write a 3-sentence market summary for a trading journal.")
take = tool("ai-generate", {"prompt": prompt, "max_tokens": 300})  # 20 credits
print(take)
```

## More crypto tools (all in the live catalog at `GET /v1/tools`)
| Tool | Credits | What it returns |
|---|---|---|
| `crypto-price` | 1 | price, 24h change, market cap, volume |
| `crypto-market-cap` | 1 | top N coins by market cap |
| `crypto-fear-greed` | 1 | Fear & Greed Index + history |
| `token-lookup` | 1 | search any token by name/ticker |
| `crypto-ohlcv` | 2 | OHLCV candles for TA |
| `crypto-sentiment` | 2 | community sentiment + social stats |
| `crypto-news` | 2 | latest headlines, filterable by symbol |
