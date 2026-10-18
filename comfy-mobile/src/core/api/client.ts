/**
 * Thin typed wrapper around the ComfyUI HTTP API.
 *
 * All methods take the base URL from the settings store at call time so
 * changing the server in Settings takes effect immediately.
 */
import { useSettingsStore } from '../store/settings';
import type {
  ApiPrompt,
  History,
  ImageRef,
  ObjectInfo,
  PromptErrorResponse,
  PromptResponse,
  QueueResponse,
  SystemStats,
  UploadResponse,
  UserdataListEntry,
} from './types';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

/** Normalises a user-entered server URL: adds a missing `http://` scheme and strips trailing slashes. */
export function normalizeServerUrl(input: string): string {
  let url = input.trim();
  if (!url) return 'http://127.0.0.1:8188';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
}

export function baseUrl(): string {
  return normalizeServerUrl(useSettingsStore.getState().serverUrl);
}

export function wsUrl(clientId: string): string {
  const http = absoluteServerUrl('/ws');
  return `${http.replace(/^http/i, 'ws')}?clientId=${encodeURIComponent(clientId)}`;
}

/** Thrown when a request exceeded its deadline or stalled; `url` is the exact URL that failed. */
export class TimeoutError extends Error {
  url: string;
  constructor(message: string, url: string) {
    super(message);
    this.name = 'TimeoutError';
    this.url = url;
  }
}

interface RequestOptions extends RequestInit {
  /** Abort if no response headers arrive within this many ms (0 = no deadline). */
  timeoutMs?: number;
}

/**
 * Ties an optional outer signal and a deadline into one AbortSignal. The
 * returned `timedOut()` tells the caller whether the deadline (rather than the
 * outer signal) fired, so the error can say so.
 */
function withDeadline(outer: AbortSignal | null | undefined, timeoutMs: number) {
  const ctrl = new AbortController();
  let timedOut = false;
  const onOuter = () => ctrl.abort(outer?.reason);
  if (outer) {
    if (outer.aborted) onOuter();
    else outer.addEventListener('abort', onOuter, { once: true });
  }
  const timer = timeoutMs > 0 ? setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs) : null;
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    clear: () => {
      if (timer) clearTimeout(timer);
      outer?.removeEventListener('abort', onOuter);
    },
  };
}

/**
 * Same base the node-list fetch uses (`baseUrl()`, which prefixes `http://`
 * when the saved address has no scheme) plus a path. No URL parser and no refusal.
 */
export function absoluteServerUrl(path: string): string {
  const rooted = path.startsWith('/') ? path : `/${path}`;
  return `${baseUrl()}${rooted}`;
}

async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const url = absoluteServerUrl(path);
  const { timeoutMs = 0, signal, ...rest } = init ?? {};
  const deadline = withDeadline(signal, timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      signal: deadline.signal,
      headers: {
        Accept: 'application/json',
        ...(rest.body && !(rest.body instanceof FormData)
          ? { 'Content-Type': 'application/json' }
          : {}),
        ...(rest.headers ?? {}),
      },
    });
  } catch (err) {
    if (deadline.timedOut()) throw new TimeoutError(`No response from ${url} within ${Math.round(timeoutMs / 1000)}s`, url);
    throw err;
  } finally {
    deadline.clear();
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    throw new ApiError(`${init?.method ?? 'GET'} ${path} failed (${res.status})`, res.status, body);
  }
  return body as T;
}

export interface DownloadProgress {
  /** Bytes received so far (decoded body bytes). */
  received: number;
  /** `Content-Length` when the server sent one and the body is not content-encoded; otherwise null. */
  total: number | null;
}

export interface LargeFetchOptions {
  signal?: AbortSignal;
  /** Deadline for the response *headers* (ms). */
  headersTimeoutMs?: number;
  /** Abort when no body bytes arrive for this long (ms) — "stalled", as opposed to slow. */
  stallTimeoutMs?: number;
  onProgress?: (p: DownloadProgress) => void;
  /** Called once the whole body is in memory, right before JSON.parse (which can take a while for tens of MB). */
  onParsing?: () => void;
}

/**
 * Streams a (potentially huge) JSON body so the UI can show byte progress and
 * distinguish a slow-but-progressing download from a stalled one. Used for
 * `/object_info`, which on a server with many custom node packs is tens of MB.
 */
