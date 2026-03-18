export type ArchToolsOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number; // retries for 429/5xx/network
  backoffMs?: number; // base backoff
};

type HttpError = {
  ok: false;
  error: string;
  detail?: string;
  request_id?: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const s = header.trim();
  const asNum = Number(s);
  if (Number.isFinite(asNum) && asNum >= 0) return Math.min(10_000, asNum * 1000);
  // Date format
  const d = Date.parse(s);
  if (!Number.isNaN(d)) {
    const delta = d - Date.now();
    return delta > 0 ? Math.min(10_000, delta) : 0;
  }
  return null;
}

async function http<T>(
  url: string,
  opts: { method: string; apiKey?: string; body?: any; timeoutMs?: number; maxRetries?: number; backoffMs?: number }
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 2;
  const backoffMs = opts.backoffMs ?? 300;

  let attempt = 0;
  while (true) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);

    try {
      const res = await fetch(url, {
        method: opts.method,
        headers: {
          "Content-Type": "application/json",
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      const json = await res.json().catch(() => ({}));
      if (res.ok) return json as T;

      // Retry on 429 + transient 5xx
      const retryable = res.status === 429 || (res.status >= 500 && res.status <= 504);
      if (retryable && attempt < maxRetries) {
        const ra = parseRetryAfter(res.headers.get("Retry-After"));
        const wait = ra ?? Math.min(2000, backoffMs * Math.pow(2, attempt));
        attempt += 1;
        await sleep(wait);
        continue;
      }

      throw json as HttpError;
    } catch (e: any) {
      // Network/abort errors can be retryable
      const retryable = (e?.name === "AbortError" || e?.code === "ECONNRESET" || e?.message?.includes("fetch")) && attempt < maxRetries;
      if (retryable) {
        const wait = Math.min(2000, backoffMs * Math.pow(2, attempt));
        attempt += 1;
        await sleep(wait);
        continue;
      }
      throw e;
    } finally {
      clearTimeout(t);
    }
  }
}

// ─── Tool method option types ────────────────────────────────────────────────

export interface AiGenerateOptions {
  prompt: string;
  model?: string;
  mode?: "fast" | "smart" | "deep";
  system?: string;
  max_tokens?: number;
}

export interface AiOracleOptions {
  question: string;
  context?: string;
  reasoning_depth?: "standard" | "deep";
}

export interface WebScrapeOptions {
  url: string;
  format?: string;
  selector?: string;
}

export interface SearchWebOptions {
  query: string;
  max_results?: number;
}

export interface SummarizeOptions {
  text: string;
  style?: "paragraph" | "bullets" | "tldr" | "headline" | "executive";
  max_length?: number;
}

export interface VectorStoreOptions {
  content: string;
  namespace: string;
  metadata?: Record<string, string>;
}

export interface VectorSearchOptions {
  query: string;
  namespace: string;
  top_k?: number;
}

export interface ScreenshotOptions {
  url: string;
  full_page?: boolean;
  width?: number;
  height?: number;
}

// ─── Main SDK Class ──────────────────────────────────────────────────────────

export class ArchTools {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private backoffMs: number;

  constructor(opts: ArchToolsOptions) {
    this.apiKey = opts.apiKey;
    const envBase =
      (typeof process !== "undefined" && (process as any)?.env?.ARCHTOOLS_BASE_URL) ||
      (typeof process !== "undefined" && (process as any)?.env?.ARCH_API_BASE_URL) ||
      undefined;

    this.baseUrl = (opts.baseUrl || envBase || "https://archtools.dev").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.backoffMs = opts.backoffMs ?? 300;
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  private _httpOpts() {
    return {
      apiKey: this.apiKey,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      backoffMs: this.backoffMs,
    };
  }

  private _get<T>(path: string): Promise<T> {
    return http<T>(`${this.baseUrl}${path}`, { method: "GET", ...this._httpOpts() });
  }

  private _post<T>(path: string, body: any): Promise<T> {
    return http<T>(`${this.baseUrl}${path}`, { method: "POST", body, ...this._httpOpts() });
  }

  // ─── Generic tool call ───────────────────────────────────────────────────

  /**
   * Call any tool by name with arbitrary params.
   * Useful for tools not yet covered by typed methods.
   */
  async callTool(toolName: string, params: Record<string, any> = {}): Promise<any> {
    return this._post(`/v1/tools/${encodeURIComponent(toolName)}`, params);
  }

  // ─── AI tools ────────────────────────────────────────────────────────────

  /** Generate text with AI. Supports mode presets (fast/smart/deep) or explicit model. */
  async aiGenerate(opts: AiGenerateOptions): Promise<any> {
    return this._post("/v1/tools/ai-generate", opts);
  }

  /** Deep reasoning with AI Oracle. Tries Opus → GPT-4o fallback. */
  async aiOracle(opts: AiOracleOptions): Promise<any> {
    return this._post("/v1/tools/ai-oracle", opts);
  }

  // ─── Web tools ───────────────────────────────────────────────────────────

  /** Scrape a web page and extract text/HTML content. */
  async webScrape(opts: WebScrapeOptions): Promise<any> {
    return this._post("/v1/tools/web-scrape", opts);
  }

  /** Search the web with AI-synthesized answers. */
  async searchWeb(opts: SearchWebOptions): Promise<any> {
    return this._post("/v1/tools/search-web", {
      query: opts.query,
      num_results: opts.max_results,
    });
  }

  /** Take a screenshot of a web page. */
  async screenshot(opts: ScreenshotOptions): Promise<any> {
    return this._post("/v1/tools/screenshot-capture", opts);
  }

  // ─── Text tools ──────────────────────────────────────────────────────────

  /** Summarize text in various styles. */
  async summarize(opts: SummarizeOptions): Promise<any> {
    return this._post("/v1/tools/summarize", opts);
  }

  // ─── Vector tools ────────────────────────────────────────────────────────

  /** Store content in a vector namespace for later retrieval. */
  async vectorStore(opts: VectorStoreOptions): Promise<any> {
    return this._post("/v1/tools/vector-store", opts);
  }

  /** Search a vector namespace by semantic similarity. */
  async vectorSearch(opts: VectorSearchOptions): Promise<any> {
    return this._post("/v1/tools/vector-search", opts);
  }

  // ─── Session / Conversation ──────────────────────────────────────────────

  /** Create a conversation session. */
  async sessionCreate(opts: { namespace: string; system_prompt?: string; model?: string }): Promise<any> {
    return this._post("/v1/tools/session-create", opts);
  }

  /** Send a message in an existing session. */
  async sessionMessage(opts: { session_id: string; message: string }): Promise<any> {
    return this._post("/v1/tools/session-message", opts);
  }

  // ─── Utility namespaces (preserved from scaffold) ────────────────────────

  tools = {
    list: async () =>
      this._get<{ ok: true; tools: any[] }>("/v1/tools"),
    invoke: async (toolName: string, input: any) =>
      this._post<any>(`/v1/tools/${encodeURIComponent(toolName)}`, input),
  };

  agent = {
    usage: async () => this._get<any>("/v1/agent/usage"),
    register: async (name?: string, email?: string) =>
      http<any>(`${this.baseUrl}/v1/agent/register`, {
        method: "POST",
        body: { name, email },
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        backoffMs: this.backoffMs,
      }),
  };

  billing = {
    checkout: async (priceId: string) =>
      this._post<any>("/v1/checkout", { price_id: priceId }),
  };
}

export default ArchTools;
