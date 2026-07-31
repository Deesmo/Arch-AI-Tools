# Arch Tools Python SDK

Official Python client for [Arch Tools](https://archtools.dev) — **63 production API tools** for AI agents with **x402 USDC payments** (patent-pending).

[![PyPI](https://img.shields.io/pypi/v/arch-tools)](https://pypi.org/project/arch-tools/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Install

```bash
pip install arch-tools
```

## Quick Start

```python
from arch_tools import ArchTools

client = ArchTools(api_key="arch_your_key_here")

# AI generation (Claude, GPT-4, Grok, Gemini)
result = client.ai_generate(prompt="Explain quantum computing in 3 sentences")
print(result["text"])

# Web scraping with markdown output
page = client.web_scrape(url="https://news.ycombinator.com", format="markdown")
print(page["text"][:500])

# Real-time crypto data
btc = client.crypto_price(symbol="bitcoin")
print(f"Bitcoin: ${btc['price']:,.2f} ({btc['change_24h']:+.1f}%)")

# AI-powered web search with citations
answer = client.call("web-search", query="What is x402 protocol?")
print(answer["answer"])
```

## Example: Research Agent Pipeline

```python
from arch_tools import ArchTools

client = ArchTools(api_key="arch_your_key_here")

# Step 1: Search the web
results = client.call("search-web", query="best AI agent frameworks 2025", num_results=5)

# Step 2: Scrape the top result
page = client.web_scrape(url=results["results"][0]["url"])

# Step 3: Summarize the content
summary = client.call("summarize", text=page["text"], style="executive")
print(summary["summary"])

# Step 4: Detect sentiment
sentiment = client.call("sentiment-analysis", text=summary["summary"])
print(f"Sentiment: {sentiment['sentiment']} (score: {sentiment['score']})")
```

## Example: Crypto Analysis Agent

```python
from arch_tools import ArchTools

client = ArchTools(api_key="arch_your_key_here")

# Get price, fear/greed index, and news in parallel
price = client.crypto_price(symbol="ethereum")
fng = client.call("crypto-fear-greed", limit=1)
news = client.call("crypto-news", symbol="ETH", limit=5)

# Use AI Oracle for deep analysis
analysis = client.call("ai-oracle",
    question=f"Should I buy Ethereum at ${price['price']}? Fear/Greed index is {fng['current']['value']}.",
    reasoning_depth="deep"
)
print(analysis["analysis"])
```

## All 63 Tools

| Category | Tools |
|----------|-------|
| 🤖 AI | ai-generate, ai-oracle, summarize, sentiment-analysis, extract-entities, regex-generate, pii-detect |
| 🌐 Web | web-scrape, search-web, web-search, extract-page, extract-metadata, html-to-markdown, semantic-search |
| 💰 Crypto | crypto-price, crypto-ohlcv, crypto-market-cap, crypto-fear-greed, crypto-sentiment, crypto-news, token-lookup |
| 🛠️ Utility | generate-hash, generate-uuid, convert-format, transform-text, diff-text, validate-data, jsonpath-query |
| 🔍 Lookup | ip-lookup, whois-lookup, email-verify, phone-validate, domain-check, email-find |
| 🎨 Media | image-generate, design-create, image-remove-bg, ocr-extract, extract-pdf, barcode-generate, qr-code |
| 📡 Communication | email-send, webhook-send, text-to-speech, transcribe-audio |
| 📊 Intelligence | news-search, research-report, fact-check, readability-score, language-detect, currency-convert |
| 🤖 Agents | workflow-agent, session-create, session-message, browser-task, screenshot-capture |

Use `client.call("tool-name", **params)` for any tool. Full docs: [archtools.dev/docs](https://archtools.dev/docs)

## x402 USDC Payments (Patent-Pending)

When credits run out, agents can pay per-call with USDC on Base or Polygon:

```python
# API returns 402 with payment details
# Agent signs USDC payment → retries with X-Payment header → gets result
# No human intervention needed. Fully autonomous.
```

Supported chains: Base and Polygon.

## BYOK (Bring Your Own Key)

Skip credit costs by passing your own API keys:

```python
client = ArchTools(api_key="arch_...")

# Use your own Anthropic key — zero credits charged
result = client.call("ai-generate",
    prompt="Hello world",
    _headers={"x-anthropic-key": "sk-ant-..."}
)
```

## Error Handling

```python
from arch_tools import ArchTools, PaymentRequiredError, RateLimitError

client = ArchTools(api_key="arch_...")
try:
    result = client.web_scrape(url="https://example.com")
except RateLimitError as e:
    print(f"Rate limited. Retry after: {e.retry_after}s")
except PaymentRequiredError:
    print("No credits. Top up at archtools.dev/pricing or pay with USDC via x402.")
```

## Links

- **Docs**: [archtools.dev/docs](https://archtools.dev/docs)
- **Playground**: [archtools.dev/playground](https://archtools.dev/playground)
- **MCP Server**: [Smithery](https://smithery.ai/server/mcmetaverse/arch-tools)
- **LangChain Guide**: [archtools.dev/langchain-guide](https://archtools.dev/langchain-guide)
- **GitHub**: [github.com/Deesmo/Arch-AI-Tools](https://github.com/Deesmo/Arch-AI-Tools)
