/**
 * Same-origin My Studio pictures.
 *
 * The page loads one file, `/studio-thumbs/index.json`, and the pictures it
 * names under `/studio-thumbs/`. The Mac copies those into
 * `public/studio-thumbs` before it serves the phone page. This module never
 * calls another host, sends a cookie, or asks for a PIN.
 */

import { joinHttpUrl } from '../httpUrl';

export const STUDIO_THUMBS_INDEX = '/studio-thumbs/index.json';
export const STUDIO_THUMBS_ROOT = '/studio-thumbs/';

/** The only line the tab shows when that file is not in this build. */
export const MISSING_PICTURES = 'pictures are not in this build.';

export interface StudioThumbFields {
  model?: string;
  author?: string;
  duration?: string;
  /** A Civitai id, when the index has one. Never a URL. */
  civitaiId?: string;
}

export interface StudioThumbLora extends StudioThumbFields {
  name: string;
  file: string;
  thumb: string | null;
  trigger: string;
  rating: number | null;
  favorite: boolean;
}

/** Fields the Mac adds so a card can be queued without opening the graph. */
export interface StudioRunFields {
  /** Path relative to `/studio-thumbs/`, or null when this card has no workflow in the build. */
  workflowFile: string | null;
  prompt: string;
  promptNodeId: number | null;
  promptField: string | null;
  imageNodeId: number | null;
  imageField: string | null;
}

export interface StudioThumbWorkflow extends StudioThumbFields, StudioRunFields {
  name: string;
  thumb: string | null;
  examples: string[];
  favorite: boolean;
}

export interface StudioThumbCopy extends StudioThumbFields, StudioRunFields {
  name: string;
  poster: string | null;
  preview: string | null;
  examples: string[];
  favorite: boolean;
}

export interface StudioThumbCatalog {
  loras: StudioThumbLora[];
  workflows: StudioThumbWorkflow[];
  copies: StudioThumbCopy[];
}

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i;

export function isVideoPath(path: string): boolean {
  return VIDEO_EXT.test(path);
}

/**
 * A path from the index, relative to `/studio-thumbs/`, as a same-origin URL.
 * Absolute URLs, protocol-relative URLs, and `..` are dropped.
 */
export function studioThumbUrl(path: string | null | undefined): string | null {
  if (typeof path !== 'string') return null;
  let p = path.trim();
  if (!p || /^[a-z][a-z0-9+.-]*:/i.test(p) || p.startsWith('//') || p.includes('\\') || p.includes('..')) return null;
  p = p.replace(/^\.\/+/, '').replace(/^\/+/, '');
  if (p.toLowerCase().startsWith('studio-thumbs/')) p = p.slice('studio-thumbs/'.length);
  const encoded = p
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      let plain = seg;
      try {
        plain = decodeURIComponent(seg);
      } catch {
        /* keep the raw segment */
      }
      if (!plain || plain === '.' || plain === '..') return '';
      return encodeURIComponent(plain);
    })
    .filter(Boolean)
    .join('/');
  return encoded ? `${STUDIO_THUMBS_ROOT}${encoded}` : null;
}

function pageOrigin(): string {
  const origin = typeof location !== 'undefined' && typeof location.origin === 'string' ? location.origin : '';
  if (!origin || origin === 'null') return 'http://127.0.0.1';
  return origin;
}

/**
 * A same-origin studio path as an absolute http(s) URL.
 * iPhone Safari throws "The string did not match the expected pattern" from
 * `fetch` / `new Request` when the string is only a path. Prompt text is refused
 * before it can reach `new URL`.
 */
export function absoluteStudioUrl(path: string, origin?: string): string {
  if (/^https?:\/\//i.test(path)) {
    if (/[<>\s]/.test(path)) throw new Error('Refusing to read a prompt as a URL');
    return path;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) throw new Error('Refusing to read a prompt as a URL');
  const rooted = path.startsWith('/') ? path : `/${path}`;
  return joinHttpUrl(origin ?? pageOrigin(), rooted);
}

/** A filename Safari will accept in a multipart upload. */
export function safeUploadName(name: string): string {
  const base = name.split(/[/\\]/).filter(Boolean).pop() ?? 'image.png';
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+$/, '');
  return clean || 'image.png';
}

/** Blob types like `image/png; charset=utf-8` fail Safari's MIME check. */
export function safeImageType(type: string): string {
  const base = type.split(';')[0]?.trim().toLowerCase() ?? '';
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(base) ? base : 'image/png';
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function text(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t || undefined;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function favoriteOf(o: Record<string, unknown>): boolean {
  return o.favorite === true || o.favourite === true;
}

function ratingOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function triggerOf(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()).join(', ');
  return '';
}

/** A relative path, or null when it would leave `/studio-thumbs/`. */
function pathOf(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return studioThumbUrl(v) ? v.trim() : null;
  const o = asRecord(v);
  if (!o) return null;
  const p = text(o.path) ?? text(o.file) ?? text(o.src);
  return p && studioThumbUrl(p) ? p : null;
}

function pathList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const p = pathOf(item);
    if (p) out.push(p);
  }
  return out;
}

function nodeIdOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) return Number(v.trim());
  return null;
}

function fieldName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t || null;
}

