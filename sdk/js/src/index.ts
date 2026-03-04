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

export class ArchTools {
  private apiKey: string;
  private baseUrl: string;
  private timeoutMs: number;
  private maxRetries: number;
  private backoffMs: number;

  constructor(opts: ArchToolsOptions) {
    this.apiKey = opts.apiKey;
    const envBase =
      // browser-safe global injection (optional)
      (typeof process !== "undefined" && (process as any)?.env?.ARCHTOOLS_BASE_URL) ||
      (typeof process !== "undefined" && (process as any)?.env?.ARCH_API_BASE_URL) ||
      undefined;

    this.baseUrl = (opts.baseUrl || envBase || "https://archtools.dev").replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.backoffMs = opts.backoffMs ?? 300;
  }

  tools = {
    list: async () =>
      http<{ ok: true; tools: any[] }>(`${this.baseUrl}/v1/tools`, {
        method: "GET",
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        backoffMs: this.backoffMs,
      }),
    invoke: async (toolName: string, input: any) =>
      http<any>(`${this.baseUrl}/v1/tools/${encodeURIComponent(toolName)}`, {
        method: "POST",
        apiKey: this.apiKey,
        body: input,
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        backoffMs: this.backoffMs,
      }),
  };

  agent = {
    usage: async () =>
      http<any>(`${this.baseUrl}/v1/agent/usage`, {
        method: "GET",
        apiKey: this.apiKey,
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        backoffMs: this.backoffMs,
      }),
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
      http<any>(`${this.baseUrl}/v1/checkout`, {
        method: "POST",
        apiKey: this.apiKey,
        body: { price_id: priceId },
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        backoffMs: this.backoffMs,
      }),
  };
}
