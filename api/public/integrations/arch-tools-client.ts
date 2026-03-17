/**
 * Arch Tools — TypeScript/Node.js Client
 * ========================================
 *
 * Lightweight TypeScript client for the Arch Tools API.
 * Supports API key auth and handles x402 payment errors.
 * Works in Node.js, Deno, Bun, and browsers with fetch.
 *
 * Install:
 *   npm install @archtools/client
 *   # or just copy this file
 *
 * Usage:
 *   import { ArchTools } from './arch-tools-client';
 *
 *   const arch = new ArchTools({ apiKey: 'arch_...' });
 *   const result = await arch.callTool('summarize', { text: 'Hello...', style: 'bullets' });
 *   console.log(result);
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ArchToolsConfig {
  /** Your Arch Tools API key (starts with 'arch_'). */
  apiKey?: string;
  /** API base URL. Defaults to https://archtools.dev */
  baseUrl?: string;
  /** Request timeout in milliseconds. Default: 30000 */
  timeoutMs?: number;
  /** Max retries for transient errors (429, 5xx). Default: 2 */
  maxRetries?: number;
  /** Custom fetch implementation (for non-browser environments). */
  fetch?: typeof globalThis.fetch;
}

export interface ArchToolsResponse<T = Record<string, unknown>> {
  ok: boolean;
  data?: T;
  error?: string;
  message?: string;
  request_id?: string;
  [key: string]: unknown;
}

export interface ArchToolsError {
  ok: false;
  error: string;
  message?: string;
  statusCode: number;
  paymentDetails?: Record<string, unknown>;
}

// ─── Tool-specific input types ───────────────────────────────────────────────

export interface SummarizeInput {
  text: string;
  style?: 'bullets' | 'tldr' | 'executive' | 'paragraph' | 'headline';
  max_length?: number;
}

export interface AiGenerateInput {
  prompt: string;
  model?: 'claude' | 'gpt4' | 'grok' | 'gemini';
  system?: string;
  max_tokens?: number;
}

export interface WebScrapeInput {
  url: string;
  format?: 'markdown' | 'html' | 'text';
  selector?: string;
}

export interface WebSearchInput {
  query: string;
  limit?: number;
}

export interface ScreenshotInput {
  url: string;
  width?: number;
  height?: number;
  full_page?: boolean;
  format?: 'png' | 'jpeg';
}

export interface CryptoPriceInput {
  symbol: string;
}

export interface ImageGenerateInput {
  prompt: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  style?: 'vivid' | 'natural';
}

export interface ResearchInput {
  topic: string;
  depth?: 'brief' | 'standard' | 'comprehensive';
  format?: 'markdown' | 'json';
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class ArchTools {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private _fetch: typeof globalThis.fetch;

  constructor(config: ArchToolsConfig = {}) {
    this.apiKey = config.apiKey
      ?? (typeof process !== 'undefined' ? process.env?.ARCHTOOLS_API_KEY : undefined)
      ?? '';
    this.baseUrl = (config.baseUrl
      ?? (typeof process !== 'undefined' ? process.env?.ARCHTOOLS_BASE_URL : undefined)
      ?? 'https://archtools.dev').replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxRetries = config.maxRetries ?? 2;
    this._fetch = config.fetch ?? globalThis.fetch;
  }

  // ─── Internal ────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
    return h;
  }

  private async request<T = Record<string, unknown>>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await this._fetch(url, {
          method,
          headers: this.headers(),
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        const json = await res.json().catch(() => ({})) as T & { error?: string; ok?: boolean };

        if (res.ok) return json;

        // 402 — payment required (x402)
        if (res.status === 402) {
          const err: ArchToolsError = {
            ok: false,
            error: (json as any).error ?? 'payment_required',
            message: (json as any).message ?? 'x402 payment required',
            statusCode: 402,
            paymentDetails: (() => {
              try {
                const h = res.headers.get('x-payment-details');
                return h ? JSON.parse(h) : undefined;
              } catch { return undefined; }
            })(),
          };
          throw err;
        }

        // 429 / 5xx — retryable
        const retryable = res.status === 429 || (res.status >= 500 && res.status <= 504);
        if (retryable && attempt < this.maxRetries) {
          const ra = res.headers.get('retry-after');
          const wait = ra ? Math.min(10_000, parseFloat(ra) * 1000) : Math.min(5000, 300 * Math.pow(2, attempt));
          await new Promise(r => setTimeout(r, isNaN(wait) ? 300 : wait));
          continue;
        }

        const err: ArchToolsError = {
          ok: false,
          error: (json as any).error ?? 'unknown',
          message: (json as any).message,
          statusCode: res.status,
        };
        throw err;
      } catch (e: any) {
        if (e && typeof e === 'object' && 'statusCode' in e) throw e;

        // Network/abort — retryable
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, Math.min(5000, 300 * Math.pow(2, attempt))));
          continue;
        }
        throw { ok: false, error: 'network_error', message: String(e), statusCode: 0 } as ArchToolsError;
      } finally {
        clearTimeout(timer);
      }
    }

    throw { ok: false, error: 'max_retries', message: 'Max retries exceeded', statusCode: 0 } as ArchToolsError;
  }

  // ─── Public API ──────────────────────────────────────────────────────

  /**
   * Call any Arch Tools tool by name.
   *
   * @param toolName - Tool name (e.g. 'summarize', 'ai-generate', 'web-scrape')
   * @param params - Tool-specific parameters
   * @returns Tool response
   *
   * @example
   * const result = await arch.callTool('summarize', { text: 'Hello...', style: 'bullets' });
   */
  async callTool<T = Record<string, unknown>>(
    toolName: string,
    params: Record<string, unknown> = {},
  ): Promise<T> {
    return this.request<T>('POST', `/v1/tools/${encodeURIComponent(toolName)}`, params);
  }

  /** List all available tools. */
  async listTools(): Promise<{ ok: boolean; tools: Array<{ name: string; description: string }> }> {
    return this.request('GET', '/v1/tools');
  }

  /** Register a new agent and get an API key. */
  async register(name?: string, email?: string): Promise<{ ok: boolean; api_key: string }> {
    return this.request('POST', '/v1/agent/register', { name, email });
  }

  /** Get current usage stats. */
  async usage(): Promise<Record<string, unknown>> {
    return this.request('GET', '/v1/agent/usage');
  }

  // ─── Convenience methods ─────────────────────────────────────────────

  async summarize(input: SummarizeInput) {
    return this.callTool('summarize', input as Record<string, unknown>);
  }

  async aiGenerate(input: AiGenerateInput) {
    return this.callTool('ai-generate', input as Record<string, unknown>);
  }

  async webScrape(input: WebScrapeInput) {
    return this.callTool('web-scrape', input as Record<string, unknown>);
  }

  async webSearch(input: WebSearchInput) {
    return this.callTool('web-search', input as Record<string, unknown>);
  }

  async screenshot(input: ScreenshotInput) {
    return this.callTool('screenshot-capture', input as Record<string, unknown>);
  }

  async cryptoPrice(input: CryptoPriceInput) {
    return this.callTool('crypto-price', input as Record<string, unknown>);
  }

  async imageGenerate(input: ImageGenerateInput) {
    return this.callTool('image-generate', input as Record<string, unknown>);
  }

  async research(input: ResearchInput) {
    return this.callTool('research-report', input as Record<string, unknown>);
  }

  async sentiment(text: string) {
    return this.callTool('sentiment-analysis', { text });
  }

  async factCheck(claim: string) {
    return this.callTool('fact-check', { claim });
  }
}

export default ArchTools;
