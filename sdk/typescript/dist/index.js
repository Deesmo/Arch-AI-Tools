"use strict";
/**
 * Arch Tools TypeScript/Node SDK
 * Official client for Arch Tools API — 58 AI agent tools with x402 payments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArchTools = exports.PaymentRequiredError = exports.RateLimitError = exports.ArchToolsError = void 0;
class ArchToolsError extends Error {
    constructor(data) {
        super(data.message || "Arch Tools API error");
        this.data = data;
    }
}
exports.ArchToolsError = ArchToolsError;
class RateLimitError extends ArchToolsError {
    constructor(data, retryAfter) {
        super(data);
        this.retryAfter = retryAfter;
    }
}
exports.RateLimitError = RateLimitError;
class PaymentRequiredError extends ArchToolsError {
}
exports.PaymentRequiredError = PaymentRequiredError;
class ArchTools {
    constructor(options) {
        this.apiKey = options.apiKey;
        this.baseUrl = options.baseUrl ?? "https://arch-ai-tools.onrender.com/v1";
    }
    async _call(tool, params = {}) {
        const res = await fetch(`${this.baseUrl}/tools/${tool}`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                "Content-Type": "application/json",
                "User-Agent": "arch-tools-node/0.1.0",
            },
            body: JSON.stringify(params),
        });
        const data = await res.json();
        if (res.status === 402)
            throw new PaymentRequiredError(data);
        if (res.status === 429)
            throw new RateLimitError(data, res.headers.get("Retry-After") ?? undefined);
        if (!res.ok)
            throw new ArchToolsError(data);
        return data;
    }
    // AI Tools
    aiGenerate(prompt, options) {
        return this._call("ai-generate", { prompt, ...options });
    }
    // Web Tools
    webScrape(url, options) {
        return this._call("web-scrape", { url, ...options });
    }
    searchWeb(query, limit = 10) {
        return this._call("search-web", { query, limit });
    }
    screenshotCapture(url, options) {
        return this._call("screenshot-capture", { url, ...options });
    }
    // Crypto Tools
    cryptoPrice(symbol) { return this._call("crypto-price", { symbol }); }
    cryptoMarketCap(limit = 10) { return this._call("crypto-market-cap", { limit }); }
    // Utility Tools
    generateHash(text, algorithm = "sha256") { return this._call("generate-hash", { text, algorithm }); }
    generateUuid(count = 1) { return this._call("generate-uuid", { count }); }
    emailVerify(email) { return this._call("email-verify", { email }); }
    summarize(text, style = "bullets") { return this._call("summarize", { text, style }); }
    sentimentAnalysis(text) { return this._call("sentiment-analysis", { text }); }
    ocrExtract(imageUrl) { return this._call("ocr-extract", { image_url: imageUrl }); }
    // Generic call
    call(tool, params = {}) { return this._call(tool, params); }
    // Account
    async balance() {
        const res = await fetch(`${this.baseUrl}/agent/balance`, {
            headers: { Authorization: `Bearer ${this.apiKey}` },
        });
        const data = await res.json();
        if (!res.ok)
            throw new ArchToolsError(data);
        return data;
    }
}
exports.ArchTools = ArchTools;
exports.default = ArchTools;
