/**
 * Arch Tools TypeScript/Node SDK
 * Official client for Arch Tools API — 58 AI agent tools with x402 payments
 */

export class ArchToolsError extends Error {
  constructor(public data: Record<string, unknown>) {
    super((data.message as string) || "Arch Tools API error");
  }
}

export class RateLimitError extends ArchToolsError {
  constructor(data: Record<string, unknown>, public retryAfter?: string) {
    super(data);
  }
}

export class PaymentRequiredError extends ArchToolsError {}

export interface ArchToolsOptions {
  apiKey: string;
  baseUrl?: string;
}

export class ArchTools {
  private baseUrl: string;
  private apiKey: string;

  constructor(options: ArchToolsOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://arch-ai-tools.onrender.com/v1";
  }

  private async _call(tool: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const res = await fetch(`${this.baseUrl}/tools/${tool}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": "arch-tools-node/0.1.0",
      },
      body: JSON.stringify(params),
    });

    const data = await res.json() as Record<string, unknown>;

    if (res.status === 402) throw new PaymentRequiredError(data);
    if (res.status === 429) throw new RateLimitError(data, res.headers.get("Retry-After") ?? undefined);
    if (!res.ok) throw new ArchToolsError(data);

    return data;
  }

  // AI Tools
  aiGenerate(prompt: string, options?: { model?: string; system?: string; max_tokens?: number }) {
    return this._call("ai-generate", { prompt, ...options });
  }

  // Web Tools
  webScrape(url: string, options?: { format?: "markdown" | "html" | "text"; selector?: string }) {
    return this._call("web-scrape", { url, ...options });
  }

  searchWeb(query: string, limit = 10) {
    return this._call("search-web", { query, limit });
  }

  screenshotCapture(url: string, options?: { width?: number; height?: number; full_page?: boolean }) {
    return this._call("screenshot-capture", { url, ...options });
  }

  // Crypto Tools
  cryptoPrice(symbol: string) { return this._call("crypto-price", { symbol }); }
  cryptoMarketCap(limit = 10) { return this._call("crypto-market-cap", { limit }); }

  // Utility Tools
  generateHash(text: string, algorithm = "sha256") { return this._call("generate-hash", { text, algorithm }); }
  generateUuid(count = 1) { return this._call("generate-uuid", { count }); }
  emailVerify(email: string) { return this._call("email-verify", { email }); }
  summarize(text: string, style = "bullets") { return this._call("summarize", { text, style }); }
  sentimentAnalysis(text: string) { return this._call("sentiment-analysis", { text }); }
  ocrExtract(imageUrl: string) { return this._call("ocr-extract", { image_url: imageUrl }); }

  // Generic call
  call(tool: string, params: Record<string, unknown> = {}) { return this._call(tool, params); }

  // Account
  async balance() {
    const res = await fetch(`${this.baseUrl}/agent/balance`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) throw new ArchToolsError(data);
    return data;
  }
}

export default ArchTools;
