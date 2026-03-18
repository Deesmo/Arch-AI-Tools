/**
 * x402 Payment Middleware — v15
 *
 * Implements the Coinbase x402 protocol for HTTP-native USDC payments.
 * AI agents that don't have pre-purchased credits can pay per-call with USDC on Base.
 *
 * Flow:
 *   1. Agent hits /v1/tools/:tool with no API key (or insufficient credits)
 *   2. Server returns 402 with x-payment-details header
 *   3. Agent signs USDC payment, retries request with X-Payment header
 *   4. Middleware verifies payment with facilitator, then allows request through
 *
 * Official package: npm install x402-express (swap this in for production if preferred)
 */
import axios from "axios";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { redis } from "../lib/redis.js";
// x402scan output schema map — generated from openapi.json
// Required by x402scan for resource registration ("Missing input schema" fix)
export const TOOL_OUTPUT_SCHEMAS = { "validate-data": { "input": { "type": "http", "method": "POST", "bodyFields": { "data": { "type": "string", "description": "The JSON data to validate", "required": true }, "schema": { "type": "object", "description": "JSON Schema to validate against", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "generate-hash": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to hash", "required": true }, "algorithm": { "type": "string", "enum": ["sha256", "sha512", "md5", "sha1"], "description": "(default: sha256)" } } }, "output": { "type": "object", "description": "JSON response" } }, "qr-code": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text or URL to encode", "required": true }, "size": { "type": "integer", "description": "Image size in pixels (default: 200)" }, "format": { "type": "string", "enum": ["png", "svg"], "description": "(default: png)" } } }, "output": { "type": "object", "description": "JSON response" } }, "convert-format": { "input": { "type": "http", "method": "POST", "bodyFields": { "input": { "type": "string", "description": "The content to convert (serialized as a string)", "required": true }, "from": { "type": "string", "description": "Source format", "required": true, "enum": ["json", "yaml", "csv", "xml", "toml"] }, "to": { "type": "string", "description": "Target format", "required": true, "enum": ["json", "yaml", "csv", "xml", "toml"] } } }, "output": { "type": "object", "description": "JSON response" } }, "transform-text": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to transform", "required": true }, "mode": { "type": "string", "description": "Transformation mode", "required": true, "enum": ["slug", "camel", "snake", "pascal", "kebab", "upper", "lower", "title", "base64_encode", "base64_decode"] } } }, "output": { "type": "object", "description": "JSON response" } }, "extract-metadata": { "input": { "type": "http", "method": "POST", "bodyFields": { "url": { "type": "string", "description": "URL to extract metadata from" }, "text": { "type": "string", "description": "Raw text to analyze (alternative to url)" } } }, "output": { "type": "object", "description": "JSON response" } }, "web-scrape": { "input": { "type": "http", "method": "POST", "bodyFields": { "url": { "type": "string", "description": "URL to scrape", "required": true }, "format": { "type": "string", "enum": ["markdown", "html", "text"], "description": "(default: markdown)" }, "selector": { "type": "string", "description": "CSS selector to extract specific element" } } }, "output": { "type": "object", "description": "JSON response" } }, "extract-page": { "input": { "type": "http", "method": "POST", "bodyFields": { "url": { "type": "string", "description": "URL of the webpage to extract", "required": true }, "include_links": { "type": "boolean", "description": "Include extracted links (default: True)" } } }, "output": { "type": "object", "description": "JSON response" } }, "search-web": { "input": { "type": "http", "method": "POST", "bodyFields": { "query": { "type": "string", "description": "Search query", "required": true }, "limit": { "type": "integer", "description": "(default: 10)" } } }, "output": { "type": "object", "description": "JSON response" } }, "rss-parse": { "input": { "type": "http", "method": "POST", "bodyFields": { "url": { "type": "string", "description": "RSS or Atom feed URL", "required": true }, "limit": { "type": "integer", "description": "Maximum number of items to return (default: 20)" } } }, "output": { "type": "object", "description": "JSON response" } }, "ip-lookup": { "input": { "type": "http", "method": "POST", "bodyFields": { "ip": { "type": "string", "description": "IP address (uses caller's IP if omitted)" } } }, "output": { "type": "object", "description": "JSON response" } }, "whois-lookup": { "input": { "type": "http", "method": "POST", "bodyFields": { "domain": { "type": "string", "description": "Domain name to look up (e.g. example.com)", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "email-verify": { "input": { "type": "http", "method": "POST", "bodyFields": { "email": { "type": "string", "description": "Email address to verify", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "phone-validate": { "input": { "type": "http", "method": "POST", "bodyFields": { "phone": { "type": "string", "description": "Phone number to validate", "required": true }, "country": { "type": "string", "description": "ISO 3166-1 alpha-2 country code (e.g. US, GB)" } } }, "output": { "type": "object", "description": "JSON response" } }, "currency-convert": { "input": { "type": "http", "method": "POST", "bodyFields": { "amount": { "type": "number", "description": "Amount to convert", "required": true }, "from": { "type": "string", "description": "Source currency code (e.g. USD, EUR, GBP)", "required": true }, "to": { "type": "string", "description": "Target currency code (e.g. EUR, JPY, BTC)", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "timezone-convert": { "input": { "type": "http", "method": "POST", "bodyFields": { "datetime": { "type": "string", "description": "ISO 8601 datetime to convert (e.g. 2024-01-15T14:30:00)", "required": true }, "from_tz": { "type": "string", "description": "Source IANA timezone (e.g. America/New_York)", "required": true }, "to_tz": { "type": "string", "description": "Target IANA timezone (e.g. Europe/London)", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "generate-uuid": { "input": { "type": "http", "method": "POST", "bodyFields": { "type": { "type": "string", "description": "Type of identifier to generate (default: uuid)", "enum": ["uuid", "token", "api-key"] }, "count": { "type": "integer", "description": "Number of identifiers to generate (default: 1)" }, "length": { "type": "integer", "description": "Length for token/api-key types (default: 32)" } } }, "output": { "type": "object", "description": "JSON response" } }, "diff-text": { "input": { "type": "http", "method": "POST", "bodyFields": { "text1": { "type": "string", "description": "Original text", "required": true }, "text2": { "type": "string", "description": "Modified text", "required": true }, "mode": { "type": "string", "description": "Diff output format (default: unified)", "enum": ["unified", "words", "chars", "json"] } } }, "output": { "type": "object", "description": "JSON response" } }, "readability-score": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to analyze for readability", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "language-detect": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to detect the language of", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "sentiment-analysis": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to analyze", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "summarize": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to summarize", "required": true }, "style": { "type": "string", "description": "Summary style (default: bullets)", "enum": ["bullets", "tldr", "executive", "paragraph", "headline"] }, "max_length": { "type": "integer", "description": "Maximum summary length in words" } } }, "output": { "type": "object", "description": "JSON response" } }, "extract-entities": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to extract entities from", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "regex-generate": { "input": { "type": "http", "method": "POST", "bodyFields": { "description": { "type": "string", "description": "Plain English description of the pattern to match", "required": true }, "test_strings": { "type": "array", "description": "Optional strings to test the generated regex against" } } }, "output": { "type": "object", "description": "JSON response" } }, "pii-detect": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to scan for PII", "required": true }, "redact": { "type": "boolean", "description": "Whether to return redacted version of the text (default: False)" } } }, "output": { "type": "object", "description": "JSON response" } }, "web-search": { "input": { "type": "http", "method": "POST", "bodyFields": { "query": { "type": "string", "description": "Search query", "required": true }, "limit": { "type": "integer", "description": "Number of source results (default: 5)" } } }, "output": { "type": "object", "description": "JSON response" } }, "ai-generate": { "input": { "type": "http", "method": "POST", "bodyFields": { "prompt": { "type": "string", "description": "The prompt or question", "required": true }, "model": { "type": "string", "description": "AI model to use (default: claude)", "enum": ["claude", "gpt4", "grok", "gemini"] }, "system": { "type": "string", "description": "System prompt / persona" }, "max_tokens": { "type": "integer", "description": "(default: 1024)" } } }, "output": { "type": "object", "description": "JSON response" } }, "ocr-extract": { "input": { "type": "http", "method": "POST", "bodyFields": { "image_url": { "type": "string", "description": "Public URL of the image" }, "image_base64": { "type": "string", "description": "Base64-encoded image (alternative to image_url)" } } }, "output": { "type": "object", "description": "JSON response" } }, "browser-task": { "input": { "type": "http", "method": "POST", "bodyFields": { "url": { "type": "string", "description": "Starting URL for the browser session", "required": true }, "steps": { "type": "array", "description": "Sequence of browser actions to execute", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "extract-pdf": { "input": { "type": "http", "method": "POST", "bodyFields": { "pdf_url": { "type": "string", "description": "Public URL of the PDF" }, "pdf_base64": { "type": "string", "description": "Base64-encoded PDF (alternative to pdf_url)" } } }, "output": { "type": "object", "description": "JSON response" } }, "screenshot-capture": { "input": { "type": "http", "method": "POST", "bodyFields": { "url": { "type": "string", "description": "URL to screenshot", "required": true }, "width": { "type": "integer", "description": "Viewport width in pixels (default: 1280)" }, "height": { "type": "integer", "description": "Viewport height in pixels (default: 800)" }, "full_page": { "type": "boolean", "description": "Capture full scrollable page (default: False)" }, "format": { "type": "string", "enum": ["png", "jpeg"], "description": "(default: png)" } } }, "output": { "type": "object", "description": "JSON response" } }, "html-to-markdown": { "input": { "type": "http", "method": "POST", "bodyFields": { "html": { "type": "string", "description": "HTML content to convert", "required": true }, "url": { "type": "string", "description": "URL to fetch and convert (alternative to html)" } } }, "output": { "type": "object", "description": "JSON response" } }, "url-shorten": { "input": { "type": "http", "method": "POST", "bodyFields": { "url": { "type": "string", "description": "Long URL to shorten", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "webhook-send": { "input": { "type": "http", "method": "POST", "bodyFields": { "webhook_url": { "type": "string", "description": "The webhook endpoint URL to POST to", "required": true }, "payload": { "type": "object", "description": "JSON body to send in the POST request", "required": true }, "headers": { "type": "object", "description": "Optional custom headers to include" }, "method": { "type": "string", "enum": ["GET", "POST", "PUT", "PATCH", "DELETE"], "description": "(default: POST)" } } }, "output": { "type": "object", "description": "JSON response" } }, "jsonpath-query": { "input": { "type": "http", "method": "POST", "bodyFields": { "data": { "type": "object", "description": "The JSON object to query", "required": true }, "path": { "type": "string", "description": "JSONPath expression, e.g. $.store.book[*].title", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "image-generate": { "input": { "type": "http", "method": "POST", "bodyFields": { "prompt": { "type": "string", "description": "Image description / prompt", "required": true }, "size": { "type": "string", "enum": ["1024x1024", "1792x1024", "1024x1792"], "description": "(default: 1024x1024)" }, "style": { "type": "string", "enum": ["vivid", "natural"], "description": "(default: vivid)" } } }, "output": { "type": "object", "description": "JSON response" } }, "barcode-generate": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text or number to encode", "required": true }, "format": { "type": "string", "description": "Barcode format (default: CODE128)", "enum": ["CODE128", "EAN13", "UPC", "CODE39", "ITF14"] }, "width": { "type": "integer", "description": "Bar width (default: 2)" }, "height": { "type": "integer", "description": "Bar height in pixels (default: 100)" } } }, "output": { "type": "object", "description": "JSON response" } }, "workflow-agent": { "input": { "type": "http", "method": "POST", "bodyFields": { "goal": { "type": "string", "description": "High-level goal for the workflow agent", "required": true }, "tools": { "type": "array", "description": "List of tool names the agent can use" }, "max_steps": { "type": "integer", "description": "Maximum number of steps the agent can take (default: 5)" } } }, "output": { "type": "object", "description": "JSON response" } }, "crypto-price": { "input": { "type": "http", "method": "POST", "bodyFields": { "symbol": { "type": "string", "description": "CoinGecko coin ID (e.g. bitcoin, ethereum, solana)", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "crypto-ohlcv": { "input": { "type": "http", "method": "POST", "bodyFields": { "symbol": { "type": "string", "description": "CoinGecko coin ID (e.g. bitcoin, ethereum)", "required": true }, "days": { "type": "integer", "description": "Number of days of OHLCV data (1, 7, 14, 30, 90, 180, 365) (default: 7)" } } }, "output": { "type": "object", "description": "JSON response" } }, "crypto-market-cap": { "input": { "type": "http", "method": "POST", "bodyFields": { "limit": { "type": "integer", "description": "Number of top coins to return (default: 10)" }, "currency": { "type": "string", "description": "Fiat currency for prices (default: usd)" } } }, "output": { "type": "object", "description": "JSON response" } }, "crypto-fear-greed": { "input": { "type": "http", "method": "POST", "bodyFields": { "limit": { "type": "integer", "description": "Number of historical entries (1 = current) (default: 1)" } } }, "output": { "type": "object", "description": "JSON response" } }, "crypto-sentiment": { "input": { "type": "http", "method": "POST", "bodyFields": { "symbol": { "type": "string", "description": "CoinGecko coin ID (e.g. bitcoin, ethereum)", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "crypto-news": { "input": { "type": "http", "method": "POST", "bodyFields": { "symbol": { "type": "string", "description": "Filter by coin symbol (e.g. BTC, ETH)" }, "limit": { "type": "integer", "description": "(default: 10)" } } }, "output": { "type": "object", "description": "JSON response" } }, "token-lookup": { "input": { "type": "http", "method": "POST", "bodyFields": { "query": { "type": "string", "description": "Token name or ticker to search (e.g. bitcoin, BTC, solana)", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "ai-oracle": { "input": { "type": "http", "method": "POST", "bodyFields": { "question": { "type": "string", "description": "Question or topic to analyze", "required": true }, "context": { "type": "string", "description": "Additional context for the analysis" }, "depth": { "type": "string", "description": "Analysis depth level (default: standard)", "enum": ["quick", "standard", "deep"] } } }, "output": { "type": "object", "description": "JSON response" } }, "session-create": { "input": { "type": "http", "method": "POST", "bodyFields": { "system": { "type": "string", "description": "System prompt for the session" }, "model": { "type": "string", "description": "AI model to use (default: claude)", "enum": ["claude", "gpt4", "grok", "gemini"] }, "ttl": { "type": "integer", "description": "Session time-to-live in seconds (default: 3600)" } } }, "output": { "type": "object", "description": "JSON response" } }, "session-message": { "input": { "type": "http", "method": "POST", "bodyFields": { "session_id": { "type": "string", "description": "Session ID from session-create", "required": true }, "message": { "type": "string", "description": "User message to send", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "text-to-speech": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Text to convert (max 5,000 chars)", "required": true }, "voice_id": { "type": "string", "description": "ElevenLabs voice ID (default: EXAVITQu4vr4xnSDxMaL)" }, "model_id": { "type": "string", "description": "ElevenLabs model ID (default: eleven_turbo_v2_5)" }, "stability": { "type": "number", "description": "Voice stability 0-1 (default: 0.42)" }, "similarity_boost": { "type": "number", "description": "Voice similarity boost 0-1 (default: 0.82)" } } }, "output": { "type": "object", "description": "JSON response" } }, "transcribe-audio": { "input": { "type": "http", "method": "POST", "bodyFields": { "audio_url": { "type": "string", "description": "Public URL of the audio file (MP3, WAV, M4A, OGG)", "required": true }, "language": { "type": "string", "description": "ISO-639-1 language code (auto-detected if omitted)" }, "prompt": { "type": "string", "description": "Context hint for better accuracy" } } }, "output": { "type": "object", "description": "JSON response" } }, "email-send": { "input": { "type": "http", "method": "POST", "bodyFields": { "to": { "type": "string", "description": "Recipient email address", "required": true }, "subject": { "type": "string", "description": "Email subject line", "required": true }, "body": { "type": "string", "description": "Plain text email body", "required": true }, "html": { "type": "string", "description": "HTML email body (alternative to body)" }, "from": { "type": "string", "description": "Sender (default: no-reply@archtools.dev)" } } }, "output": { "type": "object", "description": "JSON response" } }, "design-create": { "input": { "type": "http", "method": "POST", "bodyFields": { "prompt": { "type": "string", "description": "Image description", "required": true }, "size": { "type": "string", "enum": ["1024x1024", "1792x1024", "1024x1792"], "description": "(default: 1024x1024)" }, "quality": { "type": "string", "enum": ["standard", "hd"], "description": "(default: standard)" }, "style": { "type": "string", "enum": ["vivid", "natural"], "description": "(default: vivid)" } } }, "output": { "type": "object", "description": "JSON response" } }, "domain-check": { "input": { "type": "http", "method": "POST", "bodyFields": { "domain": { "type": "string", "description": "Domain name (e.g. example.com)", "required": true } } }, "output": { "type": "object", "description": "JSON response" } }, "news-search": { "input": { "type": "http", "method": "POST", "bodyFields": { "query": { "type": "string", "description": "News search query", "required": true }, "limit": { "type": "integer", "description": "Maximum number of articles to return (default: 10)" }, "language": { "type": "string", "description": "ISO-639-1 language code (default: en)" } } }, "output": { "type": "object", "description": "JSON response" } }, "research-report": { "input": { "type": "http", "method": "POST", "bodyFields": { "topic": { "type": "string", "description": "Research topic or question", "required": true }, "depth": { "type": "string", "description": "Report depth level (default: standard)", "enum": ["brief", "standard", "comprehensive"] }, "format": { "type": "string", "enum": ["markdown", "json"], "description": "(default: markdown)" } } }, "output": { "type": "object", "description": "JSON response" } }, "fact-check": { "input": { "type": "http", "method": "POST", "bodyFields": { "claim": { "type": "string", "description": "The claim or statement to verify", "required": true }, "context": { "type": "string", "description": "Additional context about the claim" } } }, "output": { "type": "object", "description": "JSON response" } }, "video-generate": { "input": { "type": "http", "method": "POST", "bodyFields": { "prompt": { "type": "string", "description": "Text description of the video to generate", "required": true }, "duration": { "type": "integer", "description": "Video duration in seconds (4 or 10) (default: 4)" } } }, "output": { "type": "object", "description": "JSON response" } }, "image-remove-bg": { "input": { "type": "http", "method": "POST", "bodyFields": { "image_url": { "type": "string", "description": "Public URL of the image" }, "image_base64": { "type": "string", "description": "Base64-encoded image (alternative to image_url)" }, "size": { "type": "string", "description": "Output size (default: auto)", "enum": ["preview", "full", "auto"] } } }, "output": { "type": "object", "description": "JSON response" } }, "email-find": { "input": { "type": "http", "method": "POST", "bodyFields": { "domain": { "type": "string", "description": "Company domain (e.g. google.com)", "required": true }, "first_name": { "type": "string", "description": "Person's first name" }, "last_name": { "type": "string", "description": "Person's last name" } } }, "output": { "type": "object", "description": "JSON response" } }, "semantic-search": { "input": { "type": "http", "method": "POST", "bodyFields": { "query": { "type": "string", "description": "Natural language search query", "required": true }, "num_results": { "type": "integer", "description": "Number of results to return (default: 10)" }, "include_text": { "type": "boolean", "description": "Include full page text in results (default: True)" } } }, "output": { "type": "object", "description": "JSON response" } }, "social-post": { "input": { "type": "http", "method": "POST", "bodyFields": { "text": { "type": "string", "description": "Tweet text (max 280 characters)", "required": true }, "reply_to": { "type": "string", "description": "Tweet ID to reply to" } } }, "output": { "type": "object", "description": "JSON response" } } };
// USDC contract addresses by network (native USDC, not bridged)
const USDC_CONTRACTS = {
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "base-sepolia": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    avalanche: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    unichain: "0x078D782b760474a361dDA0AF3839290b0EF57AD6",
    monad: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603",
};
// Solana USDC mint address (native USDC on Solana mainnet)
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
// USDT contract addresses by network (Tether)
const USDT_CONTRACTS = {
    ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    arbitrum: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    optimism: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    avalanche: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7",
    base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
};
// Aptos native USDC token address (Circle native, launched Jan 2025)
const APTOS_USDC_ADDRESS = "0xbae207659db88bea0cbead6da0ed00aac12edcdda169e591cd41c94180b46f3b";
// Per-tool pricing in USDC (string to avoid float issues)
export const X402_PRICES = {
    "validate-data": "0.001",
    "generate-hash": "0.001",
    "qr-code": "0.002",
    "convert-format": "0.002",
    "transform-text": "0.003",
    "extract-metadata": "0.003",
    "web-scrape": "0.005",
    "extract-page": "0.005",
    "search-web": "0.005",
    "rss-parse": "0.004",
    "ip-lookup": "0.002",
    "whois-lookup": "0.003",
    "email-verify": "0.003",
    "phone-validate": "0.002",
    "currency-convert": "0.002",
    "timezone-convert": "0.001",
    "generate-uuid": "0.001",
    "diff-text": "0.002",
    "readability-score": "0.002",
    "language-detect": "0.003",
    "sentiment-analysis": "0.008",
    "summarize": "0.010",
    "extract-entities": "0.008",
    "regex-generate": "0.008",
    "pii-detect": "0.010",
    "web-search": "0.010",
    "ai-generate": "0.020",
    "ocr-extract": "0.010",
    "browser-task": "0.010",
    "extract-pdf": "0.006",
    "screenshot-capture": "0.010",
    "html-to-markdown": "0.003",
    "url-shorten": "0.001",
    "webhook-send": "0.002",
    "jsonpath-query": "0.001",
    "image-generate": "0.030",
    "barcode-generate": "0.002",
    "workflow-agent": "0.025",
    "crypto-price": "0.001",
    "crypto-ohlcv": "0.002",
    "crypto-market-cap": "0.001",
    "crypto-fear-greed": "0.001",
    "crypto-sentiment": "0.002",
    "crypto-news": "0.002",
    "token-lookup": "0.001",
    "ai-oracle": "0.025",
    "session-create": "0.005",
    "session-message": "0.020",
    "text-to-speech": "0.010",
    "transcribe-audio": "0.012",
    "email-send": "0.003",
    "design-create": "0.030",
    "domain-check": "0.002",
    "news-search": "0.003",
    "research-report": "0.015",
    "fact-check": "0.010",
    "video-generate": "0.100",
    "image-remove-bg": "0.010",
    "email-find": "0.005",
    "semantic-search": "0.008",
    "social-post": "0.005",
};
function buildPaymentRequired(toolName, price) {
    const network = config.x402.network;
    const chainId = network === "base" ? "eip155:8453" : "eip155:84532";
    const usdcContract = USDC_CONTRACTS[network] ?? USDC_CONTRACTS["base"];
    // Convert price to USDC atomic units (6 decimals)
    const amountAtomic = Math.round(parseFloat(price) * 1_000_000).toString();
    const resource = `${process.env.PUBLIC_SITE_URL ?? "https://archtools.dev"}/v1/tools/${toolName}`;
    const evmWallet = config.x402.walletAddress;
    const accepts = [];
    // Option 1: USDC on Coinbase Base (EVM L2 — fast, cheap)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: chainId,
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Base)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["base"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 2: DISABLED — Brad's wallet is Base-only. Do NOT send to other networks.
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:1",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Ethereum)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["ethereum"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 3: USDC on Arbitrum (same EVM wallet, fast + cheap L2)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:42161",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Arbitrum)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["arbitrum"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 4: USDC on Polygon (same EVM wallet)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:137",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Polygon)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["polygon"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 5: USDC on Optimism (same EVM wallet)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:10",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Optimism)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["optimism"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 6: USDC on Avalanche C-Chain (same EVM wallet)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:43114",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Avalanche)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["avalanche"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 7: USDC on Solana
    const solanaWallet = process.env.SOLANA_WALLET_ADDRESS;
    if (solanaWallet) {
        accepts.push({
            scheme: "exact",
            network: "solana:mainnet",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Solana)`,
            mimeType: "application/json",
            payTo: solanaWallet,
            maxTimeoutSeconds: 60,
            asset: SOLANA_USDC_MINT,
            extra: { name: "USD Coin", version: "spl" },
        });
    }
    // Option 8: USDC on Noble (Cosmos native USDC issuance chain — IBC to 50+ Cosmos chains)
    const nobleWallet = process.env.NOBLE_WALLET_ADDRESS;
    if (nobleWallet) {
        accepts.push({
            scheme: "exact",
            network: "cosmos:noble-1",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Noble/Cosmos)`,
            mimeType: "application/json",
            payTo: nobleWallet,
            maxTimeoutSeconds: 60,
            asset: "uusdc",
            extra: { name: "USD Coin", version: "cosmos-ibc" },
        });
    }
    // Option 9: USDC on Algorand (ASA ID 31566704, native Circle USDC)
    const algorandWallet = process.env.ALGORAND_WALLET_ADDRESS;
    if (algorandWallet) {
        accepts.push({
            scheme: "exact",
            network: "algorand:mainnet",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Algorand)`,
            mimeType: "application/json",
            payTo: algorandWallet,
            maxTimeoutSeconds: 60,
            asset: "31566704",
            extra: { name: "USD Coin", version: "asa" },
        });
    }
    // Option 10: USDC on Stellar (native USDC, 17-sec settlement — MEMO REQUIRED for Coinbase)
    const stellarWallet = process.env.STELLAR_WALLET_ADDRESS;
    const stellarMemo = process.env.STELLAR_WALLET_MEMO;
    if (stellarWallet) {
        accepts.push({
            scheme: "exact",
            network: "stellar:pubnet",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Stellar)`,
            mimeType: "application/json",
            payTo: stellarWallet,
            maxTimeoutSeconds: 60,
            asset: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
            extra: { name: "USD Coin", version: "stellar", memo: stellarMemo ?? "" },
        });
    }
    // Option 11: USDC on Sui (Move-based L1, native USDC via Circle CCTP)
    const suiWallet = process.env.SUI_WALLET_ADDRESS;
    if (suiWallet) {
        accepts.push({
            scheme: "exact",
            network: "sui:mainnet",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Sui)`,
            mimeType: "application/json",
            payTo: suiWallet,
            maxTimeoutSeconds: 60,
            asset: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC",
            extra: { name: "USD Coin", version: "sui-move" },
        });
    }
    // Option 12: USDC on Unichain (Uniswap's OP-Stack L2, chain ID 130, native USDC)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:130",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Unichain)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["unichain"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 13: USDC on Monad (EVM-compatible high-perf L1, chain ID 143)
    if (evmWallet) {
        accepts.push({
            scheme: "exact",
            network: "eip155:143",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Monad)`,
            mimeType: "application/json",
            payTo: evmWallet,
            maxTimeoutSeconds: 60,
            asset: USDC_CONTRACTS["monad"],
            extra: { name: "USD Coin", version: "2" },
        });
    }
    // Option 14: USDC on Polkadot Asset Hub (asset ID 1337, Circle native USDC, XCM to all parachains)
    const polkadotWallet = process.env.POLKADOT_WALLET_ADDRESS;
    if (polkadotWallet) {
        accepts.push({
            scheme: "exact",
            network: "polkadot:asset-hub",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Polkadot)`,
            mimeType: "application/json",
            payTo: polkadotWallet,
            maxTimeoutSeconds: 120,
            asset: "1337",
            extra: { name: "USD Coin", version: "asset-hub" },
        });
    }
    // Option 15: USDC on Aptos (Move-based L1, native USDC since Jan 2025)
    const aptosWallet = process.env.APTOS_WALLET_ADDRESS;
    if (aptosWallet) {
        accepts.push({
            scheme: "exact",
            network: "aptos:mainnet",
            amount: amountAtomic,
            maxAmountRequired: amountAtomic,
            resource,
            description: `Arch Tools — ${toolName} (USDC on Aptos)`,
            mimeType: "application/json",
            payTo: aptosWallet,
            maxTimeoutSeconds: 60,
            asset: APTOS_USDC_ADDRESS,
            extra: { name: "USD Coin", version: "aptos-fa" },
        });
    }
    // Native ETH — agents holding ETH can pay directly (fixed pricing per tier)
    const ethWallet = process.env.ETH_WALLET_ADDRESS;
    if (ethWallet) {
        // ETH pricing tiers (in wei, ~$2500/ETH): basic=0.0000004, mid=0.000004, heavy=0.000008
        const ethPriceFloat = parseFloat(price);
        let ethWei;
        if (ethPriceFloat <= 0.002)
            ethWei = "400000000000"; // ~$0.001
        else if (ethPriceFloat <= 0.005)
            ethWei = "800000000000"; // ~$0.002
        else if (ethPriceFloat <= 0.010)
            ethWei = "2000000000000"; // ~$0.005
        else if (ethPriceFloat <= 0.020)
            ethWei = "4000000000000"; // ~$0.010
        else
            ethWei = "8000000000000"; // ~$0.020
        // ETH on Ethereum mainnet
        accepts.push({
            scheme: "exact",
            network: "eip155:1",
            amount: ethWei,
            maxAmountRequired: ethWei,
            resource,
            description: `Arch Tools — ${toolName} (native ETH on Ethereum)`,
            mimeType: "application/json",
            payTo: ethWallet,
            maxTimeoutSeconds: 300,
            asset: "0x0000000000000000000000000000000000000000",
            extra: { name: "Ether", version: "native" },
        });
        // ETH on Base (same wallet, faster + cheaper)
        accepts.push({
            scheme: "exact",
            network: "eip155:8453",
            amount: ethWei,
            maxAmountRequired: ethWei,
            resource,
            description: `Arch Tools — ${toolName} (native ETH on Base)`,
            mimeType: "application/json",
            payTo: ethWallet,
            maxTimeoutSeconds: 60,
            asset: "0x0000000000000000000000000000000000000000",
            extra: { name: "Ether", version: "native-base" },
        });
    }
    // Native BNB on BNB Smart Chain (chain ID 56)
    const bnbWallet = process.env.BNB_WALLET_ADDRESS;
    if (bnbWallet) {
        const bnbPriceFloat = parseFloat(price);
        let bnbWei;
        if (bnbPriceFloat <= 0.002)
            bnbWei = "1600000000000"; // ~$0.001 at ~$600/BNB
        else if (bnbPriceFloat <= 0.005)
            bnbWei = "3200000000000";
        else if (bnbPriceFloat <= 0.010)
            bnbWei = "8000000000000";
        else if (bnbPriceFloat <= 0.020)
            bnbWei = "16000000000000";
        else
            bnbWei = "32000000000000";
        accepts.push({
            scheme: "exact",
            network: "eip155:56",
            amount: bnbWei,
            maxAmountRequired: bnbWei,
            resource,
            description: `Arch Tools — ${toolName} (native BNB on BNB Chain)`,
            mimeType: "application/json",
            payTo: bnbWallet,
            maxTimeoutSeconds: 60,
            asset: "0x0000000000000000000000000000000000000000",
            extra: { name: "BNB", version: "native" },
        });
    }
    // Native NEAR on NEAR Protocol — #1 AI-agent blockchain, 24 decimals (yoctoNEAR), ~$4/NEAR
    const nearWallet = process.env.NEAR_WALLET_ADDRESS;
    if (nearWallet) {
        const nearPriceFloat = parseFloat(price);
        let yoctoNear;
        if (nearPriceFloat <= 0.002)
            yoctoNear = "250000000000000000000"; // 0.00025 NEAR ~$0.001
        else if (nearPriceFloat <= 0.005)
            yoctoNear = "750000000000000000000";
        else if (nearPriceFloat <= 0.010)
            yoctoNear = "1500000000000000000000";
        else if (nearPriceFloat <= 0.020)
            yoctoNear = "3000000000000000000000";
        else
            yoctoNear = "6000000000000000000000";
        accepts.push({
            scheme: "exact",
            network: "near:mainnet",
            amount: yoctoNear,
            maxAmountRequired: yoctoNear,
            resource,
            description: `Arch Tools — ${toolName} (NEAR token)`,
            mimeType: "application/json",
            payTo: nearWallet,
            maxTimeoutSeconds: 120,
            asset: "near",
            extra: { name: "NEAR Protocol", version: "native", decimals: "24" },
        });
    }
    // Native SOL on Solana mainnet (~$150/SOL, 9 decimals / lamports)
    const solNativeWallet = process.env.SOL_NATIVE_WALLET_ADDRESS;
    if (solNativeWallet) {
        const solPriceFloat = parseFloat(price);
        let lamports;
        if (solPriceFloat <= 0.002)
            lamports = "7000"; // ~0.000007 SOL ~$0.001
        else if (solPriceFloat <= 0.005)
            lamports = "17000";
        else if (solPriceFloat <= 0.010)
            lamports = "35000";
        else if (solPriceFloat <= 0.020)
            lamports = "70000";
        else
            lamports = "140000";
        accepts.push({
            scheme: "exact",
            network: "solana:mainnet",
            amount: lamports,
            maxAmountRequired: lamports,
            resource,
            description: `Arch Tools — ${toolName} (native SOL)`,
            mimeType: "application/json",
            payTo: solNativeWallet,
            maxTimeoutSeconds: 60,
            asset: "native",
            extra: { name: "Solana", version: "native", decimals: "9" },
        });
    }
    // uSOL (bridged SOL on Base via Coinbase/CCIP, ERC-20, 9 decimals, ~$150/SOL)
    const solBaseWallet = process.env.SOL_BASE_WALLET_ADDRESS;
    if (solBaseWallet) {
        const solPriceFloat = parseFloat(price);
        let solAtomic;
        if (solPriceFloat <= 0.002)
            solAtomic = "7000"; // 0.000007 SOL ~$0.001
        else if (solPriceFloat <= 0.005)
            solAtomic = "17000";
        else if (solPriceFloat <= 0.010)
            solAtomic = "35000";
        else if (solPriceFloat <= 0.020)
            solAtomic = "70000";
        else
            solAtomic = "140000";
        accepts.push({
            scheme: "exact",
            network: "eip155:8453",
            amount: solAtomic,
            maxAmountRequired: solAtomic,
            resource,
            description: `Arch Tools — ${toolName} (SOL on Base)`,
            mimeType: "application/json",
            payTo: solBaseWallet,
            maxTimeoutSeconds: 60,
            asset: "0x311935cd80b76769bf2ecc9d8ab7635b2139cf82",
            extra: { name: "Solana (Base)", version: "usol-erc20", decimals: "9" },
        });
    }
    // TAO (Bittensor) — AI-native blockchain, 9 decimals (Rao), ~$400/TAO
    const taoWallet = process.env.TAO_WALLET_ADDRESS;
    if (taoWallet) {
        const taoPriceFloat = parseFloat(price);
        let taoRao;
        if (taoPriceFloat <= 0.002)
            taoRao = "2500"; // 0.0000025 TAO ~$0.001
        else if (taoPriceFloat <= 0.005)
            taoRao = "6250";
        else if (taoPriceFloat <= 0.010)
            taoRao = "12500";
        else if (taoPriceFloat <= 0.020)
            taoRao = "25000";
        else
            taoRao = "62500";
        accepts.push({
            scheme: "exact",
            network: "bittensor:finney",
            amount: taoRao,
            maxAmountRequired: taoRao,
            resource,
            description: `Arch Tools — ${toolName} (TAO on Bittensor)`,
            mimeType: "application/json",
            payTo: taoWallet,
            maxTimeoutSeconds: 120,
            asset: "TAO",
            extra: { name: "Bittensor", version: "native", decimals: "9" },
        });
    }
    // UNI (Uniswap governance token) on Ethereum — ~$10/UNI, 18 decimals
    const uniWallet = process.env.UNI_WALLET_ADDRESS;
    if (uniWallet) {
        const uniPriceFloat = parseFloat(price);
        let uniAtomic;
        if (uniPriceFloat <= 0.002)
            uniAtomic = "100000000000000"; // 0.0001 UNI ~$0.001
        else if (uniPriceFloat <= 0.005)
            uniAtomic = "300000000000000";
        else if (uniPriceFloat <= 0.010)
            uniAtomic = "700000000000000";
        else if (uniPriceFloat <= 0.020)
            uniAtomic = "1400000000000000";
        else
            uniAtomic = "2500000000000000";
        accepts.push({
            scheme: "exact",
            network: "eip155:1",
            amount: uniAtomic,
            maxAmountRequired: uniAtomic,
            resource,
            description: `Arch Tools — ${toolName} (UNI on Ethereum)`,
            mimeType: "application/json",
            payTo: uniWallet,
            maxTimeoutSeconds: 60,
            asset: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
            extra: { name: "Uniswap", version: "erc20" },
        });
    }
    // USDT options — Tether (higher market cap than USDC, widely held by trading agents)
    const usdtWallet = process.env.USDT_ETH_WALLET_ADDRESS;
    if (usdtWallet) {
        const usdtNetworks = [
            { network: "eip155:1", chain: "ethereum" },
            { network: "eip155:42161", chain: "arbitrum" },
            { network: "eip155:137", chain: "polygon" },
            { network: "eip155:10", chain: "optimism" },
            { network: "eip155:43114", chain: "avalanche" },
            { network: "eip155:8453", chain: "base" },
        ];
        for (const { network, chain } of usdtNetworks) {
            if (USDT_CONTRACTS[chain]) {
                accepts.push({
                    scheme: "exact",
                    network,
                    amount: amountAtomic,
                    maxAmountRequired: amountAtomic,
                    resource,
                    description: `Arch Tools — ${toolName} (USDT on ${chain.charAt(0).toUpperCase() + chain.slice(1)})`,
                    mimeType: "application/json",
                    payTo: usdtWallet,
                    maxTimeoutSeconds: 60,
                    asset: USDT_CONTRACTS[chain],
                    extra: { name: "Tether USD", version: "2" },
                });
            }
        }
    }
    // Add outputSchema to each accept entry for x402scan compatibility
    const toolSchema = TOOL_OUTPUT_SCHEMAS[toolName];
    if (toolSchema) {
        for (const accept of accepts) {
            accept.outputSchema = toolSchema;
        }
    }
    // x402scan network whitelist — only these pass validation.
    // Named networks + eip155:* with known ChainIdToNetwork mapping in coinbase/x402.
    // See: Merit-Systems/x402scan/apps/scan/src/lib/x402/v1/schema.ts
    const X402SCAN_VALID_NETWORKS = new Set([
        "base", "base-sepolia", "eip155:8453", "eip155:84532",
        "avalanche", "avalanche-fuji", "eip155:43114", "eip155:43113",
        "polygon", "polygon-amoy", "eip155:137", "eip155:80002",
        "solana", "solana-devnet",
        "sei", "sei-testnet", "eip155:1329", "eip155:1328",
        "iotex", "eip155:4689",
        "abstract", "abstract-testnet", "eip155:2741", "eip155:11124",
        "peaq", "eip155:3338",
        "story", "eip155:1514",
        "educhain", "eip155:41923",
    ]);
    // Filter to only x402scan-valid networks and normalize "solana:mainnet" → "solana"
    const filteredAccepts = accepts
        .map((a) => {
        if (a.network === "solana:mainnet")
            a.network = "solana";
        return a;
    })
        .filter((a) => X402SCAN_VALID_NETWORKS.has(a.network));
    return {
        x402Version: 1,
        resource: {
            url: resource,
            description: `Arch Tools — ${toolName}`,
            mimeType: "application/json",
        },
        accepts: filteredAccepts,
        error: "PAYMENT-REQUIRED",
    };
}
/**
 * Extract a nonce from the X-Payment header payload.
 * The x402 payment header is a base64-encoded JSON object. We extract the
 * `nonce` field (if present) for replay-attack prevention.
 */
function extractNonce(paymentHeader) {
    try {
        const decoded = Buffer.from(paymentHeader, "base64").toString("utf-8");
        const payload = JSON.parse(decoded);
        const nonce = payload["nonce"];
        if (typeof nonce === "string" && nonce.length > 0)
            return nonce;
        // Some implementations nest under payload.payload
        const inner = payload["payload"];
        if (inner && typeof inner === "object") {
            const innerNonce = inner["nonce"];
            if (typeof innerNonce === "string" && innerNonce.length > 0)
                return innerNonce;
        }
        return null;
    }
    catch {
        return null;
    }
}
const NONCE_TTL_SECONDS = 24 * 60 * 60; // 24 hours
/**
 * Check whether a nonce has been seen before (replay attack detection).
 * Returns true if the nonce is NEW (safe to proceed), false if already used.
 * If Redis is unavailable, falls back to allowing the request (non-blocking).
 */
async function checkAndStoreNonce(nonce) {
    if (!redis) {
        console.warn("[x402] Redis not configured — nonce deduplication disabled. Set REDIS_URL to enable replay protection.");
        return true; // allow but warn
    }
    const key = `x402:nonce:${nonce}`;
    // SET key "1" NX EX <ttl> — atomic: set only if not exists, returns null if already exists
    const result = await redis.set(key, "1", "EX", NONCE_TTL_SECONDS, "NX");
    return result === "OK"; // "OK" = new nonce stored; null = already existed (replay)
}
async function verifyPayment(paymentHeader, toolName, paymentRequirements) {
    if (!config.x402.facilitatorUrl)
        return { isValid: false };
    try {
        // Decode the base64 payment header into a PaymentPayload object
        let paymentPayload;
        try {
            paymentPayload = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf-8"));
        }
        catch {
            // If not valid base64 JSON, wrap as raw payload
            paymentPayload = { raw: paymentHeader };
        }
        const res = await axios.post(`${config.x402.facilitatorUrl}/verify`, {
            x402Version: 1,
            paymentPayload,
            paymentRequirements,
        }, {
            timeout: 8000,
            headers: { "Content-Type": "application/json" },
        });
        return { isValid: res.data?.isValid === true, payer: res.data?.payer };
    }
    catch {
        return { isValid: false };
    }
}
async function settlePayment(paymentHeader, toolName, paymentRequirements) {
    if (!config.x402.facilitatorUrl)
        return null;
    try {
        // Decode the base64 payment header into a PaymentPayload object
        let paymentPayload;
        try {
            paymentPayload = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf-8"));
        }
        catch {
            paymentPayload = { raw: paymentHeader };
        }
        const res = await axios.post(`${config.x402.facilitatorUrl}/settle`, {
            x402Version: 1,
            paymentPayload,
            paymentRequirements,
        }, {
            timeout: 10000,
            headers: { "Content-Type": "application/json" },
        });
        return {
            transaction: res.data?.transaction ?? res.data?.txHash ?? undefined,
            network: res.data?.network ?? undefined,
            payer: res.data?.payer ?? undefined,
        };
    }
    catch {
        return null;
    }
}
/**
 * x402 middleware — attach to any tool route.
 * Checks for X-Payment header; if missing + no valid API key, returns 402.
 * If X-Payment present, verifies with facilitator and logs payment.
 */
export function x402Middleware(toolName) {
    return async (req, res, next) => {
        // If wallet address not configured, skip x402 (Stripe-only mode)
        if (!config.x402.walletAddress) {
            next();
            return;
        }
        // v2: check Payment-Signature (primary), fall back to X-Payment (legacy)
        const paymentHeader = (req.headers["payment-signature"] ?? req.headers["x-payment"]);
        // If the SDK already handled payment, skip custom middleware
        if (req.x402SdkPaid) {
            next();
            return;
        }
        // No payment header — check if they have a valid API key with credits
        if (!paymentHeader) {
            const authHeader = req.headers.authorization;
            const apiKey = req.headers["x-api-key"];
            if (authHeader?.startsWith("Bearer ") || apiKey) {
                // Let auth middleware handle it (API key or Bearer token)
                next();
                return;
            }
            // Return 402 Payment Required with proper headers per x402 spec
            const price = X402_PRICES[toolName] ?? "0.005";
            const paymentRequired = buildPaymentRequired(toolName, price);
            const paymentRequiredB64 = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
            res.status(402)
                .header("Content-Type", "application/json")
                .header("PAYMENT-REQUIRED", paymentRequiredB64)
                .header("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, Payment-Required, PAYMENT-SIGNATURE, Payment-Signature, PAYMENT-RESPONSE, Payment-Response, X-Payment, X-Payment-Response")
                .json(paymentRequired);
            return;
        }
        // Optional nonce-based replay protection (non-standard but useful).
        // Do NOT reject payments that omit a nonce — the spec doesn't require one.
        const nonce = extractNonce(paymentHeader);
        if (nonce) {
            const isNewNonce = await checkAndStoreNonce(nonce);
            if (!isNewNonce) {
                res.status(402).json({
                    ok: false,
                    error: "payment_replay_detected",
                    message: "x402 nonce has already been used. Each payment must have a unique nonce.",
                });
                return;
            }
        }
        // Build the payment requirements for verify/settle calls
        const price = X402_PRICES[toolName] ?? "0.005";
        const chainId = config.x402.network === "base" ? "eip155:8453" : "eip155:84532";
        const amountAtomic = Math.round(parseFloat(price) * 1_000_000).toString();
        const paymentRequirements = {
            scheme: "exact",
            network: chainId,
            asset: USDC_CONTRACTS["base"] ?? USDC_CONTRACTS[config.x402.network],
            amount: amountAtomic,
            payTo: config.x402.walletAddress,
            maxTimeoutSeconds: 60,
            extra: { name: "USD Coin", version: "2" },
        };
        // Payment header present — verify with facilitator using spec-compliant format
        const verifyResult = await verifyPayment(paymentHeader, toolName, paymentRequirements);
        if (!verifyResult.isValid) {
            // Clean up nonce on verification failure so agent can retry
            if (nonce && redis)
                await redis.del(`x402:nonce:${nonce}`).catch(() => { });
            res.status(402).json({
                ok: false,
                error: "payment_invalid",
                message: "x402 payment verification failed",
            });
            return;
        }
        // Settle payment using spec-compliant format
        const settleResult = await settlePayment(paymentHeader, toolName, paymentRequirements);
        // Log the x402 payment
        try {
            await prisma.x402Payment.create({
                data: {
                    toolName,
                    amountUsdc: price,
                    txHash: settleResult?.transaction ?? undefined,
                    network: config.x402.network,
                    status: "settled",
                },
            });
        }
        catch {
            // Non-fatal — don't block the request
        }
        // Mark request as x402-paid so tool handler can skip credit check
        req.x402Paid = true;
        // PAYMENT-RESPONSE header: Base64-encoded SettleResponse per x402 spec
        const settleResponse = {
            success: true,
            transaction: settleResult?.transaction ?? "",
            network: settleResult?.network ?? chainId,
            payer: settleResult?.payer ?? verifyResult.payer ?? "",
        };
        res.setHeader("PAYMENT-RESPONSE", Buffer.from(JSON.stringify(settleResponse)).toString("base64"));
        // Log x402 tool call to ApiRequest for admin stats visibility
        try {
            await prisma.apiRequest.create({
                data: {
                    agentId: "x402_anonymous",
                    toolName,
                    creditsUsed: 0,
                    status: "SUCCESS",
                    callerType: "x402",
                    callerName: "x402-payment",
                },
            });
        }
        catch {
            // Non-fatal
        }
        next();
    };
}
//# sourceMappingURL=x402.js.map