/** A workflow path that stays under `/studio-thumbs/`, stored relative to that root. */
function workflowFileOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const url = studioThumbUrl(v);
  if (!url?.startsWith(STUDIO_THUMBS_ROOT)) return null;
  return url
    .slice(STUDIO_THUMBS_ROOT.length)
    .split('/')
    .map((seg) => {
      try {
        return decodeURIComponent(seg);
      } catch {
        return seg;
      }
    })
    .join('/');
}

function runFields(o: Record<string, unknown>): StudioRunFields {
  return {
    workflowFile: workflowFileOf(o.workflowFile),
    prompt: typeof o.prompt === 'string' ? o.prompt : '',
    promptNodeId: nodeIdOf(o.promptNodeId),
    promptField: fieldName(o.promptField),
    imageNodeId: nodeIdOf(o.imageNodeId),
    imageField: fieldName(o.imageField),
  };
}

function extras(o: Record<string, unknown>): StudioThumbFields {
  const model = text(o.model);
  const author = text(o.author);
  const duration = text(o.duration);
  let civitaiId = text(o.civitaiId) ?? text(o.civitai_id);
  if (!civitaiId) {
    const civ = asRecord(o.civitai);
    if (civ) civitaiId = text(civ.id) ?? text(civ.modelId);
  }
  if (typeof o.civitai === 'number' || typeof o.civitai === 'string') civitaiId = civitaiId ?? text(o.civitai);
  const extra: StudioThumbFields = {};
  if (model) extra.model = model;
  if (author) extra.author = author;
  if (duration) extra.duration = duration;
  if (civitaiId && !civitaiId.includes('://') && !civitaiId.startsWith('//')) extra.civitaiId = civitaiId;
  return extra;
}

export function parseStudioThumbIndex(data: unknown): StudioThumbCatalog {
  const root = asRecord(data) ?? {};
  const loras: StudioThumbLora[] = [];
  for (const item of Array.isArray(root.loras) ? root.loras : []) {
    const o = asRecord(item);
    if (!o) continue;
    const name = text(o.name);
    if (!name) continue;
    loras.push({
      name,
      file: text(o.file) ?? '',
      thumb: pathOf(o.thumb),
      trigger: triggerOf(o.trigger ?? o.triggers ?? o.triggerWords),
      rating: ratingOf(o.rating),
      favorite: favoriteOf(o),
      ...extras(o),
    });
  }
  const workflows: StudioThumbWorkflow[] = [];
  for (const item of Array.isArray(root.workflows) ? root.workflows : []) {
    const o = asRecord(item);
    if (!o) continue;
    const name = text(o.name);
    if (!name) continue;
    workflows.push({
      name,
      thumb: pathOf(o.thumb),
      examples: pathList(o.examples),
      favorite: favoriteOf(o),
      ...extras(o),
      ...runFields(o),
    });
  }
  const copies: StudioThumbCopy[] = [];
  for (const item of Array.isArray(root.copies) ? root.copies : []) {
    const o = asRecord(item);
    if (!o) continue;
    const name = text(o.name) ?? text(o.title) ?? text(o.civitaiId) ?? workflowFileOf(o.workflowFile);
    if (!name) continue;
    copies.push({
      name,
      poster: pathOf(o.poster),
      preview: pathOf(o.preview),
      examples: pathList(o.examples),
      favorite: favoriteOf(o),
      ...extras(o),
      ...runFields(o),
    });
  }
  return { loras, workflows, copies };
}

export function catalogHasPictures(catalog: StudioThumbCatalog): boolean {
  return catalog.loras.length + catalog.workflows.length + catalog.copies.length > 0;
}

export type StudioThumbsResult = { ok: true; catalog: StudioThumbCatalog } | { ok: false; missing: true };

/** GET the index. A missing file, a bad body, or an empty catalog is `missing`. */
export async function loadStudioThumbs(fetchImpl: typeof fetch = fetch): Promise<StudioThumbsResult> {
  try {
    const res = await fetchImpl(absoluteStudioUrl(STUDIO_THUMBS_INDEX), { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return { ok: false, missing: true };
    const catalog = parseStudioThumbIndex(await res.json());
    if (!catalogHasPictures(catalog)) return { ok: false, missing: true };
    return { ok: true, catalog };
  } catch {
    return { ok: false, missing: true };
  }
}

/** The clip a copy card plays: `preview`, otherwise the first example. */
export function copyMainClip(card: StudioThumbCopy): { src: string; poster: string | null } | null {
  const poster = studioThumbUrl(card.poster);
  const raw = card.preview ?? card.examples.find((p) => studioThumbUrl(p)) ?? null;
  const src = studioThumbUrl(raw);
  return src ? { src, poster } : null;
}

/** Example files other than the clip that is already playing. */
export function copyExtras(card: StudioThumbCopy): string[] {
  const main = copyMainClip(card)?.src ?? null;
  const out: string[] = [];
  for (const ex of card.examples) {
    const src = studioThumbUrl(ex);
    if (src && src !== main) out.push(src);
  }
  return out;
}

/**
 * Still image for a LoRA or workflow card.
 * A null workflow thumb falls through to the first example that is not a video.
 */
export function cardImage(thumb: string | null, examples: string[] = []): string | null {
  for (const candidate of [thumb, ...examples]) {
    if (!candidate || isVideoPath(candidate)) continue;
    const src = studioThumbUrl(candidate);
    if (src) return src;
  }
  return null;
}

export function cardMeta(card: StudioThumbFields): string {
  return [card.model, card.author, card.duration, card.civitaiId ? `civitai ${card.civitaiId}` : undefined].filter(Boolean).join(' · ');
}
