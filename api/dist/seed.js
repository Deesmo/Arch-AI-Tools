import { prisma } from "./db.js";
async function main() {
    const tools = [
        // ── Core 8 ──
        {
            name: "validate-data",
            endpoint: "/v1/tools/validate-data",
            credits: 1,
            description: "Validate JSON data against a JSON Schema",
            method: "POST",
            category: "data",
            schemaJson: {
                type: "object",
                properties: {
                    schema: { type: "object", description: "JSON Schema to validate against" },
                    data: { description: "Data to validate" },
                },
                required: ["schema", "data"],
            },
        },
        {
            name: "generate-hash",
            endpoint: "/v1/tools/generate-hash",
            credits: 1,
            description: "Generate cryptographic hashes (sha256, sha512, md5, sha1)",
            method: "POST",
            category: "security",
            schemaJson: {
                type: "object",
                properties: {
                    algorithm: { type: "string", enum: ["sha256", "sha512", "md5", "sha1"], default: "sha256" },
                    input: { type: "string", description: "String to hash" },
                },
                required: ["input"],
            },
        },
        {
            name: "qr-code",
            endpoint: "/v1/tools/qr-code",
            credits: 2,
            description: "Generate QR codes from text or URLs (PNG data URL or SVG)",
            method: "POST",
            category: "media",
            schemaJson: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text or URL to encode", maxLength: 4000 },
                    format: { type: "string", enum: ["dataurl", "svg"], default: "dataurl" },
                    width: { type: "integer", minimum: 100, maximum: 1000, default: 300 },
                    margin: { type: "integer", minimum: 0, maximum: 10, default: 2 },
                },
                required: ["text"],
            },
        },
        {
            name: "convert-format",
            endpoint: "/v1/tools/convert-format",
            credits: 2,
            description: "Convert data between JSON, YAML, CSV, and XML formats",
            method: "POST",
            category: "data",
            schemaJson: {
                type: "object",
                properties: {
                    from: { type: "string", enum: ["json", "yaml", "csv", "xml"] },
                    to: { type: "string", enum: ["json", "yaml", "csv", "xml"] },
                    data: { description: "Data to convert (string or object)" },
                },
                required: ["from", "to", "data"],
            },
        },
        {
            name: "transform-text",
            endpoint: "/v1/tools/transform-text",
            credits: 3,
            description: "Transform text: uppercase, lowercase, trim, reverse, slug, title, camel, snake, base64",
            method: "POST",
            category: "text",
            schemaJson: {
                type: "object",
                properties: {
                    mode: {
                        type: "string",
                        enum: ["uppercase", "lowercase", "trim", "reverse", "slug", "title", "camel", "snake", "base64_encode", "base64_decode"],
                        default: "uppercase",
                    },
                    text: { type: "string", description: "Text to transform" },
                },
                required: ["text"],
            },
        },
        {
            name: "extract-metadata",
            endpoint: "/v1/tools/extract-metadata",
            credits: 3,
            description: "Extract metadata from text or URLs (word count, OG tags, headers, etc.)",
            method: "POST",
            category: "data",
            schemaJson: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text to analyze" },
                    url: { type: "string", description: "URL to fetch and extract metadata from" },
                },
            },
        },
        {
            name: "web-scrape",
            endpoint: "/v1/tools/web-scrape",
            credits: 5,
            description: "Scrape and extract content from websites with optional CSS selector",
            method: "POST",
            category: "web",
            schemaJson: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL to scrape" },
                    selector: { type: "string", description: "Optional CSS selector to extract specific content" },
                    format: { type: "string", enum: ["text", "html"], default: "text" },
                },
                required: ["url"],
            },
        },
        {
            name: "ai-generate",
            endpoint: "/v1/tools/ai-generate",
            credits: 20,
            description: "AI-powered text generation using Claude (requires ANTHROPIC_API_KEY)",
            method: "POST",
            category: "ai",
            schemaJson: {
                type: "object",
                properties: {
                    prompt: { type: "string", description: "Generation prompt", maxLength: 10000 },
                    system: { type: "string", description: "Optional system prompt", maxLength: 2000 },
                    model: { type: "string", enum: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5-20251001"], default: "claude-sonnet-4-6" },
                    max_tokens: { type: "integer", minimum: 100, maximum: 4096, default: 1000 },
                },
                required: ["prompt"],
            },
        },
        // ── Web/Browser (v9-combined) ──
        {
            name: "search-web",
            endpoint: "/v1/tools/search-web",
            credits: 5,
            description: "Search the web and return structured results (Tavily/Serper or DuckDuckGo fallback)",
            method: "POST",
            category: "web",
            schemaJson: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query" },
                    limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
                },
                required: ["query"],
            },
        },
        {
            name: "extract-page",
            endpoint: "/v1/tools/extract-page",
            credits: 5,
            description: "Fetch a webpage and return clean text, metadata, and links",
            method: "POST",
            category: "web",
            schemaJson: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL to extract" },
                },
                required: ["url"],
            },
        },
        {
            name: "extract-pdf",
            endpoint: "/v1/tools/extract-pdf",
            credits: 6,
            description: "Extract text and tables from a PDF (requires PDF_EXTRACTOR_URL)",
            method: "POST",
            category: "files",
            schemaJson: {
                type: "object",
                properties: {
                    url: { type: "string", description: "Public PDF URL" },
                },
                required: ["url"],
            },
        },
        {
            name: "browser-task",
            endpoint: "/v1/tools/browser-task",
            credits: 10,
            description: "Headless browser automation (click/type/extract) via Playwright — SSRF hardened",
            method: "POST",
            category: "web",
            schemaJson: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL to open" },
                    action: { type: "string", enum: ["extract", "click", "type", "html"], default: "extract" },
                    selector: { type: "string", description: "CSS selector (required for click/type, optional for extract)" },
                    text: { type: "string", description: "Text for type action" },
                },
                required: ["url"],
            },
        },
        // ── Tier 1: High-demand ──
        {
            name: "ocr-extract",
            endpoint: "/v1/tools/ocr-extract",
            credits: 10,
            description: "Extract text from images or screenshots using AI vision (base64 or URL input)",
            method: "POST",
            category: "ai",
            schemaJson: {
                type: "object",
                properties: {
                    image_url: { type: "string", description: "Public URL of the image" },
                    image_base64: { type: "string", description: "Base64-encoded image data" },
                    media_type: { type: "string", enum: ["image/jpeg", "image/png", "image/gif", "image/webp"], default: "image/jpeg" },
                    prompt: { type: "string", description: "Optional custom extraction instruction", maxLength: 500 },
                },
            },
        },
        {
            name: "ip-lookup",
            endpoint: "/v1/tools/ip-lookup",
            credits: 2,
            description: "Geolocate any IP address — country, city, timezone, ISP, VPN/proxy detection",
            method: "POST",
            category: "network",
            schemaJson: {
                type: "object",
                properties: {
                    ip: { type: "string", description: "IPv4 or IPv6 address to look up" },
                },
                required: ["ip"],
            },
        },
        {
            name: "email-verify",
            endpoint: "/v1/tools/email-verify",
            credits: 3,
            description: "Deep email validation: syntax, MX record check, disposable domain detection",
            method: "POST",
            category: "validation",
            schemaJson: {
                type: "object",
                properties: {
                    email: { type: "string", description: "Email address to verify" },
                },
                required: ["email"],
            },
        },
        {
            name: "phone-validate",
            endpoint: "/v1/tools/phone-validate",
            credits: 2,
            description: "Parse and validate phone numbers in any format — E.164, carrier type, country",
            method: "POST",
            category: "validation",
            schemaJson: {
                type: "object",
                properties: {
                    phone: { type: "string", description: "Phone number in any format" },
                    country_code: { type: "string", description: "ISO 3166-1 alpha-2 country code hint (e.g. US)", maxLength: 2 },
                },
                required: ["phone"],
            },
        },
        {
            name: "currency-convert",
            endpoint: "/v1/tools/currency-convert",
            credits: 2,
            description: "Convert between currencies using real-time exchange rates (170+ currencies)",
            method: "POST",
            category: "finance",
            schemaJson: {
                type: "object",
                properties: {
                    amount: { type: "number", description: "Amount to convert" },
                    from: { type: "string", description: "Source currency code (e.g. USD)", maxLength: 3 },
                    to: { type: "string", description: "Target currency code (e.g. EUR)", maxLength: 3 },
                },
                required: ["amount", "from", "to"],
            },
        },
        {
            name: "timezone-convert",
            endpoint: "/v1/tools/timezone-convert",
            credits: 1,
            description: "Convert a datetime between any two IANA timezones",
            method: "POST",
            category: "utilities",
            schemaJson: {
                type: "object",
                properties: {
                    datetime: { type: "string", description: "Datetime string to convert (ISO 8601). Defaults to now." },
                    from_tz: { type: "string", description: "Source IANA timezone (e.g. America/New_York). Defaults to UTC." },
                    to_tz: { type: "string", description: "Target IANA timezone (e.g. Asia/Tokyo)" },
                },
                required: ["to_tz"],
            },
        },
        {
            name: "web-search",
            endpoint: "/v1/tools/web-search",
            credits: 10,
            description: "Real-time web search with AI-synthesized answer (requires TAVILY_API_KEY)",
            method: "POST",
            category: "web",
            schemaJson: {
                type: "object",
                properties: {
                    query: { type: "string", description: "Search query", maxLength: 500 },
                    max_results: { type: "integer", minimum: 1, maximum: 10, default: 5 },
                    search_depth: { type: "string", enum: ["basic", "advanced"], default: "basic" },
                    include_answer: { type: "boolean", default: true, description: "Include AI-synthesized answer" },
                },
                required: ["query"],
            },
        },
        // ── Tier 2: AI-powered ──
        {
            name: "sentiment-analysis",
            endpoint: "/v1/tools/sentiment-analysis",
            credits: 8,
            description: "Analyze text sentiment: positive/negative/neutral with score and emotion detection",
            method: "POST",
            category: "ai",
            schemaJson: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text to analyze", maxLength: 50000 },
                },
                required: ["text"],
            },
        },
        {
            name: "summarize",
            endpoint: "/v1/tools/summarize",
            credits: 10,
            description: "Summarize text in multiple styles: paragraph, bullets, tldr, headline, executive",
            method: "POST",
            category: "ai",
            schemaJson: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text to summarize", maxLength: 100000 },
                    style: { type: "string", enum: ["paragraph", "bullets", "tldr", "headline", "executive"], default: "paragraph" },
                    max_length: { type: "integer", minimum: 50, maximum: 1000, default: 200 },
                },
                required: ["text"],
            },
        },
        {
            name: "extract-entities",
            endpoint: "/v1/tools/extract-entities",
            credits: 8,
            description: "Named entity recognition: people, organizations, locations, dates, money, and more",
            method: "POST",
            category: "ai",
            schemaJson: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text to extract entities from", maxLength: 50000 },
                    types: {
                        type: "array",
                        description: "Entity types to extract (default: all)",
                        items: { type: "string", enum: ["person", "organization", "location", "date", "money", "percentage", "email", "url", "phone", "product"] },
                    },
                },
                required: ["text"],
            },
        },
        {
            name: "language-detect",
            endpoint: "/v1/tools/language-detect",
            credits: 3,
            description: "Detect the language of any text with confidence score and script identification",
            method: "POST",
            category: "ai",
            schemaJson: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text to detect language of" },
                },
                required: ["text"],
            },
        },
        {
            name: "pii-detect",
            endpoint: "/v1/tools/pii-detect",
            credits: 10,
            description: "Detect and optionally redact PII: names, emails, SSNs, credit cards, API keys, and more",
            method: "POST",
            category: "security",
            schemaJson: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text to scan for PII", maxLength: 50000 },
                    redact: { type: "boolean", default: false, description: "Return text with PII replaced" },
                    replacement: { type: "string", default: "[REDACTED]", description: "Replacement string when redact is true" },
                },
                required: ["text"],
            },
        },
        {
            name: "readability-score",
            endpoint: "/v1/tools/readability-score",
            credits: 2,
            description: "Compute Flesch-Kincaid readability, grade level, word count, and read time",
            method: "POST",
            category: "text",
            schemaJson: {
                type: "object",
                properties: {
                    text: { type: "string", description: "Text to analyze" },
                },
                required: ["text"],
            },
        },
        {
            name: "rss-parse",
            endpoint: "/v1/tools/rss-parse",
            credits: 4,
            description: "Fetch and parse RSS or Atom feeds into clean structured JSON",
            method: "POST",
            category: "web",
            schemaJson: {
                type: "object",
                properties: {
                    url: { type: "string", description: "URL of the RSS or Atom feed" },
                    limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
                },
                required: ["url"],
            },
        },
        // ── Tier 3: Differentiators ──
        {
            name: "generate-uuid",
            endpoint: "/v1/tools/generate-uuid",
            credits: 1,
            description: "Generate UUIDs (v1/v4), secure random tokens, and API-key-format strings",
            method: "POST",
            category: "utilities",
            schemaJson: {
                type: "object",
                properties: {
                    type: { type: "string", enum: ["v1", "v4"], default: "v4" },
                    count: { type: "integer", minimum: 1, maximum: 100, default: 1 },
                    prefix: { type: "string", description: "Optional prefix for each UUID", maxLength: 50 },
                },
            },
        },
        {
            name: "regex-generate",
            endpoint: "/v1/tools/regex-generate",
            credits: 8,
            description: "Generate regular expressions from plain English with explanations and test results",
            method: "POST",
            category: "ai",
            schemaJson: {
                type: "object",
                properties: {
                    description: { type: "string", description: "Plain English description of what the regex should match", maxLength: 500 },
                    test_strings: { type: "array", items: { type: "string" }, description: "Optional strings to test against", maxItems: 20 },
                    flags: { type: "string", description: "Regex flags (e.g. 'gi')", maxLength: 10 },
                },
                required: ["description"],
            },
        },
        {
            name: "diff-text",
            endpoint: "/v1/tools/diff-text",
            credits: 2,
            description: "Compare two text strings and return differences in unified, word, char, or JSON format",
            method: "POST",
            category: "text",
            schemaJson: {
                type: "object",
                properties: {
                    original: { type: "string", description: "Original text" },
                    modified: { type: "string", description: "Modified text" },
                    format: { type: "string", enum: ["unified", "words", "chars", "json"], default: "unified" },
                },
                required: ["original", "modified"],
            },
        },
        {
            name: "whois-lookup",
            endpoint: "/v1/tools/whois-lookup",
            credits: 3,
            description: "Look up domain registration info: registrar, created/expires dates, nameservers, status",
            method: "POST",
            category: "network",
            schemaJson: {
                type: "object",
                properties: {
                    domain: { type: "string", description: "Domain name to look up (e.g. google.com)" },
                },
                required: ["domain"],
            },
        },
    ];
    for (const t of tools) {
        await prisma.tool.upsert({
            where: { name: t.name },
            update: {
                endpoint: t.endpoint,
                credits: t.credits,
                version: "1.0.0",
                tags: t.tags ?? [],
                deprecated: false,
                description: t.description,
                method: t.method,
                category: t.category,
                schemaJson: t.schemaJson,
                active: true,
            },
            create: t,
        });
    }
    console.log(`✅ Seeded ${tools.length} tools (8 core + 4 web/browser + 18 expanded = 30 total)`);
}
main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
});
//# sourceMappingURL=seed.js.map