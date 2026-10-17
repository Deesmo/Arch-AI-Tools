/**
 * Video Studio thumbnails — the existing card pictures the phone shows in
 * My Studio (LoRA Lab, Workflows, Copy cards).
 *
 * Video Studio on the Mac mini already serves them on
 * `http://100.89.112.7:8140` (tailnet). The app READS those APIs and points
 * `<img>` / `<video>` straight at the 8140 URLs; nothing is copied into the
 * bundle or the repo. Contract (paths are fixed, payload shapes are read
 * leniently because we never see the live data):
 *
 *   GET /api/guide-data                  previews[<key>].file → /lora-previews/<file>   (1,323; matched by file name)
 *   GET /config/lora_cards.json          cards.*.options[].preview.url → /lora-previews/<file>
 *   GET /api/workflows/cards             library[].card.thumb + examples[] → /workflow-card-media/wf_<id>.<ext>
 *   GET /api/copies/cards                workflows[].preview.{poster,video} → /copy-previews/<id>.{jpg,mp4}
 *
 * Video Studio's own image/video libraries are NOT imported: the app's
 * Gallery tab shows this app's ComfyUI outputs instead.
 *
 * Absolute URLs found in any payload (model-site thumbnails) are ignored:
 * the only host we load from is the configured Video Studio base.
 *
 * PIN (pin_gate.py): 8140 gates every route off-localhost with
 * `401 {"error":"pin required"}`; a client unlocks with `POST /pin {"pin"}`
 * → `200 {"ok":true}` + `Set-Cookie: vs_pin`, then sends `Cookie: vs_pin=…`.
 * The phone talks to 8140 directly: every fetch() uses
 * `credentials: 'include'` so the browser stores and replays that cookie,
 * and `<img>`/`<video>` tags on the same site (same host, other port) send
 * it by themselves. There is no proxy and no bridge. The PIN itself stays on
 * the device (settings store), is sent only to `/pin`, is never logged and
 * never enters the bundle. {@link STUDIO_AUTH} names the route and cookie.
 */
import type { MediaRef, Visual } from './schema';
import { loraKey } from './triggers';

/** Video Studio on the Mac mini (tailnet). */
export const DEFAULT_VIDEO_STUDIO_URL = 'http://100.89.112.7:8140';

/**
 * Auth contract with Video Studio (pin_gate.py).
 *  - `pinPath`: POST `{"pin"}` here → `200 {"ok":true}` + `Set-Cookie: vs_pin`
 *  - `cookie`:  the cookie the browser then sends on every request (documentation;
 *               the app never reads or writes it — `credentials: 'include'` does)
 */
export const STUDIO_AUTH = {
  pinPath: '/pin',
  cookie: 'vs_pin',
} as const;

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** `host[:port][/prefix]` → `http://host[:port][/prefix]` with no trailing slash; empty → default. */
export function normalizeVideoStudioUrl(input: string): string {
  let u = (input ?? '').trim();
  if (!u) return DEFAULT_VIDEO_STUDIO_URL;
  if (!/^[a-z]+:\/\//i.test(u)) u = `http://${u}`;
  try {
    const url = new URL(u);
    url.hash = '';
    url.search = '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return DEFAULT_VIDEO_STUDIO_URL;
  }
}

/** Encodes each path segment once (a segment that is already percent-encoded is left alone). */
function encodePath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      let plain = seg;
      try {
        plain = decodeURIComponent(seg);
      } catch {
        /* keep raw */
      }
      return encodeURIComponent(plain);
    })
    .join('/');
}

/** Absolute URL on the Video Studio server for a server-side path such as `/images/a.png`. */
export function studioUrl(base: string | null | undefined, path: string | null | undefined): string | null {
  if (!base || !path || !path.startsWith('/')) return null;
  const [p, q] = path.split('?');
  return `${base.replace(/\/+$/, '')}${encodePath(p)}${q ? `?${q}` : ''}`;
}

/** Media URL for `<img>`/`<video>` (the browser attaches the vs_pin cookie itself). */
export function studioMediaUrl(base: string | null | undefined, path: string | null | undefined): string | null {
  return studioUrl(base, path);
}

