/**
 * Arch Tools AgentKit MCP Server
 * 
 * Exposes all 64 Arch Tools endpoints as MCP actions.
 * AI agents using Claude Desktop, Cursor, VS Code, Windsurf can install this
 * server and access all tools directly — payments via x402 or API key.
 * 
 * Install: npx @archtools/mcp
 * Config: Set ARCH_TOOLS_API_KEY env var for credit-based access
 */

import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolRequest,
} from "@modelcontextprotocol/sdk/types";

const ARCH_TOOLS_BASE_URL = process.env.ARCH_TOOLS_URL || "https://archtools.dev";
const ARCH_TOOLS_API_KEY = process.env.ARCH_TOOLS_API_KEY || "";

interface ArchTool {
  name: string;
  description: string;
  price: string;
  inputSchema: Record<string, any>;
}

const ARCH_TOOLS: ArchTool[] = [
  { name: "search-web", description: "AI-powered web search with source citations", price: "$0.015",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } }, required: ["query"] } },
  { name: "web-scrape", description: "Scrape webpage as markdown, HTML, or text", price: "$0.015",
    inputSchema: { type: "object", properties: { url: { type: "string" }, format: { type: "string", enum: ["markdown","html","text"] } }, required: ["url"] } },
  { name: "extract-page", description: "Extract main content from a webpage", price: "$0.015",
    inputSchema: { type: "object", properties: { url: { type: "string" }, include_links: { type: "boolean" } }, required: ["url"] } },
  { name: "ai-generate", description: "Generate text with Claude, GPT-4, Grok, or Gemini", price: "$0.040",
    inputSchema: { type: "object", properties: { prompt: { type: "string" }, model: { type: "string", enum: ["claude","gpt4","grok","gemini"] }, system: { type: "string" }, max_tokens: { type: "integer" } }, required: ["prompt"] } },
  { name: "summarize", description: "Summarize text (bullets, TLDR, executive, paragraph)", price: "$0.020",
    inputSchema: { type: "object", properties: { text: { type: "string" }, style: { type: "string", enum: ["bullets","tldr","executive","paragraph","headline"] } }, required: ["text"] } },
  { name: "extract-entities", description: "Extract named entities from text", price: "$0.015",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "sentiment-analysis", description: "Analyze sentiment and emotion in text", price: "$0.015",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "semantic-search", description: "Semantic web search with AI-ranked results", price: "$0.015",
    inputSchema: { type: "object", properties: { query: { type: "string" }, num_results: { type: "integer" }, include_text: { type: "boolean" } }, required: ["query"] } },
  { name: "research-report", description: "Generate comprehensive research report", price: "$0.040",
    inputSchema: { type: "object", properties: { topic: { type: "string" }, depth: { type: "string", enum: ["brief","standard","comprehensive"] }, format: { type: "string", enum: ["markdown","json"] } }, required: ["topic"] } },
  { name: "fact-check", description: "Verify a claim using multiple sources", price: "$0.025",
    inputSchema: { type: "object", properties: { claim: { type: "string" }, context: { type: "string" } }, required: ["claim"] } },
  { name: "news-search", description: "Search latest news articles", price: "$0.015",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" }, language: { type: "string" } }, required: ["query"] } },
  { name: "image-generate", description: "Generate images with DALL-E 3", price: "$0.050",
    inputSchema: { type: "object", properties: { prompt: { type: "string" }, size: { type: "string", enum: ["1024x1024","1792x1024","1024x1792"] }, style: { type: "string", enum: ["vivid","natural"] } }, required: ["prompt"] } },
  { name: "image-remove-bg", description: "Remove image background", price: "$0.350",
    inputSchema: { type: "object", properties: { image_url: { type: "string" }, image_base64: { type: "string" } } } },
  { name: "screenshot-capture", description: "Capture screenshot of any URL", price: "$0.020",
    inputSchema: { type: "object", properties: { url: { type: "string" }, full_page: { type: "boolean" }, format: { type: "string", enum: ["png","jpeg"] } }, required: ["url"] } },
  { name: "text-to-speech", description: "Convert text to speech with ElevenLabs", price: "$0.100",
    inputSchema: { type: "object", properties: { text: { type: "string" }, voice_id: { type: "string" } }, required: ["text"] } },
  { name: "transcribe-audio", description: "Transcribe audio with Whisper", price: "$0.025",
    inputSchema: { type: "object", properties: { audio_url: { type: "string" }, language: { type: "string" } }, required: ["audio_url"] } },
  { name: "extract-pdf", description: "Extract text from PDF", price: "$0.015",
    inputSchema: { type: "object", properties: { pdf_url: { type: "string" }, pdf_base64: { type: "string" } } } },
  { name: "ocr-extract", description: "Extract text from images (OCR)", price: "$0.020",
    inputSchema: { type: "object", properties: { image_url: { type: "string" }, image_base64: { type: "string" } } } },
  { name: "email-verify", description: "Verify email validity and deliverability", price: "$0.010",
    inputSchema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } },
  { name: "email-find", description: "Find email for person at company", price: "$0.015",
    inputSchema: { type: "object", properties: { domain: { type: "string" }, first_name: { type: "string" }, last_name: { type: "string" } }, required: ["domain"] } },
  { name: "email-send", description: "Send email via Resend", price: "$0.010",
    inputSchema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, html: { type: "string" } }, required: ["to","subject","body"] } },
  { name: "ip-lookup", description: "IP geolocation and ASN info", price: "$0.010",
    inputSchema: { type: "object", properties: { ip: { type: "string" } } } },
  { name: "whois-lookup", description: "WHOIS domain lookup", price: "$0.010",
    inputSchema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] } },
  { name: "domain-check", description: "Check domain availability and DNS", price: "$0.010",
    inputSchema: { type: "object", properties: { domain: { type: "string" } }, required: ["domain"] } },
  { name: "phone-validate", description: "Validate phone number", price: "$0.010",
    inputSchema: { type: "object", properties: { phone: { type: "string" }, country: { type: "string" } }, required: ["phone"] } },
  { name: "crypto-price", description: "Get cryptocurrency price", price: "$0.010",
    inputSchema: { type: "object", properties: { symbol: { type: "string", description: "CoinGecko ID e.g. bitcoin" } }, required: ["symbol"] } },
  { name: "crypto-market-cap", description: "Top cryptos by market cap", price: "$0.010",
    inputSchema: { type: "object", properties: { limit: { type: "integer" }, currency: { type: "string" } } } },
  { name: "crypto-ohlcv", description: "Crypto OHLCV price history", price: "$0.010",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, days: { type: "integer" } }, required: ["symbol"] } },
  { name: "crypto-fear-greed", description: "Crypto fear & greed index", price: "$0.010",
    inputSchema: { type: "object", properties: { limit: { type: "integer" } } } },
  { name: "crypto-news", description: "Latest crypto news", price: "$0.015",
    inputSchema: { type: "object", properties: { symbol: { type: "string" }, limit: { type: "integer" } } } },
  { name: "token-lookup", description: "Look up any token by name or ticker", price: "$0.010",
    inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
  { name: "currency-convert", description: "Currency conversion (fiat & crypto)", price: "$0.010",
    inputSchema: { type: "object", properties: { amount: { type: "number" }, from: { type: "string" }, to: { type: "string" } }, required: ["amount","from","to"] } },
  { name: "rss-parse", description: "Parse RSS or Atom feed", price: "$0.010",
    inputSchema: { type: "object", properties: { url: { type: "string" }, limit: { type: "integer" } }, required: ["url"] } },
  { name: "html-to-markdown", description: "Convert HTML to Markdown", price: "$0.010",
    inputSchema: { type: "object", properties: { html: { type: "string" }, url: { type: "string" } } } },
  { name: "transform-text", description: "Text case conversion (camelCase, snake_case, etc)", price: "$0.010",
    inputSchema: { type: "object", properties: { text: { type: "string" }, mode: { type: "string", enum: ["slug","camel","snake","pascal","kebab","upper","lower","title","base64_encode","base64_decode"] } }, required: ["text","mode"] } },
  { name: "extract-metadata", description: "Extract metadata from URL or text", price: "$0.010",
    inputSchema: { type: "object", properties: { url: { type: "string" }, text: { type: "string" } } } },
  { name: "regex-generate", description: "Generate regex from plain English", price: "$0.015",
    inputSchema: { type: "object", properties: { description: { type: "string" }, test_strings: { type: "array" } }, required: ["description"] } },
  { name: "language-detect", description: "Detect language of text", price: "$0.010",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "pii-detect", description: "Detect and redact PII", price: "$0.020",
    inputSchema: { type: "object", properties: { text: { type: "string" }, redact: { type: "boolean" } }, required: ["text"] } },
  { name: "validate-data", description: "Validate JSON against JSON Schema", price: "$0.010",
    inputSchema: { type: "object", properties: { data: { type: "string" }, schema: { type: "object" } }, required: ["data","schema"] } },
  { name: "generate-hash", description: "Generate SHA256/MD5/SHA512 hash", price: "$0.010",
    inputSchema: { type: "object", properties: { text: { type: "string" }, algorithm: { type: "string", enum: ["sha256","sha512","md5","sha1"] } }, required: ["text"] } },
  { name: "generate-uuid", description: "Generate UUID, token, or API key", price: "$0.010",
    inputSchema: { type: "object", properties: { type: { type: "string", enum: ["uuid","token","api-key"] }, count: { type: "integer" } } } },
  { name: "qr-code", description: "Generate QR code", price: "$0.010",
    inputSchema: { type: "object", properties: { text: { type: "string" }, size: { type: "integer" }, format: { type: "string", enum: ["png","svg"] } }, required: ["text"] } },
  { name: "barcode-generate", description: "Generate barcode (CODE128, EAN13, etc)", price: "$0.010",
    inputSchema: { type: "object", properties: { text: { type: "string" }, format: { type: "string", enum: ["CODE128","EAN13","UPC","CODE39","ITF14"] } }, required: ["text"] } },
  { name: "convert-format", description: "Convert JSON/YAML/CSV/XML/TOML", price: "$0.010",
    inputSchema: { type: "object", properties: { input: { type: "string" }, from: { type: "string", enum: ["json","yaml","csv","xml","toml"] }, to: { type: "string", enum: ["json","yaml","csv","xml","toml"] } }, required: ["input","from","to"] } },
  { name: "diff-text", description: "Generate text diff", price: "$0.010",
    inputSchema: { type: "object", properties: { text1: { type: "string" }, text2: { type: "string" }, mode: { type: "string", enum: ["unified","words","chars","json"] } }, required: ["text1","text2"] } },
  { name: "readability-score", description: "Flesch-Kincaid readability score", price: "$0.010",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "timezone-convert", description: "Convert datetime between timezones", price: "$0.010",
    inputSchema: { type: "object", properties: { datetime: { type: "string" }, from_tz: { type: "string" }, to_tz: { type: "string" } }, required: ["datetime","from_tz","to_tz"] } },
  { name: "jsonpath-query", description: "Query JSON with JSONPath", price: "$0.010",
    inputSchema: { type: "object", properties: { data: { type: "object" }, path: { type: "string" } }, required: ["data","path"] } },
  { name: "webhook-send", description: "POST webhook to any endpoint", price: "$0.010",
    inputSchema: { type: "object", properties: { webhook_url: { type: "string" }, payload: { type: "object" }, headers: { type: "object" }, method: { type: "string", enum: ["GET","POST","PUT","PATCH","DELETE"] } }, required: ["webhook_url","payload"] } },
  { name: "url-shorten", description: "Shorten a URL", price: "$0.010",
    inputSchema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] } },
  { name: "workflow-agent", description: "Multi-step AI agent chaining tools autonomously", price: "$0.100",
    inputSchema: { type: "object", properties: { goal: { type: "string" }, tools: { type: "array" }, max_steps: { type: "integer" } }, required: ["goal"] } },
  { name: "ai-oracle", description: "Deep AI analysis (quick/standard/deep modes)", price: "$0.050",
    inputSchema: { type: "object", properties: { question: { type: "string" }, context: { type: "string" }, depth: { type: "string", enum: ["quick","standard","deep"] } }, required: ["question"] } },
];

