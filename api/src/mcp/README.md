# Arch Tools MCP Server

Add 64 AI tools to Claude Desktop, Cursor, VS Code, Windsurf, and any MCP-compatible client.

## Quick Setup

### Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "arch-tools": {
      "command": "npx",
      "args": ["@archtools/mcp"],
      "env": {
        "ARCH_TOOLS_API_KEY": "your_key_here"
      }
    }
  }
}
```

Get your API key at [archtools.dev/signup](https://archtools.dev/signup)

### Cursor / VS Code
Add to your MCP settings:
```json
{
  "arch-tools": {
    "command": "npx @archtools/mcp",
    "env": { "ARCH_TOOLS_API_KEY": "your_key_here" }
  }
}
```

## Tools Included (64 total)

- **AI**: ai-generate, summarize, ai-oracle, workflow-agent, research-report, fact-check
- **Web**: search-web, web-scrape, extract-page, screenshot-capture, semantic-search
- **Data**: extract-pdf, ocr-extract, extract-metadata, html-to-markdown, rss-parse
- **Media**: image-generate, image-remove-bg, text-to-speech, transcribe-audio
- **Crypto**: crypto-price, crypto-market-cap, crypto-ohlcv, crypto-news, token-lookup
- **Validation**: email-verify, phone-validate, ip-lookup, whois-lookup, domain-check
- **Utilities**: generate-uuid, generate-hash, qr-code, barcode-generate, timezone-convert
- ...and more

## Pricing
- Tools from $0.010–$0.100 per call
- Pay with API credits (Stripe) or USDC on Base (x402)

## Links
- [archtools.dev](https://archtools.dev) — main site
- [archtools.dev/fund](https://archtools.dev/fund) — buy USDC
- [archtools.dev/signup](https://archtools.dev/signup) — get API key
