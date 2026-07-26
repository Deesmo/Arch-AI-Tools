# Recipe: Zero-Signup Research Agent

Register → `search-web` → `summarize`. One POST gets you an API key with **10 credits usable
instantly** — no email click, no credit card, no dashboard. Total cost of this recipe:
**15 credits** (`search-web` = 5, `summarize` = 10).

> **Credit math:** the instant grant is 10 credits, so the search (5) always runs. The
> summarize step (10) needs 10 more: either verify the email you registered with (one click,
> unlocks the remaining **90** pending credits of the 100-credit grant), or let the call
> return `402 insufficient_credits` and pay per call with x402 — see
> [recipe 03](./03-x402-autonomous-payment.md).

## curl

```bash
# 1. Register once — returns your key (shown ONCE) + 10 instant credits
KEY=$(curl -s -X POST https://archtools.dev/v1/agent/register \
  -H 'content-type: application/json' \
  -d '{"name":"research-agent","email":"you@example.com"}' | jq -r .api_key)

# 2. Search the web (5 credits)
RESULTS=$(curl -s -X POST https://archtools.dev/v1/tools/search-web \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"query":"latest developments in agentic payments x402","limit":5}')
echo "$RESULTS" | jq .

# 3. Summarize the findings (10 credits)
curl -s -X POST https://archtools.dev/v1/tools/summarize \
  -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d "$(jq -n --arg t "$RESULTS" '{text:$t, style:"bullets"}')" | jq .

# Check yourself anytime
curl -s https://archtools.dev/v1/agent/me -H "authorization: Bearer $KEY" | jq .
```

## Python

```python
import requests

BASE = "https://archtools.dev"

# 1. Register once (10 credits active immediately, 90 pending email verification)
r = requests.post(f"{BASE}/v1/agent/register",
                  json={"name": "research-agent", "email": "you@example.com"})
r.raise_for_status()
acct = r.json()
key = acct["api_key"]          # shown once — persist it
print("instant credits:", acct["credits"])   # 10

H = {"authorization": f"Bearer {key}"}

# 2. Search the web (5 credits)
search = requests.post(f"{BASE}/v1/tools/search-web", headers=H,
                       json={"query": "latest developments in agentic payments x402",
                             "limit": 5})
search.raise_for_status()
results = search.json()

# 3. Summarize (10 credits) — handle 402 if the instant grant is spent
text = "\n".join(f"{x.get('title')}: {x.get('snippet','')}"
                 for x in results.get("results", []))
summ = requests.post(f"{BASE}/v1/tools/summarize", headers=H,
                     json={"text": text, "style": "bullets"})
if summ.status_code == 402:
    # insufficient_credits: verify your email (unlocks 90 more), buy a pack,
    # or pay this one call in USDC via x402 (recipe 03)
    print(summ.json())
else:
    print(summ.json()["summary"] if "summary" in summ.json() else summ.json())

# Account snapshot
print(requests.get(f"{BASE}/v1/agent/me", headers=H).json())
```

## Notes
- `x-api-key: YOUR_KEY` works everywhere `Authorization: Bearer` does.
- Every tool response carries an `X-Credits-Remaining` header.
- Live tool catalog + JSON schemas: `GET https://archtools.dev/v1/tools`.
- Registration is rate-limited (5/hour per IP) and rejects disposable email domains.
