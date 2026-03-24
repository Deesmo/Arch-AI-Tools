# Changelog

All notable changes to Arch AI Tools will be documented in this file.

## [1.9.0] — 2026-03-23

### Added
- New tools: wallet-balance (CDP Token Balances API), address-history (CDP Transaction History API), gas-price (Base RPC eth_gasPrice)
- AgentKit MCP server: api/src/mcp/ added for Claude Desktop, Cursor, VS Code integration
- Dual-catalog registration: CDP Bazaar + x402.org discovery
- Bazaar extension: all routes now have discovery metadata via declareDiscoveryExtension
- RENDER_API_KEY added to GitHub Secrets

### Changed
- Pricing floor: 61 tools raised to $0.010+ minimum
- CDP ES256 API key: replaced broken Ed25519 key with ES256 (required by CDP facilitator)
- Prisma migration completed for x402Payment model

### Fixed
- CDP env var alias resolution (CDP_API_KEY → CDP_API_KEY_ID) in x402.ts

## [1.8.0] — 2026-03-15

### Added
- 53 production-ready tools (up from 45) — new additions: fact-check, news-search, research-report, crypto-sentiment, crypto-ohlcv, token-lookup, crypto-fear-greed, workflow-agent
- MCP server-card.json with full tool annotations (readOnlyHint, destructiveHint, openWorldHint)
- Smithery HTTP transport support with configurable API key and base URL
- Resources: tool catalog (`arch://tools/catalog`) and quickstart guide (`arch://docs/quickstart`)
- Prompts: research-topic, fact-check-claim, analyze-url
- DALL-E 3 image generation (generate-image tool)
- ElevenLabs text-to-speech (text-to-speech tool)
- OpenAI Whisper audio transcription (transcribe-audio tool)
- Resend email delivery (send-email tool)
- Browser automation via Playwright (browser-task tool)
- Comprehensive legal pages (terms, privacy, AUP, refund, security, retention, subprocessors)

### Changed
- SSE transport upgraded to SSE + Streamable HTTP
- SSRF hardening on web-scrape and browser-task tools
- Improved rate limiting with plan-based tiers (free/pro/business)

### Fixed
- Stripe webhook idempotency (no duplicate credit grants)
- Registration rate limiting (5/IP/hour)

## [1.0.0] — 2026-02-27

### Added
- Initial release with 8 core tools
- Agent authentication with hashed API keys
- Credit system with Stripe checkout
- PostgreSQL via Prisma ORM
- Render Blueprint deployment
- x402 USDC payment discovery