async function fetchLargeJson<T>(path: string, opts: LargeFetchOptions = {}): Promise<T> {
  const url = absoluteServerUrl(path);
  const { headersTimeoutMs = 15_000, stallTimeoutMs = 30_000 } = opts;
  const deadline = withDeadline(opts.signal, headersTimeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: deadline.signal, headers: { Accept: 'application/json' } });
  } catch (err) {
    if (deadline.timedOut()) throw new TimeoutError(`No response from ${url} within ${Math.round(headersTimeoutMs / 1000)}s`, url);
    throw err;
  } finally {
    deadline.clear();
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(`GET ${path} failed (${res.status})`, res.status, text);
  }
  // Content-Length is a CORS-safelisted response header, so it is readable
  // cross-origin; it only matches the byte count we see when the body is not
  // compressed in transit.
  const encoded = !!res.headers.get('content-encoding');
  const lenHeader = res.headers.get('content-length');
  const total = !encoded && lenHeader && /^\d+$/.test(lenHeader) ? Number(lenHeader) : null;

  let text: string;
  if (!res.body) {
    text = await res.text();
    opts.onProgress?.({ received: text.length, total });
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parts: string[] = [];
    let received = 0;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let stalled = false;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      if (stallTimeoutMs > 0) {
        stallTimer = setTimeout(() => {
          stalled = true;
          void reader.cancel().catch(() => undefined);
        }, stallTimeoutMs);
      }
    };
    const onAbort = () => void reader.cancel().catch(() => undefined);
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    try {
      armStall();
      opts.onProgress?.({ received: 0, total });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          parts.push(decoder.decode(value, { stream: true }));
          opts.onProgress?.({ received, total });
          armStall();
        }
      }
      parts.push(decoder.decode());
    } catch (err) {
      if (stalled) throw new TimeoutError(`${url} stalled: no data for ${Math.round(stallTimeoutMs / 1000)}s after ${formatBytes(received)}`, url);
      throw err;
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
    if (stalled) throw new TimeoutError(`${url} stalled: no data for ${Math.round(stallTimeoutMs / 1000)}s after ${formatBytes(received)}`, url);
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    text = parts.join('');
  }
  opts.onParsing?.();
  return JSON.parse(text) as T;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export const api = {
  /**
   * All node definitions. Tens of MB on servers with many custom node packs,
   * so it streams with progress and is cached by the server store.
   */
  getObjectInfo: (opts?: LargeFetchOptions) => fetchLargeJson<ObjectInfo>('/object_info', opts),

  getSystemStats: (opts?: { signal?: AbortSignal; timeoutMs?: number }) =>
    request<SystemStats>('/system_stats', { signal: opts?.signal, timeoutMs: opts?.timeoutMs ?? 12_000 }),

  getEmbeddings: () => request<string[]>('/embeddings'),

  /** Lists files for a model folder, e.g. "checkpoints", "loras", "vae". */
  getModels: (folder: string, opts?: { signal?: AbortSignal }) =>
    request<string[]>(`/models/${encodeURIComponent(folder)}`, { signal: opts?.signal, timeoutMs: 30_000 }),

  getModelFolders: () => request<string[]>('/models', { timeoutMs: 30_000 }),

  /**
   * Lists files under a user-data directory (ComfyUI `app/user_manager.py`,
   * `GET /api/userdata?dir=…&recurse=true&full_info=true`). Newer servers
   * return `{path,size,modified}` objects; older ones plain relative paths —
   * `parseUserdataList` accepts both. 404 means the directory does not exist
   * yet (e.g. no workflow was ever saved), which callers treat as empty.
   */
  listUserdata: (dir: string, recurse = true) =>
    request<UserdataListEntry[]>(`/api/userdata?dir=${encodeURIComponent(dir)}&recurse=${recurse ? 'true' : 'false'}&full_info=true`),

  /**
   * Reads one user-data file. The whole relative path is a single URL segment
   * (`/api/userdata/workflows%2Fmy%20flow.json`). The server sends it as an
   * attachment; the body is still plain text/JSON.
   */
  getUserdata: (path: string) => request<unknown>(`/api/userdata/${encodeURIComponent(path)}`),

  getQueue: () => request<QueueResponse>('/queue', { timeoutMs: 20_000 }),

  getHistory: (maxItems = 64) => request<History>(`/history?max_items=${maxItems}`, { timeoutMs: 30_000 }),

  /** Submits an API prompt. Resolves to the prompt id; rejects with ApiError
   *  whose `body` is a PromptErrorResponse when validation fails (400).
   *  `timeoutMs` aborts when no response headers arrive (0 waits forever). */
  queuePrompt: (prompt: ApiPrompt, clientId: string, workflow?: unknown, front = false, timeoutMs = 0) =>
    request<PromptResponse>('/prompt', {
      method: 'POST',
      timeoutMs,
      // Bytes, not a string. WebKit's Request throws if a string argument
      // contains angle brackets such as "<Picture 1>".
      body: new TextEncoder().encode(JSON.stringify({
        prompt,
        client_id: clientId,
        front: front || undefined,
        extra_data: workflow ? { extra_pnginfo: { workflow } } : undefined,
      })),
    }),

  interrupt: () => request<unknown>('/interrupt', { method: 'POST' }),

  deleteQueueItems: (ids: string[]) =>
    request<unknown>('/queue', { method: 'POST', body: JSON.stringify({ delete: ids }) }),

  clearQueue: () =>
    request<unknown>('/queue', { method: 'POST', body: JSON.stringify({ clear: true }) }),

  deleteHistoryItems: (ids: string[]) =>
    request<unknown>('/history', { method: 'POST', body: JSON.stringify({ delete: ids }) }),

  clearHistory: () =>
    request<unknown>('/history', { method: 'POST', body: JSON.stringify({ clear: true }) }),

  /** Multipart upload to the server's input folder. */
  uploadImage: async (file: File | Blob, filename?: string, overwrite = true) => {
    const form = new FormData();
    form.append('image', file, filename ?? (file instanceof File ? file.name : 'upload.png'));
    form.append('overwrite', overwrite ? 'true' : 'false');
    form.append('type', 'input');
    return request<UploadResponse>('/upload/image', { method: 'POST', body: form });
  },

  /** Builds a /view URL for an image reference. */
  viewUrl: (img: ImageRef, preview?: string) => {
    const q = new URLSearchParams({
      filename: img.filename,
      subfolder: img.subfolder ?? '',
      type: img.type ?? 'output',
    });
    if (preview) q.set('preview', preview);
    return `${absoluteServerUrl('/view')}?${q.toString()}`;
  },
};

export function isPromptError(body: unknown): body is PromptErrorResponse {
  return !!body && typeof body === 'object' && 'error' in (body as Record<string, unknown>);
}