async function callArchTool(toolName: string, args: Record<string, any>): Promise<string> {
  const url = `${ARCH_TOOLS_BASE_URL}/v1/tools/${toolName}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (ARCH_TOOLS_API_KEY) headers["X-API-Key"] = ARCH_TOOLS_API_KEY;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });

  if (response.status === 402) {
    const payment = await response.json() as any;
    return JSON.stringify({
      error: "payment_required",
      message: "Set ARCH_TOOLS_API_KEY env var or fund your wallet at https://archtools.dev/fund",
      price: payment?.accepts?.[0]?.price || "see archtools.dev/pricing",
      fund_url: "https://archtools.dev/fund",
      get_api_key: "https://archtools.dev/signup",
    });
  }

  if (!response.ok) {
    // Forward only the structured error/message fields — never the raw upstream
    // body — so unexpected response content can't leak to the client.
    const raw = await response.text().catch(() => "");
    let detail = `HTTP ${response.status}`;
    try {
      const j = JSON.parse(raw) as { message?: string; error?: string };
      detail = j.message || j.error || detail;
    } catch { /* non-JSON — keep generic */ }
    return JSON.stringify({ error: `HTTP ${response.status}`, message: String(detail).slice(0, 300) });
  }

  return JSON.stringify(await response.json(), null, 2);
}

const server = new Server(
  { name: "arch-tools", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: ARCH_TOOLS.map((t) => ({
    name: t.name,
    description: `${t.description} (${t.price}/call)`,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
  const { name, arguments: args } = request.params;
  const tool = ARCH_TOOLS.find((t) => t.name === name);

  if (!tool) {
    return { content: [{ type: "text", text: JSON.stringify({ error: "tool_not_found", tool: name }) }], isError: true };
  }

  try {
    const result = await callArchTool(name, args as Record<string, any>);
    return { content: [{ type: "text", text: result }] };
  } catch (err: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
