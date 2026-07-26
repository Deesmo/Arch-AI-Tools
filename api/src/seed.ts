import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TOOLS = [
  { name: "validate-data", description: "Validate JSON against a JSON Schema", category: "data", credits: 1 },
  { name: "generate-hash", description: "Generate cryptographic hashes (sha256/sha512/md5)", category: "security", credits: 1 },
  { name: "qr-code", description: "Generate QR codes (PNG or SVG)", category: "media", credits: 2 },
  { name: "convert-format", description: "Convert between JSON, YAML, CSV, XML", category: "data", credits: 2 },
  { name: "transform-text", description: "Transform text (10 modes: slug, camel, base64…)", category: "text", credits: 3 },
  { name: "extract-metadata", description: "Extract OG tags, word count, links from text or URLs", category: "data", credits: 3 },
  { name: "web-scrape", description: "Scrape any public URL with optional CSS selector", category: "web", credits: 5 },
  { name: "extract-page", description: "Clean text, links, and metadata from any webpage", category: "web", credits: 5 },
  { name: "search-web", description: "Web search with structured results (DuckDuckGo)", category: "web", credits: 5 },
  { name: "web-search", description: "Real-time web search with AI-synthesized answer", category: "ai", credits: 10 },
  { name: "rss-parse", description: "Parse RSS/Atom feeds into structured JSON", category: "web", credits: 4 },
  { name: "ip-lookup", description: "Geo, ISP, VPN/proxy detection", category: "network", credits: 2 },
  { name: "whois-lookup", description: "Domain registration, expiry, nameservers via RDAP", category: "network", credits: 3 },
  { name: "email-verify", description: "MX check + disposable domain detection", category: "validation", credits: 3 },
  { name: "phone-validate", description: "E.164 format, type, country code", category: "validation", credits: 2 },
  { name: "currency-convert", description: "170+ currencies with live rates", category: "finance", credits: 2 },
  { name: "timezone-convert", description: "Convert datetime between any two IANA timezones", category: "utility", credits: 1 },
  { name: "generate-uuid", description: "Generate UUIDs, tokens, and API-key-format strings", category: "utility", credits: 1 },
  { name: "diff-text", description: "Structured diff in unified, words, chars, or JSON format", category: "text", credits: 2 },
  { name: "readability-score", description: "Flesch-Kincaid readability and grade level", category: "text", credits: 2 },
  { name: "language-detect", description: "Detect language with confidence score (100+ languages)", category: "ai", credits: 3 },
  { name: "sentiment-analysis", description: "Sentiment + emotion detection (joy, anger, fear…)", category: "ai", credits: 8 },
  { name: "summarize", description: "Summarize in 5 styles (bullets, tldr, executive…)", category: "ai", credits: 10 },
  { name: "extract-entities", description: "NER: people, orgs, locations, dates, money", category: "ai", credits: 8 },
  { name: "regex-generate", description: "Generate regex from plain English with explanations", category: "ai", credits: 8 },
  { name: "pii-detect", description: "Detect and optionally redact PII", category: "security", credits: 10 },
  { name: "ai-generate", description: "AI text generation via Claude (claude-sonnet-4-6)", category: "ai", credits: 20 },
  { name: "ocr-extract", description: "Extract text from images (URL or base64)", category: "ai", credits: 10 },
  { name: "browser-task", description: "Headless browser automation (click/type/extract) via Playwright", category: "web", credits: 10 },
  { name: "extract-pdf", description: "Extract text from a PDF (URL or base64)", category: "ai", credits: 6 },
  { name: "screenshot-capture", description: "Capture page metadata and screenshot URL for any public URL", category: "web", credits: 10 },
  { name: "html-to-markdown", description: "Convert HTML or any URL to clean Markdown", category: "text", credits: 3 },
  { name: "url-shorten", description: "Shorten any URL via TinyURL", category: "utility", credits: 1 },
  { name: "webhook-send", description: "POST a JSON payload to any webhook URL", category: "utility", credits: 2 },
  { name: "jsonpath-query", description: "Run JSONPath expressions against any JSON payload", category: "data", credits: 1 },
  { name: "image-generate", description: "Generate SVG images from text prompts via Claude", category: "ai", credits: 15 },
  { name: "barcode-generate", description: "Generate Code128 barcodes as SVG", category: "media", credits: 2 },
  { name: "workflow-agent", description: "Multi-step autonomous AI agent pipeline", category: "ai", credits: 25 },
  // Crypto data tools
  { name: "crypto-price", description: "Real-time price, 24h change, market cap, and volume for any cryptocurrency via CoinGecko", category: "crypto", credits: 1 },
  { name: "crypto-ohlcv", description: "OHLCV candlestick data for any crypto over 1–90 days. Used by trading agents for technical analysis", category: "crypto", credits: 2 },
  { name: "crypto-market-cap", description: "Top N cryptocurrencies by market cap with price, volume, and 24h change", category: "crypto", credits: 1 },
  { name: "crypto-fear-greed", description: "Crypto Fear & Greed Index with historical data. Contrarian sentiment signal for trading agents", category: "crypto", credits: 1 },
  { name: "crypto-sentiment", description: "Community sentiment, social stats, and price momentum for any cryptocurrency", category: "crypto", credits: 2 },
  { name: "crypto-news", description: "Latest crypto news headlines with source and timestamp. Filter by token symbol", category: "crypto", credits: 2 },
  { name: "token-lookup", description: "Search for any token by name or ticker. Returns CoinGecko IDs for use with other crypto tools", category: "crypto", credits: 1 },
  // Audio & speech tools
  { name: "text-to-speech", description: "Convert text to natural-sounding audio via ElevenLabs (returns base64 MP3)", category: "media", credits: 65 },
  { name: "transcribe-audio", description: "Transcribe audio files to text via OpenAI Whisper (URL input, 100+ languages)", category: "media", credits: 25 },
  // Communication tools
  { name: "email-send", description: "Send transactional emails via Resend — plain text or HTML", category: "communication", credits: 3 },
  { name: "email-find", description: "Find email address for a person at a company via Hunter.io", category: "communication", credits: 5 },
  // Image & design tools
  { name: "design-create", description: "Generate images from text prompts via DALL-E 3 (1024x1024, 1792x1024, 1024x1792)", category: "media", credits: 30 },
  { name: "image-remove-bg", description: "Remove background from any image via RemoveBG", category: "media", credits: 350 },
  // Domain & network tools
  { name: "domain-check", description: "Check if a domain is available or registered via RDAP (no key needed)", category: "network", credits: 2 },
  // AI premium tools
  { name: "ai-oracle", description: "Premium reasoning with structured analysis and confidence levels", category: "ai", credits: 25 },
  { name: "session-create", description: "Create a managed conversation session with optional system prompt", category: "ai", credits: 5 },
  { name: "session-message", description: "Send a message in an existing conversation session", category: "ai", credits: 20 },
  { name: "semantic-search", description: "Neural/semantic web search via Exa AI", category: "ai", credits: 8 },
  // Research & analysis tools
  { name: "news-search", description: "Search real-time news articles by keyword via Brave/Tavily/Serper", category: "web", credits: 3 },
  { name: "research-report", description: "Generate a structured research report on any topic with citations", category: "ai", credits: 40 },
  { name: "fact-check", description: "Verify claims against real-time web sources with verdict and confidence", category: "ai", credits: 10 },
  // Video generation
  { name: "video-generate", description: "AI video generation from text prompts via Runway Gen-3", category: "media", credits: 500 },
];

async function main(): Promise<void> {
  console.log("Seeding tools…");
  for (const tool of TOOLS) {
    const endpoint = `/v1/tools/${tool.name}`;
    await prisma.tool.upsert({
      where: { name: tool.name },
      update: { description: tool.description, category: tool.category, credits: tool.credits },
      // @ts-ignore — endpoint/method/active exist in prod schema; local client may be stale
      create: { ...tool, endpoint, method: "POST", active: true },
    });
  }
  console.log(`Seeded ${TOOLS.length} tools.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