/** fetch() init that carries the vs_pin cookie: `credentials: 'include'`, JSON accept, no cache. */
export function withCredentials(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers ?? {});
  headers.set('accept', 'application/json');
  return { ...init, headers, credentials: 'include', cache: 'no-store' };
}

/**
 * POST the PIN to Video Studio. Resolves when it answered `200 {"ok":true}`
 * (the browser has stored the `vs_pin` cookie at that point). Throws
 * `kind: 'pin'` when the PIN is rejected. The PIN is used for the request
 * body only and is not retained here.
 */
export async function unlockStudio(base: string, pin: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<void> {
  const url = studioUrl(base, STUDIO_AUTH.pinPath);
  if (!url) throw new VideoStudioError('http', 'Bad Video Studio URL.');
  const init = withCredentials({ method: 'POST', body: JSON.stringify({ pin }), headers: { 'content-type': 'application/json' } });
  const res = await fetchImpl(url, init);
  const text = await res.text();
  if (res.status === 401 || res.status === 403) throw new VideoStudioError('pin', 'Video Studio did not accept that PIN.', res.status);
  if (!res.ok) throw new VideoStudioError('http', `Video Studio answered HTTP ${res.status} for ${STUDIO_AUTH.pinPath}.`, res.status);
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new VideoStudioError('not-json', `Video Studio returned something that is not JSON for ${STUDIO_AUTH.pinPath}.`, res.status);
  }
  if (json.ok === false) throw new VideoStudioError('pin', 'Video Studio did not accept that PIN.', res.status);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type StudioErrorKind = 'pin' | 'not-json' | 'http' | 'network' | 'mixed-content';

export class VideoStudioError extends Error {
  constructor(
    public kind: StudioErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'VideoStudioError';
  }
}

/** True when the body is the PIN gate rather than data (`401 {"error":"pin required"}`, a PIN page, 403). */
export function looksLikePinGate(text: string, status: number, contentType = ''): boolean {
  if (status === 401 || status === 403) return true;
  const head = text.slice(0, 4000);
  const trimmed = head.trimStart();
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      const err = String(j.error ?? j.message ?? j.detail ?? '');
      return /\bpin\b|passcode|unauthori[sz]ed|locked/i.test(err);
    } catch {
      /* not JSON */
    }
  }
  const html = /text\/html/i.test(contentType) || trimmed.startsWith('<');
  return html && /\bpin\b|passcode|enter (the )?code|unlock/i.test(head);
}

/** One sentence for the UI. Never includes the PIN. */
export function describeStudioError(err: unknown, base: string): string {
  if (err instanceof VideoStudioError) return err.message;
  if (err instanceof TypeError) {
    const pageHttps = typeof location !== 'undefined' && location.protocol === 'https:';
    if (pageHttps && base.startsWith('http://')) return `Blocked: this page is https and ${base} is http (mixed content).`;
    return `Could not reach Video Studio at ${base} (not running, no tailnet, or it did not allow this page's origin with credentials).`;
  }
  return (err as Error)?.message ?? String(err);
}

/** Classifies a thrown value so the UI can decide between a PIN prompt and a plain error. */
export function studioErrorKind(err: unknown): StudioErrorKind {
  if (err instanceof VideoStudioError) return err.kind;
  if (err instanceof TypeError) {
    const pageHttps = typeof location !== 'undefined' && location.protocol === 'https:';
    return pageHttps ? 'mixed-content' : 'network';
  }
  return 'network';
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * GETs a JSON route on the Video Studio server. Throws {@link VideoStudioError}
 * with `kind: 'pin'` for the PIN gate, `'not-json'` when the body is HTML or
 * otherwise unparsable, `'http'` for other non-2xx statuses.
 */
export async function fetchStudioJson(base: string, path: string, fetchImpl: FetchLike = (u, i) => fetch(u, i)): Promise<unknown> {
  const url = studioUrl(base, path);
  if (!url) throw new VideoStudioError('http', `Bad Video Studio path ${path}`);
  const res = await fetchImpl(url, withCredentials());
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (looksLikePinGate(text, res.status, contentType)) {
    throw new VideoStudioError('pin', 'Video Studio wants your PIN.', res.status);
  }
  if (!res.ok) throw new VideoStudioError('http', `Video Studio answered HTTP ${res.status} for ${path}.`, res.status);
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const what = /text\/html/i.test(contentType) || trimmed.startsWith('<') ? 'an HTML page' : contentType ? `${contentType.split(';')[0]}` : 'something that is not JSON';
    throw new VideoStudioError('not-json', `Video Studio returned ${what} for ${path}, not JSON.`, res.status);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new VideoStudioError('not-json', `Video Studio returned invalid JSON for ${path}.`, res.status);
  }
}

