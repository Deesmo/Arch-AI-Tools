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
  const base = baseUrl();
  const ws = base.replace(/^http/i, 'ws');
  return `${ws}/ws?clientId=${encodeURIComponent(clientId)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body && !(init.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(init?.headers ?? {}),
    },
  });
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

export const api = {
  /** All node definitions (large payload, cached by the server store). */
  getObjectInfo: () => request<ObjectInfo>('/object_info'),

  getSystemStats: () => request<SystemStats>('/system_stats'),

  getEmbeddings: () => request<string[]>('/embeddings'),

  /** Lists files for a model folder, e.g. "checkpoints", "loras", "vae". */
  getModels: (folder: string) => request<string[]>(`/models/${encodeURIComponent(folder)}`),

  getModelFolders: () => request<string[]>('/models'),

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

  getQueue: () => request<QueueResponse>('/queue'),

  getHistory: (maxItems = 64) => request<History>(`/history?max_items=${maxItems}`),

  /** Submits an API prompt. Resolves to the prompt id; rejects with ApiError
   *  whose `body` is a PromptErrorResponse when validation fails (400). */
  queuePrompt: (prompt: ApiPrompt, clientId: string, workflow?: unknown, front = false) =>
    request<PromptResponse>('/prompt', {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        client_id: clientId,
        front: front || undefined,
        extra_data: workflow ? { extra_pnginfo: { workflow } } : undefined,
      }),
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
    return `${baseUrl()}/view?${q.toString()}`;
  },
};

export function isPromptError(body: unknown): body is PromptErrorResponse {
  return !!body && typeof body === 'object' && 'error' in (body as Record<string, unknown>);
}
