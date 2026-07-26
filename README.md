# Arch AI Tools

**64 production-ready API tools for AI agents** — web scraping, AI generation (Claude/GPT-4/Grok/Gemini), crypto data, OCR, image generation (DALL-E 3), audio transcription, text-to-speech, email, domain lookup, and more.

[![Smithery](https://smithery.ai/badge/mcmetaverse/arch-tools)](https://smithery.ai/server/mcmetaverse/arch-tools)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@deesmo/arch-tools-mcp)](https://www.npmjs.com/package/@deesmo/arch-tools-mcp)

**Live:** [archtools.dev](https://archtools.dev) · **Docs:** [archtools.dev/docs](https://archtools.dev) · **MCP SSE:** `https://arch-tools-mcp.onrender.com/sse`

---

## Quick Start

### Install via Smithery

```bash
npx -y @smithery/cli install mcmetaverse/arch-tools --client claude
```

### Install via npx

```bash
npx @deesmo/arch-tools-mcp
```

### Manual (Claude Desktop)

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arch-tools": {
      "command": "npx",
      "args": ["-y", "@deesmo/arch-tools-mcp"],
      "env": {
        "ARCH_API_KEY": "arch_your_key_here"
      }
    }
  }
}
```

### SSE (Hosted / Remote Agents)

Connect to the hosted SSE endpoint:

```
https://arch-tools-mcp.onrender.com/sse
```

No installation required — works with any MCP-compatible client that supports SSE transport.

---

## Get Your API Key

1. Visit [archtools.dev](https://archtools.dev) — or `POST /v1/agent/register` (one call, see below)
2. Register with your email
3. 10 free credits are active **instantly**; verifying your email unlocks the rest of the 100-credit grant

---

## For AI agents

You don't need a human to start using this API. One POST returns a key with 10 credits usable
immediately — then pay per call in USDC (x402) or with Stripe credit packs when they run out.

- **Start here:** [`https://archtools.dev/llms.txt`](https://archtools.dev/llms.txt) — the whole
  funnel (register → call tools → 402 → pay) in one agent-parseable page.
  Full per-tool docs: [`https://archtools.dev/llms-full.txt`](https://archtools.dev/llms-full.txt)
- **Copy-paste recipes** ([examples/agent-recipes/](examples/agent-recipes/)):
  - [Zero-signup research agent](examples/agent-recipes/01-zero-signup-research-agent.md) — register → `search-web` → `summarize`
  - [Crypto data agent](examples/agent-recipes/02-crypto-data-agent.md) — `crypto-price` + `crypto-fear-greed` + `ai-generate`
  - [x402 autonomous payment flow](examples/agent-recipes/03-x402-autonomous-payment.md) — call with no key → parse the 402 → pay USDC → retry
- **MCP-native agents:** official registry listing **`io.github.Deesmo/arch-tools-mcp`**;
  hosted server at `https://arch-tools-mcp.onrender.com/mcp` (streamable HTTP) and
  `https://arch-tools-mcp.onrender.com/sse` (SSE), or run locally with `npx @deesmo/arch-tools-mcp`.
- **Live discovery:** [`/v1/tools`](https://archtools.dev/v1/tools) (catalog + schemas + credit costs) ·
  [`/v1/discover`](https://archtools.dev/v1/discover) (everything in one call) ·
  [`/.well-known/x402`](https://archtools.dev/.well-known/x402) (payment options)

---

## All 64 Tools

### 🤖 AI & Generation
| Tool | Description | Credits |
|------|-------------|---------|
| `ai-generate` | Text generation via Claude (Haiku/Sonnet/Opus) | 20 |
| `generate-image` | Image generation via DALL-E 3 (1024×1024, 1792×1024, 1024×1792) | 25 |
| `image-generate` | SVG image generation via Claude | 20 |
| `text-to-speech` | Natural audio via ElevenLabs (multiple voices) | 15 |
| `transcribe-audio` | Audio → text via OpenAI Whisper (100+ languages) | 15 |
| `summarize` | Multi-style summaries (paragraph, bullets, TLDR, executive) | 5 |
| `sentiment-analysis` | Sentiment detection with emotion scores | 5 |
| `extract-entities` | Named entity recognition (people, orgs, locations, dates) | 5 |
| `readability-score` | Flesch-Kincaid grade level, word count, read time | 3 |
| `fact-check` | Verify claims with confidence scores and evidence | 10 |
| `research-report` | Multi-source research with citations | 15 |
| `workflow-agent` | Multi-step autonomous AI agent pipeline | 20 |
| `ai-oracle` | Premium reasoning with structured analysis and confidence | 25 |
| `session-create` | Create a managed conversation session | 5 |
| `session-message` | Send a message in a conversation session | 20 |
| `semantic-search` | Neural/semantic web search via Exa AI | 8 |

### 🎨 Media & Design
| Tool | Description | Credits |
|------|-------------|---------|
| `design-create` | Image generation via DALL-E 3 | 30 |
| `video-generate` | AI video generation via Runway Gen-3 | 50 |
| `image-remove-bg` | Remove background from any image via RemoveBG | 10 |

### 🌐 Web & Scraping
| Tool | Description | Credits |
|------|-------------|---------|
| `web-scrape` | Scrape websites with CSS selectors (SSRF hardened) | 5 |
| `search-web` | Web search via Tavily/Serper/DuckDuckGo | 5 |
| `web-search` | AI-synthesized web search answers | 10 |
| `extract-page` | Clean text/markdown from any URL | 5 |
| `extract-metadata` | OG tags, headers, word count from URLs | 3 |
| `extract-pdf` | Text and tables from PDFs | 5 |
| `screenshot-capture` | Page screenshots with metadata | 5 |
| `browser-task` | Headless browser automation via Playwright | 10 |
| `html-to-markdown` | Convert HTML to clean Markdown | 2 |
| `rss-parse` | RSS/Atom feed parser | 3 |
| `news-search` | Latest news articles on any topic | 5 |
| `ocr-extract` | Text from images via AI vision | 10 |

### 💰 Crypto & Finance
| Tool | Description | Credits |
|------|-------------|---------|
| `crypto-price` | Real-time price, market cap, volume | 3 |
| `crypto-market-cap` | Top N cryptocurrencies ranked | 3 |
| `crypto-ohlcv` | Candlestick data (1–90 days) | 5 |
| `crypto-sentiment` | Community sentiment and social stats | 5 |
| `crypto-news` | Latest crypto headlines by topic | 3 |
| `crypto-fear-greed` | Fear & Greed Index with history | 3 |
| `token-lookup` | Search tokens by name/ticker/address | 3 |
| `currency-convert` | 170+ currency exchange rates | 3 |

### 🔧 Data & Utilities
| Tool | Description | Credits |
|------|-------------|---------|
| `validate-data` | JSON Schema validation | 1 |
| `convert-format` | JSON ↔ YAML ↔ CSV ↔ XML ↔ TOML | 2 |
| `transform-text` | uppercase, slug, camelCase, base64, reverse, etc. | 3 |
| `diff-text` | Compare texts (unified, word, char, JSON) | 3 |
| `generate-hash` | SHA-256, SHA-512, MD5, SHA-1 | 1 |
| `generate-uuid` | UUID, ULID, nanoid, CUID | 1 |
| `regex-generate` | Natural language → regex with explanations | 5 |
| `jsonpath-query` | JSONPath expressions on JSON data | 2 |
| `language-detect` | Language detection with confidence scores | 2 |

### 📧 Communication
| Tool | Description | Credits |
|------|-------------|---------|
| `send-email` | Transactional email via Resend (alias) | 5 |
| `email-send` | Transactional email via Resend | 3 |
| `email-verify` | Deep validation: syntax, MX, disposable detection | 3 |
| `email-find` | Find email for a person at a company via Hunter.io | 5 |
| `social-post` | Post a tweet to X/Twitter via API v2 | 5 |

### 🔍 Lookup & Validation
| Tool | Description | Credits |
|------|-------------|---------|
| `check-domain` | Domain availability via RDAP (alias) | 3 |
| `domain-check` | Domain availability check via RDAP | 2 |
| `whois-lookup` | WHOIS registration info and nameservers | 3 |
| `ip-lookup` | IP geolocation, ISP, VPN detection | 3 |
| `phone-validate` | Phone parsing, E.164 format, carrier type | 2 |
| `pii-detect` | Detect and redact PII (SSNs, cards, keys) | 5 |
| `url-shorten` | Shorten URLs via TinyURL | 1 |

### 🔌 Integration
| Tool | Description | Credits |
|------|-------------|---------|
| `webhook-send` | POST JSON to any webhook URL | 3 |
| `barcode-generate` | Code128/QR/EAN13/UPC barcodes as SVG | 2 |
| `qr-code` | QR codes from text/URLs (PNG or SVG) | 2 |
| `timezone-convert` | Convert between IANA timezones | 1 |

---

## Usage Examples

### Search the web
```json
{
  "tool": "search-web",
  "arguments": {
    "query": "latest AI breakthroughs 2026",
    "num_results": 5
  }
}
```

### Generate an image
```json
{
  "tool": "generate-image",
  "arguments": {
    "prompt": "A futuristic city skyline at sunset, cyberpunk style",
    "size": "1792x1024",
    "quality": "hd"
  }
}
```

### Get crypto price
```json
{
  "tool": "crypto-price",
  "arguments": {
    "symbol": "bitcoin",
    "currency": "usd"
  }
}
```

### Fact-check a claim
```json
{
  "tool": "fact-check",
  "arguments": {
    "claim": "The Great Wall of China is visible from space"
  }
}
```

### Scrape a webpage
```json
{
  "tool": "web-scrape",
  "arguments": {
    "url": "https://news.ycombinator.com",
    "selector": ".titleline > a",
    "format": "text"
  }
}
```

---

## Payment

- **Free grant:** 100 credits on signup — 10 active instantly (no email click), 90 on email verification
- **Credit packs:** Purchase via Stripe at [archtools.dev/pricing](https://archtools.dev/pricing)
- **x402 (autonomous):** AI agents can pay per-call with USDC — see `/.well-known/x402` and the
  [x402 payment recipe](examples/agent-recipes/03-x402-autonomous-payment.md)

---

## Community

- 💬 **[GitHub Discussions](https://github.com/Deesmo/Arch-AI-Tools/discussions)** — Ask questions, share ideas, show off what you've built
- 📢 **[Announcements](https://github.com/Deesmo/Arch-AI-Tools/discussions/categories/announcements)** — Product updates and new tool releases
- 🙋 **[Q&A](https://github.com/Deesmo/Arch-AI-Tools/discussions/categories/q-a)** — Get help with x402 payments, API keys, MCP setup
- 💡 **[Ideas](https://github.com/Deesmo/Arch-AI-Tools/discussions/categories/ideas)** — Request new tools and features
- 🎉 **[Show & Tell](https://github.com/Deesmo/Arch-AI-Tools/discussions/categories/show-and-tell)** — Share agents and projects built with Arch Tools

---

## Architecture

```
arch-ai-tools/
├── api/          # Express API server (tools, auth, billing, dashboard)
├── mcp/          # MCP server (stdio + SSE transport)
├── smithery.yaml # Smithery registry config
├── render.yaml   # Render Blueprint (auto-deploy)
└── CHANGELOG.md  # Release history
```

## Security

- API keys stored as SHA-256 hashes (never plaintext)
- SSRF protection on all web-facing tools
- Registration rate-limited (5/IP/hour)
- Stripe webhook idempotency
- Helmet security headers
- CORS restricted to archtools.dev
- Tool inputs validated against JSON Schemas

---

## License

MIT — see [LICENSE](LICENSE) for details.

**Built by [MCMetaverse LLC](https://archtools.dev)** · [GitHub](https://github.com/Deesmo/Arch-AI-Tools)
