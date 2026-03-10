// Tool inputSchema definitions for all 50 tools — required for Smithery quality score
export const TOOL_SCHEMAS = {
    "ai-generate": {
        type: "object",
        properties: {
            prompt: { type: "string", description: "The prompt to send to the AI model" },
            model: { type: "string", description: "AI model to use (default: claude-haiku)" },
            max_tokens: { type: "number", description: "Maximum tokens in response (default: 1000)" },
            temperature: { type: "number", description: "Sampling temperature 0-1 (default: 0.7)" }
        },
        required: ["prompt"]
    },
    "barcode-generate": {
        type: "object",
        properties: {
            content: { type: "string", description: "Text or data to encode in the barcode" },
            format: { type: "string", description: "Barcode format: code128, qr, ean13, upc (default: code128)" }
        },
        required: ["content"]
    },
    "browser-task": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL to navigate to" },
            task: { type: "string", description: "Description of the browser task to perform" },
            extract: { type: "string", description: "CSS selector or description of data to extract" }
        },
        required: ["url"]
    },
    "check-domain": {
        type: "object",
        properties: {
            domain: { type: "string", description: "Domain name to check availability (e.g. example.com)" }
        },
        required: ["domain"]
    },
    "convert-format": {
        type: "object",
        properties: {
            data: { type: "string", description: "Input data to convert" },
            from: { type: "string", description: "Source format: json, yaml, csv, xml, toml" },
            to: { type: "string", description: "Target format: json, yaml, csv, xml, toml" }
        },
        required: ["data", "from", "to"]
    },
    "crypto-fear-greed": {
        type: "object",
        properties: {
            days: { type: "number", description: "Number of days of historical data (default: 1)" }
        }
    },
    "crypto-market-cap": {
        type: "object",
        properties: {
            limit: { type: "number", description: "Number of top cryptocurrencies to return (default: 10)" },
            currency: { type: "string", description: "Fiat currency for prices (default: usd)" }
        }
    },
    "crypto-news": {
        type: "object",
        properties: {
            limit: { type: "number", description: "Number of news articles to return (default: 5)" },
            topic: { type: "string", description: "Optional topic filter (e.g. bitcoin, ethereum)" }
        }
    },
    "crypto-ohlcv": {
        type: "object",
        properties: {
            symbol: { type: "string", description: "Cryptocurrency ID (e.g. bitcoin, ethereum)" },
            days: { type: "number", description: "Number of days of OHLCV data (default: 30)" },
            currency: { type: "string", description: "Fiat currency (default: usd)" }
        },
        required: ["symbol"]
    },
    "crypto-price": {
        type: "object",
        properties: {
            symbol: { type: "string", description: "Cryptocurrency ID (e.g. bitcoin, ethereum, solana)" },
            currency: { type: "string", description: "Fiat currency for price (default: usd)" }
        },
        required: ["symbol"]
    },
    "crypto-sentiment": {
        type: "object",
        properties: {
            symbol: { type: "string", description: "Cryptocurrency ID to analyze sentiment for" }
        },
        required: ["symbol"]
    },
    "currency-convert": {
        type: "object",
        properties: {
            amount: { type: "number", description: "Amount to convert" },
            from: { type: "string", description: "Source currency code (e.g. USD, EUR, GBP)" },
            to: { type: "string", description: "Target currency code (e.g. EUR, JPY, GBP)" }
        },
        required: ["amount", "from", "to"]
    },
    "diff-text": {
        type: "object",
        properties: {
            text1: { type: "string", description: "Original text" },
            text2: { type: "string", description: "Modified text" },
            mode: { type: "string", description: "Diff mode: chars, words, lines (default: lines)" }
        },
        required: ["text1", "text2"]
    },
    "email-verify": {
        type: "object",
        properties: {
            email: { type: "string", description: "Email address to verify" }
        },
        required: ["email"]
    },
    "extract-entities": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to extract named entities from" },
            types: { type: "array", items: { type: "string" }, description: "Entity types to extract: person, organization, location, date, etc." }
        },
        required: ["text"]
    },
    "extract-metadata": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL to extract metadata from (title, description, OG tags)" }
        },
        required: ["url"]
    },
    "extract-page": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL of the page to extract structured content from" },
            format: { type: "string", description: "Output format: text, markdown, html (default: markdown)" }
        },
        required: ["url"]
    },
    "extract-pdf": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL of the PDF to extract text from" },
            pages: { type: "string", description: "Page range to extract (e.g. 1-5, default: all)" }
        },
        required: ["url"]
    },
    "generate-hash": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to hash" },
            algorithm: { type: "string", description: "Hash algorithm: md5, sha1, sha256, sha512 (default: sha256)" }
        },
        required: ["text"]
    },
    "generate-image": {
        type: "object",
        properties: {
            prompt: { type: "string", description: "Text description of the image to generate" },
            size: { type: "string", description: "Image size: 1024x1024, 1792x1024, 1024x1792 (default: 1024x1024)" },
            quality: { type: "string", description: "Quality level: standard, hd (default: standard)" }
        },
        required: ["prompt"]
    },
    "generate-uuid": {
        type: "object",
        properties: {
            format: { type: "string", description: "UUID format: uuid, ulid, nanoid, cuid (default: uuid)" },
            count: { type: "number", description: "Number of IDs to generate (default: 1)" }
        }
    },
    "html-to-markdown": {
        type: "object",
        properties: {
            html: { type: "string", description: "HTML content to convert to Markdown" }
        },
        required: ["html"]
    },
    "image-generate": {
        type: "object",
        properties: {
            prompt: { type: "string", description: "Text description of the image to generate" },
            size: { type: "string", description: "Image dimensions (default: 1024x1024)" },
            quality: { type: "string", description: "Quality: standard or hd" },
            style: { type: "string", description: "Style: vivid or natural" }
        },
        required: ["prompt"]
    },
    "ip-lookup": {
        type: "object",
        properties: {
            ip: { type: "string", description: "IP address to look up geolocation for" }
        },
        required: ["ip"]
    },
    "jsonpath-query": {
        type: "object",
        properties: {
            data: { type: "object", description: "JSON object to query" },
            query: { type: "string", description: "JSONPath expression (e.g. $.store.book[0].title)" }
        },
        required: ["data", "query"]
    },
    "language-detect": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to detect the language of" }
        },
        required: ["text"]
    },
    "ocr-extract": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL of the image to extract text from via OCR" },
            language: { type: "string", description: "Language hint for OCR (default: eng)" }
        },
        required: ["url"]
    },
    "phone-validate": {
        type: "object",
        properties: {
            phone: { type: "string", description: "Phone number to validate (include country code, e.g. +12125551234)" }
        },
        required: ["phone"]
    },
    "pii-detect": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to scan for personally identifiable information (PII)" }
        },
        required: ["text"]
    },
    "qr-code": {
        type: "object",
        properties: {
            content: { type: "string", description: "Text, URL, or data to encode in QR code" },
            format: { type: "string", description: "Output format: svg, png (default: svg)" },
            size: { type: "number", description: "QR code size in pixels (default: 256)" }
        },
        required: ["content"]
    },
    "readability-score": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to analyze for readability metrics" }
        },
        required: ["text"]
    },
    "regex-generate": {
        type: "object",
        properties: {
            description: { type: "string", description: "Natural language description of the pattern to match" },
            examples: { type: "array", items: { type: "string" }, description: "Example strings that should match" }
        },
        required: ["description"]
    },
    "rss-parse": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL of the RSS or Atom feed to parse" },
            limit: { type: "number", description: "Maximum number of items to return (default: 10)" }
        },
        required: ["url"]
    },
    "screenshot-capture": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL of the page to screenshot" },
            width: { type: "number", description: "Viewport width in pixels (default: 1280)" },
            height: { type: "number", description: "Viewport height in pixels (default: 720)" },
            fullPage: { type: "boolean", description: "Capture full scrollable page (default: false)" }
        },
        required: ["url"]
    },
    "search-web": {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query string" },
            num_results: { type: "number", description: "Number of results to return (default: 5, max: 10)" }
        },
        required: ["query"]
    },
    "send-email": {
        type: "object",
        properties: {
            to: { type: "string", description: "Recipient email address" },
            subject: { type: "string", description: "Email subject line" },
            body: { type: "string", description: "Email body (plain text or HTML)" },
            from: { type: "string", description: "Sender email (default: noreply@archtools.dev)" }
        },
        required: ["to", "subject", "body"]
    },
    "sentiment-analysis": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to analyze for sentiment (positive, negative, neutral)" }
        },
        required: ["text"]
    },
    "summarize": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to summarize" },
            style: { type: "string", description: "Summary style: brief, detailed, tldr, bullets (default: brief)" },
            max_length: { type: "number", description: "Maximum summary length in words" }
        },
        required: ["text"]
    },
    "text-to-speech": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to convert to speech" },
            voice: { type: "string", description: "Voice ID or name (default: adam)" },
            stability: { type: "number", description: "Voice stability 0-1 (default: 0.5)" },
            similarity_boost: { type: "number", description: "Voice similarity boost 0-1 (default: 0.75)" }
        },
        required: ["text"]
    },
    "timezone-convert": {
        type: "object",
        properties: {
            datetime: { type: "string", description: "Date/time string to convert (ISO 8601)" },
            from_tz: { type: "string", description: "Source timezone (e.g. America/New_York)" },
            to_tz: { type: "string", description: "Target timezone (e.g. Europe/London)" }
        },
        required: ["datetime", "from_tz", "to_tz"]
    },
    "token-lookup": {
        type: "object",
        properties: {
            symbol: { type: "string", description: "Token symbol or contract address to look up" },
            chain: { type: "string", description: "Blockchain network (default: ethereum)" }
        },
        required: ["symbol"]
    },
    "transcribe-audio": {
        type: "object",
        properties: {
            audio_url: { type: "string", description: "URL of the audio file to transcribe" },
            language: { type: "string", description: "Language code hint (e.g. en, es, fr)" }
        },
        required: ["audio_url"]
    },
    "transform-text": {
        type: "object",
        properties: {
            text: { type: "string", description: "Text to transform" },
            operation: { type: "string", description: "Transformation: uppercase, lowercase, titlecase, reverse, slug, camelCase, snakeCase" }
        },
        required: ["text", "operation"]
    },
    "url-shorten": {
        type: "object",
        properties: {
            url: { type: "string", description: "Long URL to shorten" }
        },
        required: ["url"]
    },
    "validate-data": {
        type: "object",
        properties: {
            data: { type: "object", description: "Data to validate" },
            schema: { type: "object", description: "JSON Schema to validate against" }
        },
        required: ["data", "schema"]
    },
    "web-scrape": {
        type: "object",
        properties: {
            url: { type: "string", description: "URL of the page to scrape" },
            selector: { type: "string", description: "CSS selector to extract specific content" },
            format: { type: "string", description: "Output format: text, html, markdown (default: text)" }
        },
        required: ["url"]
    },
    "web-search": {
        type: "object",
        properties: {
            query: { type: "string", description: "Search query to research and synthesize an answer for" },
            depth: { type: "string", description: "Search depth: quick, thorough (default: quick)" }
        },
        required: ["query"]
    },
    "webhook-send": {
        type: "object",
        properties: {
            url: { type: "string", description: "Webhook URL to send the payload to" },
            method: { type: "string", description: "HTTP method: POST, PUT, PATCH (default: POST)" },
            body: { type: "object", description: "JSON payload to send" },
            headers: { type: "object", description: "Additional HTTP headers" }
        },
        required: ["url"]
    },
    "whois-lookup": {
        type: "object",
        properties: {
            domain: { type: "string", description: "Domain name to look up WHOIS/RDAP information for" }
        },
        required: ["domain"]
    },
    "workflow-agent": {
        type: "object",
        properties: {
            task: { type: "string", description: "Description of the multi-step workflow to execute" },
            steps: { type: "array", items: { type: "object" }, description: "Ordered list of steps with tool names and inputs" }
        },
        required: ["task"]
    }
};
// New tools added 2026-03-09
TOOL_SCHEMAS["news-search"] = {
    type: "object",
    properties: {
        query: { type: "string", description: "News search query (e.g. 'AI regulations 2025')" },
        limit: { type: "number", description: "Number of results to return (default: 5, max: 10)" }
    },
    required: ["query"]
};
TOOL_SCHEMAS["research-report"] = {
    type: "object",
    properties: {
        query: { type: "string", description: "Research topic or question to investigate" },
        depth: { type: "string", description: "Research depth: 'standard' (5 sources) or 'deep' (10 sources + advanced synthesis). Default: standard" }
    },
    required: ["query"]
};
TOOL_SCHEMAS["fact-check"] = {
    type: "object",
    properties: {
        claim: { type: "string", description: "The claim or statement to fact-check (e.g. 'The Great Wall of China is visible from space')" }
    },
    required: ["claim"]
};
//# sourceMappingURL=schemas.js.map