// ---------------------------------------------------------------------------
// Payload readers (lenient)
// ---------------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;
const MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|mp4|m4v|mov|webm|mkv)$/i;

export const mediaKindOf = (p: string): MediaRef['kind'] | undefined => (IMAGE_EXT.test(p) ? 'image' : VIDEO_EXT.test(p) ? 'video' : undefined);

/**
 * A media reference from a payload → server path. Absolute URLs (model-site
 * thumbnails) and anything with `..` are dropped; a bare file name is placed
 * under `dir`; a path that already starts with `/` is used as-is.
 */
export function localMediaPath(value: unknown, dir: string): string | undefined {
  let v: unknown = value;
  if (isObj(v)) v = v.url ?? v.path ?? v.file ?? v.src ?? v.name;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || s.length > 1024) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') || s.includes('\\')) return undefined;
  const path = s.startsWith('/') ? s.replace(/\/{2,}/g, '/') : `${dir.replace(/\/+$/, '')}/${s.replace(/^\.?\//, '')}`;
  if (path.split('/').some((seg) => seg === '..')) return undefined;
  return path;
}

/** Finds the list in a payload: a bare array, or the first array under one of `keys`. */
function pickList(json: unknown, keys: string[]): unknown[] {
  if (Array.isArray(json)) return json;
  if (!isObj(json)) return [];
  for (const k of keys) if (Array.isArray(json[k])) return json[k] as unknown[];
  for (const v of Object.values(json)) if (Array.isArray(v) && v.length && (typeof v[0] === 'string' || isObj(v[0]))) return v;
  return [];
}

/** Key used to match LoRA previews: file stem, lower-case, media and model extensions stripped. */
export const previewKey = (s: string): string => loraKey(s.replace(MEDIA_EXT, ''));

/**
 * `/api/guide-data` → `previews[<key>].file` and `/config/lora_cards.json` →
 * `cards.*.options[].preview.url`, both pointing into `/lora-previews/`.
 * Returns LoRA key → server path.
 */
export function parseLoraPreviews(guideData: unknown, loraCards: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (key: string | undefined, path: string | undefined) => {
    if (!key || !path) return;
    const k = previewKey(key);
    if (k && !(k in out)) out[k] = path;
  };
  const previews = isObj(guideData) ? guideData.previews : undefined;
  if (isObj(previews)) {
    for (const [key, v] of Object.entries(previews)) {
      const file = isObj(v) ? (v.file ?? v.url ?? v.path) : v;
      const path = localMediaPath(file, '/lora-previews');
      add(key, path);
      if (typeof file === 'string') add(file.split('/').pop(), path);
    }
  } else if (Array.isArray(previews)) {
    for (const v of previews) {
      if (!isObj(v)) continue;
      const path = localMediaPath(v.file ?? v.url ?? v.path, '/lora-previews');
      add(optStr(v.key ?? v.lora ?? v.name ?? v.file), path);
    }
  }
  const cards = isObj(loraCards) ? loraCards.cards : undefined;
  const cardList: [string | undefined, unknown][] = isObj(cards) ? Object.entries(cards) : Array.isArray(cards) ? cards.map((c) => [undefined, c] as [undefined, unknown]) : [];
  for (const [cardKey, card] of cardList) {
    if (!isObj(card)) continue;
    const options = Array.isArray(card.options) ? card.options : [];
    for (const opt of options) {
      if (!isObj(opt)) continue;
      const path = localMediaPath(isObj(opt.preview) ? (opt.preview.url ?? opt.preview.file ?? opt.preview.path) : opt.preview, '/lora-previews');
      if (!path) continue;
      for (const k of [opt.file, opt.filename, opt.lora, opt.name, opt.value]) add(optStr(k), path);
    }
    // A card-level preview applies to the card's own file/name.
    const own = localMediaPath(isObj(card.preview) ? (card.preview.url ?? card.preview.file) : card.preview, '/lora-previews');
    if (own) for (const k of [card.file, card.filename, card.name, cardKey]) add(optStr(k), own);
  }
  return out;
}

