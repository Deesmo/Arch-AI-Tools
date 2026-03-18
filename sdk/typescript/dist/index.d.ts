/**
 * Arch Tools TypeScript/Node SDK
 * Official client for Arch Tools API — 58 AI agent tools with x402 payments
 */
export declare class ArchToolsError extends Error {
    data: Record<string, unknown>;
    constructor(data: Record<string, unknown>);
}
export declare class RateLimitError extends ArchToolsError {
    retryAfter?: string | undefined;
    constructor(data: Record<string, unknown>, retryAfter?: string | undefined);
}
export declare class PaymentRequiredError extends ArchToolsError {
}
export interface ArchToolsOptions {
    apiKey: string;
    baseUrl?: string;
}
export declare class ArchTools {
    private baseUrl;
    private apiKey;
    constructor(options: ArchToolsOptions);
    private _call;
    aiGenerate(prompt: string, options?: {
        model?: string;
        system?: string;
        max_tokens?: number;
    }): Promise<Record<string, unknown>>;
    webScrape(url: string, options?: {
        format?: "markdown" | "html" | "text";
        selector?: string;
    }): Promise<Record<string, unknown>>;
    searchWeb(query: string, limit?: number): Promise<Record<string, unknown>>;
    screenshotCapture(url: string, options?: {
        width?: number;
        height?: number;
        full_page?: boolean;
    }): Promise<Record<string, unknown>>;
    cryptoPrice(symbol: string): Promise<Record<string, unknown>>;
    cryptoMarketCap(limit?: number): Promise<Record<string, unknown>>;
    generateHash(text: string, algorithm?: string): Promise<Record<string, unknown>>;
    generateUuid(count?: number): Promise<Record<string, unknown>>;
    emailVerify(email: string): Promise<Record<string, unknown>>;
    summarize(text: string, style?: string): Promise<Record<string, unknown>>;
    sentimentAnalysis(text: string): Promise<Record<string, unknown>>;
    ocrExtract(imageUrl: string): Promise<Record<string, unknown>>;
    call(tool: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
    balance(): Promise<Record<string, unknown>>;
}
export default ArchTools;
//# sourceMappingURL=index.d.ts.map