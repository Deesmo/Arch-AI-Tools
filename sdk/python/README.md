# Arch Tools Python SDK

Official Python client for [Arch Tools](https://archtools.dev) — 58 production API tools for AI agents with x402 USDC payments.

## Install

```bash
pip install arch-tools
```

## Quick Start

```python
from arch_tools import ArchTools

client = ArchTools(api_key="arch_your_key_here")

# AI generation
result = client.ai_generate(prompt="Write a haiku about x402 payments")
print(result["text"])

# Web scraping
page = client.web_scrape(url="https://example.com")
print(page["text"])

# Crypto price
price = client.crypto_price(symbol="bitcoin")
print(price["usd"])

# Any tool
result = client.call("ocr-extract", image_url="https://example.com/image.png")
```

## All 58 Tools

Use `client.call("tool-name", **params)` for any tool. See [archtools.dev/docs](https://archtools.dev/docs) for the full list.

## x402 Payments

Agents without an API key can pay per-call with USDC. See the [BYOK guide](https://archtools.dev/byok).

## Error Handling

```python
from arch_tools import ArchTools, PaymentRequiredError, RateLimitError

client = ArchTools(api_key="arch_...")
try:
    result = client.web_scrape(url="https://example.com")
except RateLimitError as e:
    print(f"Rate limited. Retry after: {e.retry_after}s")
except PaymentRequiredError:
    print("No credits. Top up at archtools.dev or pay with USDC via x402.")
```