/** Lower-case alphanumerics only, model/media/json extension stripped — how workflow and copy names are matched. */
export function matchKey(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/\\/g, '/')
    .split('/')
    .pop()!
    .replace(/\.(json|png|jpe?g|webp|mp4|txt|yaml|yml)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export interface StudioMediaRef {
  path: string;
  kind: MediaRef['kind'];
  poster?: string;
}

export interface StudioWorkflowCard {
  id: string;
  name?: string;
  thumb?: string;
  /** 0–9 extra stills/clips under `/workflow-card-media/`. */
  examples: StudioMediaRef[];
}

export interface StudioCopyCard {
  id: string;
  title?: string;
  poster?: string;
  video?: string;
}

function studioRef(value: unknown, dir: string): StudioMediaRef | undefined {
  const path = localMediaPath(value, dir);
  if (!path) return undefined;
  const kind = mediaKindOf(path) ?? (isObj(value) && optStr(value.kind) === 'video' ? 'video' : 'image');
  const poster = isObj(value) ? localMediaPath(value.poster ?? value.thumb, dir) : undefined;
  return { path, kind, poster: poster && mediaKindOf(poster) === 'image' ? poster : undefined };
}

/** `/api/workflows/cards` → cards indexed by every key a bundle workflow might match on. */
export function parseWorkflowCards(json: unknown): { list: StudioWorkflowCard[]; byKey: Record<string, StudioWorkflowCard> } {
  const list: StudioWorkflowCard[] = [];
  const byKey: Record<string, StudioWorkflowCard> = {};
  const root = isObj(json) ? json : {};
  for (const x of pickList(root.library ?? root.cards ?? root.workflows ?? json, ['library', 'cards', 'workflows', 'items'])) {
    if (!isObj(x)) continue;
    const card = isObj(x.card) ? x.card : x;
    const id = optStr(x.id ?? card.id ?? x.key) ?? '';
    const name = optStr(x.name ?? x.title ?? card.title ?? card.name ?? x.file ?? x.filename ?? x.path);
    const thumb = localMediaPath(card.thumb ?? card.thumbnail ?? card.poster ?? x.thumb, '/workflow-card-media');
    const examplesRaw = Array.isArray(card.examples) ? card.examples : Array.isArray(x.examples) ? x.examples : [];
    const examples: StudioMediaRef[] = [];
    const seen = new Set<string>();
    for (const e of examplesRaw) {
      const r = studioRef(e, '/workflow-card-media');
      if (r && !seen.has(r.path) && r.path !== thumb) {
        seen.add(r.path);
        examples.push(r);
      }
    }
    if (!id && !name) continue;
    if (!thumb && !examples.length) continue;
    const entry: StudioWorkflowCard = { id: id || matchKey(name), name, thumb, examples: examples.slice(0, 9) };
    list.push(entry);
    const keys = new Set<string>();
    if (id) {
      keys.add(id.toLowerCase());
      keys.add(`wf_${id}`.toLowerCase());
      keys.add(matchKey(id));
    }
    for (const n of [name, optStr(x.file ?? x.filename ?? x.path), optStr(card.title), optStr(x.title)]) if (n) keys.add(matchKey(n));
    for (const k of keys) if (k && !(k in byKey)) byKey[k] = entry;
  }
  return { list, byKey };
}

/** `/api/copies/cards` → copy cards indexed by id and normalised title. */
export function parseCopyCards(json: unknown): { list: StudioCopyCard[]; byKey: Record<string, StudioCopyCard> } {
  const list: StudioCopyCard[] = [];
  const byKey: Record<string, StudioCopyCard> = {};
  const root = isObj(json) ? json : {};
  for (const x of pickList(root.workflows ?? root.cards ?? root.copies ?? json, ['workflows', 'cards', 'copies', 'items'])) {
    if (!isObj(x)) continue;
    const id = optStr(x.id ?? x.key) ?? '';
    const title = optStr(x.title ?? x.name);
    const preview = isObj(x.preview) ? x.preview : x;
    let poster = localMediaPath(preview.poster ?? preview.thumb ?? preview.image, '/copy-previews');
    let video = localMediaPath(preview.video ?? preview.mp4 ?? preview.clip, '/copy-previews');
    if (poster && mediaKindOf(poster) === 'video') [poster, video] = [undefined, video ?? poster];
    if (video && mediaKindOf(video) === 'image') [poster, video] = [poster ?? video, undefined];
    if (!id && !title) continue;
    if (!poster && !video) continue;
    const entry: StudioCopyCard = { id: id || matchKey(title), title, poster, video };
    list.push(entry);
    const keys = new Set<string>();
    if (id) {
      keys.add(id.toLowerCase());
      keys.add(matchKey(id));
    }
    if (title) keys.add(matchKey(title));
    for (const k of keys) if (k && !(k in byKey)) byKey[k] = entry;
  }
  return { list, byKey };
}

// ---------------------------------------------------------------------------
// Card media index + matching into the bundle
// ---------------------------------------------------------------------------

export interface StudioCardMedia {
  loraPreviews: Record<string, string>;
  workflows: Record<string, StudioWorkflowCard>;
  copies: Record<string, StudioCopyCard>;
  counts: { loras: number; workflows: number; copies: number };
}

export function emptyCardMedia(): StudioCardMedia {
  return { loraPreviews: {}, workflows: {}, copies: {}, counts: { loras: 0, workflows: 0, copies: 0 } };
}

export function buildCardMedia(parts: { guideData?: unknown; loraCards?: unknown; workflowCards?: unknown; copyCards?: unknown }): StudioCardMedia {
  const loraPreviews = parseLoraPreviews(parts.guideData, parts.loraCards);
  const wf = parseWorkflowCards(parts.workflowCards);
  const cp = parseCopyCards(parts.copyCards);
  return { loraPreviews, workflows: wf.byKey, copies: cp.byKey, counts: { loras: Object.keys(loraPreviews).length, workflows: wf.list.length, copies: cp.list.length } };
}

export function studioLoraPreview(media: StudioCardMedia, fileOrKey: string | undefined | null): string | undefined {
  return fileOrKey ? media.loraPreviews[previewKey(fileOrKey)] : undefined;
}

export function studioWorkflowFor(media: StudioCardMedia, wf: { id: string; name: string; source?: string }): StudioWorkflowCard | undefined {
  const candidates = [wf.id.toLowerCase(), matchKey(wf.id), matchKey(wf.name), matchKey(wf.source?.split('#')[0])];
  for (const k of candidates) if (k && media.workflows[k]) return media.workflows[k];
  return undefined;
}

export function studioCopyFor(media: StudioCardMedia, c: { id: string; title: string }): StudioCopyCard | undefined {
  const candidates = [c.id.toLowerCase(), matchKey(c.id), matchKey(c.title)];
  for (const k of candidates) if (k && media.copies[k]) return media.copies[k];
  return undefined;
}

/**
 * Lays Video Studio media over a bundle record's visuals: the studio thumb
 * wins, studio examples come first, the bundle's own examples follow. URLs
 * are absolute 8140 URLs; the bundle paths stay for the `/media/` fallback.
 */
export function withStudioVisual(base: Visual, studio: { thumb?: string; examples?: StudioMediaRef[] } | undefined, baseUrl: string): Visual {
  if (!studio || (!studio.thumb && !studio.examples?.length)) return base;
  const url = (p: string | undefined) => studioMediaUrl(baseUrl, p) ?? undefined;
  const examples: MediaRef[] = [];
  const seen = new Set<string>();
  for (const e of studio.examples ?? []) {
    if (seen.has(e.path)) continue;
    seen.add(e.path);
    examples.push({ path: e.path, kind: e.kind, poster: e.poster, url: url(e.path), posterUrl: url(e.poster), label: e.path.split('/').pop() });
  }
  for (const e of base.examples) if (!seen.has(e.path)) examples.push(e);
  const thumbUrl = url(studio.thumb) ?? examples.find((e) => e.kind === 'image' && e.url)?.url ?? examples.find((e) => e.posterUrl)?.posterUrl;
  return { ...base, examples: examples.slice(0, 12), thumbUrl };
}
