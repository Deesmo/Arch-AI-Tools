/**
 * Queue a My Studio card by loading its workflow from `/studio-thumbs/` and
 * writing only the prompt and, when a new photo was picked, the image.
 * Every other widget stays as it is in the file.
 *
 * The file is either a UI graph (`{ nodes: [...] }`) or an API prompt
 * (`{ "<id>": { class_type, inputs } }`).
 */
import { jsonBytes } from '../api/client';
import type { ApiPrompt } from '../api/types';
import type { GraphNode, Workflow } from '../graph/types';
import { scrubUrlError } from '../httpUrl';
import { STUDIO_THUMBS_ROOT, absoluteStudioUrl, studioThumbUrl } from './studioThumbs';

export { scrubUrlError };

export const SETTINGS_NOT_IN_BUILD = "This card's settings are not in the build.";

/** A card whose index row has no workflow file. */
export const CARD_CANNOT_BE_BUILT = 'This card cannot be built.';

/** `/studio-thumbs/gallery.json` is missing or is not a list of pictures. */
export const GALLERY_NOT_IN_BUILD = 'The gallery is not in this build.';

/** The saved job file is not JSON we can read, including after bare NaN is lifted out. */
export const JOB_FILE_UNREADABLE = "This card's job file is unreadable.";

/** The card's saved photo is not in Skytech's ComfyUI input folder. */
export const SAVED_PHOTO_NOT_ON_SKYTECH = "Saved photo not on Skytech — pick one.";

/** Case-insensitive match. Index fields such as duration are numbers, so each value is stringified. */
export function studioSearchHit(q: string, fields: (string | number | undefined | null)[]): boolean {
  const n = q.trim().toLowerCase();
  return !n || fields.some((f) => f != null && f !== "" && String(f).toLowerCase().includes(n));
}

/**
 * Stands in for a bare NaN while the file is a JavaScript value.
 * JSON.stringify escapes the leading NUL, so the quoted form cannot collide
 * with the word NaN inside a prompt string.
 */
const NAN_SENTINEL = '\u0000__COMFY_BARE_NAN__\u0000';

/** Bare `NaN` tokens outside JSON strings become the sentinel string. Quoted text is left alone. */
export function encodeBareNan(text: string): string {
  const quoted = JSON.stringify(NAN_SENTINEL);
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\' && i + 1 < text.length) {
        out += text[i + 1];
        i += 1;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      out += c;
      continue;
    }
    if (text.startsWith('NaN', i) && bareNanAt(text, i)) {
      out += quoted;
      i += 2;
      continue;
    }
    out += c;
  }
  return out;
}

function bareNanAt(text: string, i: number): boolean {
  const prev = i > 0 ? text[i - 1] : '';
  const next = i + 3 < text.length ? text[i + 3] : '';
  return !/[A-Za-z0-9_]/.test(prev) && !/[A-Za-z0-9_]/.test(next);
}

/** Parse a job file. Bare NaN is kept as a sentinel so JSON.parse can run. */
export function parseJobFile(text: string): unknown {
  try {
    return JSON.parse(encodeBareNan(text.replace(/^\uFEFF/, '')));
  } catch (err) {
    if (err instanceof Error && err.message === JOB_FILE_UNREADABLE) throw err;
    throw new Error(JOB_FILE_UNREADABLE);
  }
}

/** JSON text with the sentinel written back as bare NaN, the form ComfyUI accepts. */
export function stringifyJobFile(value: unknown): string {
  return JSON.stringify(value).split(JSON.stringify(NAN_SENTINEL)).join('NaN');
}

export const STUDIO_GALLERY = '/studio-thumbs/gallery.json';

export interface StudioWidgetEdit {
  nodeId: number;
  field: string;
  value: string;
}

/**
 * The only writes Run is allowed to make on an API prompt.
 * Words are written when the text differs from the card and both the node id
 * and field are set. A photo is written only after one was chosen and uploaded.
 * Anything else stays as it was saved in the file.
 */
export function studioRunEdits(args: {
  words: string;
  savedWords: string;
  promptNodeId: number | null;
  promptField: string | null;
  imageName: string | null;
  imageNodeId: number | null;
  imageField: string | null;
}): { prompt: StudioWidgetEdit | null; image: StudioWidgetEdit | null } {
  const prompt =
    args.words !== args.savedWords && args.promptNodeId != null && !!args.promptField
      ? { nodeId: args.promptNodeId, field: args.promptField, value: args.words }
      : null;
  const image = args.imageName
    ? { nodeId: args.imageNodeId ?? -1, field: args.imageField ?? "", value: args.imageName }
    : null;
  return { prompt, image };
}

function patchNode(node: GraphNode, edit: StudioWidgetEdit): GraphNode | null {
  const widgets = node.widgets ?? [];
  const idx = widgets.findIndex((w) => w.name === edit.field);
  if (idx < 0) return null;
  const widgets_values = [...node.widgets_values];
  widgets_values[idx] = edit.value;
  const named = node.widgets_values_named;
  const widgets_values_named =
    named && Object.prototype.hasOwnProperty.call(named, edit.field) ? { ...named, [edit.field]: edit.value } : named;
  return { ...node, widgets_values, widgets_values_named };
}

/**
 * Writes `edit` onto the first node with that id: root nodes, then subgraph
 * inner nodes. Returns null when that node has no widget by `field`.
 */
function writeWidget(wf: Workflow, edit: StudioWidgetEdit): Workflow | null {
  if (wf.nodes.some((n) => n.id === edit.nodeId)) {
    let wrote = false;
    const nodes = wf.nodes.map((n) => {
      if (n.id !== edit.nodeId) return n;
      const next = patchNode(n, edit);
      if (!next) return n;
      wrote = true;
      return next;
    });
    return wrote ? { ...wf, nodes } : null;
  }
  const defs = wf.definitions?.subgraphs;
  if (!defs?.length) return null;
  let wrote = false;
  let missed = false;
  const subgraphs = defs.map((d) => {
    if (wrote || missed) return d;
    const idx = d.nodes.findIndex((n) => n.id === edit.nodeId);
    if (idx < 0) return d;
    const next = patchNode(d.nodes[idx], edit);
    if (!next) {
      missed = true;
      return d;
    }
    wrote = true;
    const nodes = d.nodes.slice();
    nodes[idx] = next;
    return { ...d, nodes };
  });
  if (!wrote) return null;
  return { ...wf, definitions: { subgraphs } };
}

/**
 * Applies the prompt edit and, when present, the image edit.
 * An omitted or null edit is left alone. A named widget that is not on the
 * resolved node is reported in `missed` and that part of the graph is unchanged.
 */
export function applyStudioRunEdits(
  wf: Workflow,
  edits: { prompt?: StudioWidgetEdit | null; image?: StudioWidgetEdit | null },
): { workflow: Workflow; missed: Array<'prompt' | 'image'> } {
  let workflow = wf;
  const missed: Array<'prompt' | 'image'> = [];
  for (const key of ['prompt', 'image'] as const) {
    const edit = edits[key];
    if (!edit) continue;
    const next = writeWidget(workflow, edit);
    if (!next) missed.push(key);
    else workflow = next;
  }
  return { workflow, missed };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** A text box, including Pixaroma's text node. Not every node that happens to store a string. */
export function isTextWidgetNode(type: string): boolean {
  if (type === 'PixaromaText' || type === 'Text Pixaroma') return true;
  if (/CLIPText/i.test(type)) return true;
  if (type === 'Text' || type.startsWith('Text ') || type.endsWith(' Text') || type.endsWith('Text')) return true;
  return false;
}

function widgetSlotIndex(node: Record<string, unknown>, field: string): number {
  if (!Array.isArray(node.inputs)) return -1;
  let i = 0;
  for (const input of node.inputs) {
    const slot = asRecord(input);
    const widget = slot ? asRecord(slot.widget) : null;
    const name = widget && typeof widget.name === 'string' ? widget.name : null;
    if (!name) continue;
    if (name === field) return i;
    i++;
  }
  return -1;
}

function loneStringIndex(values: unknown[]): number {
  let found = -1;
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] !== 'string') continue;
    if (found >= 0) return -1;
    found = i;
  }
  return found;
}

/**
 * Replaces the string `field` names inside `widgets_values`. A slot that is
 * not a string is left alone, and so is every other entry.
 */
function replaceStringWidget(node: Record<string, unknown>, field: string): number {
  if (!Array.isArray(node.widgets_values)) return -1;
  const values = node.widgets_values;
  const namedSlot = widgetSlotIndex(node, field);
  if (namedSlot >= 0) return typeof values[namedSlot] === 'string' ? namedSlot : -1;
  return loneStringIndex(values);
}

function patchUiNode(node: Record<string, unknown>, edit: StudioWidgetEdit, kind: 'prompt' | 'image'): boolean {
  const named = asRecord(node.widgets_values_named);
  if (named && Object.prototype.hasOwnProperty.call(named, edit.field)) {
    named[edit.field] = edit.value;
    // Keep the positional string in step when it is the same widget, so a
    // converter that still reads `widgets_values` submits the new text.
    if (Array.isArray(node.widgets_values)) {
      const idx = replaceStringWidget(node, edit.field);
      if (idx >= 0) {
        const widgets_values = node.widgets_values.slice();
        widgets_values[idx] = edit.value;
        node.widgets_values = widgets_values;
      }
    }
    return true;
  }
  const textNode = isTextWidgetNode(String(node.type ?? ''));
  if (kind === 'prompt' && !textNode) return false;
  if (!Array.isArray(node.widgets_values)) return false;
  const idx = replaceStringWidget(node, edit.field);
  if (idx < 0) return false;
  const widgets_values = node.widgets_values.slice();
  widgets_values[idx] = edit.value;
  node.widgets_values = widgets_values;
  return true;
}

function findUiNode(root: Record<string, unknown>, nodeId: number): Record<string, unknown> | null {
  const nodes = Array.isArray(root.nodes) ? root.nodes : [];
  for (const item of nodes) {
    const node = asRecord(item);
    if (node && Number(node.id) === nodeId) return node;
  }
  const definitions = asRecord(root.definitions);
  const subgraphs = definitions && Array.isArray(definitions.subgraphs) ? definitions.subgraphs : [];
  for (const item of subgraphs) {
    const def = asRecord(item);
    const inner = def && Array.isArray(def.nodes) ? def.nodes : [];
    for (const innerItem of inner) {
      const node = asRecord(innerItem);
      if (node && Number(node.id) === nodeId) return node;
    }
  }
  return null;
}

function uiGraphBody(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (Array.isArray(raw.nodes)) return raw;
  const wrapped = asRecord(raw.workflow);
  if (wrapped && Array.isArray(wrapped.nodes)) return wrapped;
  return null;
}

function isApiPrompt(raw: Record<string, unknown>): boolean {
  const vals = Object.values(raw);
  return vals.length > 0 && vals.every((v) => {
    const node = asRecord(v);
    return !!node && typeof node.class_type === 'string';
  });
}

export type PatchedStudioFile =
  | { format: 'ui'; workflow: unknown; missed: Array<'prompt' | 'image'> }
  | { format: 'api'; prompt: ApiPrompt; missed: Array<'prompt' | 'image'> }
  | { format: 'unknown'; missed: Array<'prompt' | 'image'> };

/**
 * Patches a workflow file before it is queued.
 * UI graphs: `widgets_values_named[field]` when that key exists; otherwise a
 * text node's string widget (PixaromaText included). API prompts: `inputs[field]`.
 * An omitted edit is skipped. Nothing else in the file is written.
 */
export function patchStudioRunFile(
  raw: unknown,
  edits: { prompt?: StudioWidgetEdit | null; image?: StudioWidgetEdit | null },
): PatchedStudioFile {
  const root = asRecord(raw);
  const requested = (['prompt', 'image'] as const).filter((key) => edits[key]);
  if (!root) return { format: 'unknown', missed: requested };
  const copy = structuredClone(root);
  const ui = uiGraphBody(copy);
  if (ui) {
    const missed: Array<'prompt' | 'image'> = [];
    for (const key of ['prompt', 'image'] as const) {
      const edit = edits[key];
      if (!edit) continue;
      const node = findUiNode(ui, edit.nodeId);
      if (!node || !patchUiNode(node, edit, key)) missed.push(key);
    }
    return { format: 'ui', workflow: copy, missed };
  }
  if (isApiPrompt(copy)) {
    const missed: Array<'prompt' | 'image'> = [];
    for (const key of ['prompt', 'image'] as const) {
      const edit = edits[key];
      if (!edit) continue;
      const node = asRecord(copy[String(edit.nodeId)]);
      const inputs = node ? asRecord(node.inputs) : null;
      // A picked photo replaces saved input photos and timeline image items
      // even when the index has no image widget.
      const replaced = key === "image" ? replaceSavedPhotos(copy, edit.value) : false;
      if (!node || !inputs || !edit.field || edit.nodeId < 0) {
        if (!replaced) missed.push(key);
        continue;
      }
      inputs[edit.field] = edit.value;
    }
    return { format: 'api', prompt: copy as ApiPrompt, missed };
  }
  return { format: 'unknown', missed: requested };
}

export interface StudioGalleryImage {
  /** Same-origin URL under `/studio-thumbs/`. */
  thumb: string;
  /** Same-origin URL of the file to upload. */
  file: string;
  /** Filename sent to ComfyUI's image upload. */
  name: string;
}

function galleryList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  const root = asRecord(raw);
  if (!root) return null;
  for (const key of ['images', 'gallery', 'items', 'files']) {
    if (Array.isArray(root[key])) return root[key];
  }
  return null;
}

function uploadName(relative: string): string {
  const base = relative.split('/').filter(Boolean).pop() ?? 'image.png';
  try {
    return decodeURIComponent(base);
  } catch {
    return base;
  }
}

/**
 * `gallery.json` is a list of `{ thumb, file }` paths relative to
 * `/studio-thumbs/`. Absolute URLs and `..` are dropped. A missing thumb
 * uses the file itself so the row can still be tapped.
 */
export function parseStudioGallery(raw: unknown): StudioGalleryImage[] {
  const list = galleryList(raw);
  if (!list) return [];
  const out: StudioGalleryImage[] = [];
  for (const item of list) {
    const row = asRecord(item);
    if (!row || typeof row.file !== 'string') continue;
    const file = studioThumbUrl(row.file);
    if (!file) continue;
    const thumb = (typeof row.thumb === 'string' ? studioThumbUrl(row.thumb) : null) ?? file;
    out.push({ thumb, file, name: uploadName(row.file) });
  }
  return out;
}

/** How many columns the run-sheet gallery draws. */
export const GALLERY_COLUMNS = 3;

/** One line under New photo. A picked file is the one Run will upload. */
export function studioPhotoStatus(pickedName: string | null, imageWritable: boolean): string {
  if (pickedName) return `Using ${pickedName} instead of the card's image.`;
  if (!imageWritable) return "This photo stays as saved in the workflow.";
  return "Keeping the card's image.";
}

const PHOTO_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;

/** Basename of a saved input photo, or null when the value is not a photo file. */
export function photoFilename(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw.length > 240 || /[\r\n]/.test(raw)) return null;
  if (raw.endsWith(" [output]") || raw.endsWith(" [temp]")) return null;
  const body = raw.endsWith(" [input]") ? raw.slice(0, -" [input]".length).trim() : raw;
  const base = body.split(/[/\\]/).pop() ?? "";
  return PHOTO_EXT.test(base) ? base : null;
}

/**
 * `file` is a photo Comfy can load from input.
 * `unresolved` is an empty slot or a previous output, which the gallery must replace.
 * `other` is left alone.
 */
function imageSlotKind(value: string): "file" | "unresolved" | "other" {
  const raw = value.trim();
  if (!raw) return "unresolved";
  if (raw.length > 240 || /[\r\n]/.test(raw)) return "other";
  if (raw.endsWith(" [output]") || raw.endsWith(" [temp]")) return "unresolved";
  // A short token that is not a photo file cannot load. The gallery has to replace it.
  return photoFilename(raw) ? "file" : "unresolved";
}

function timelinePhotoNames(value: string, add: (name: string | null) => void, unresolved: { hit: boolean }): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return;
  }
  const walk = (obj: unknown) => {
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const rec = asRecord(obj);
    if (!rec) return;
    if (rec.type === "image" && typeof rec.value === "string") {
      const kind = imageSlotKind(rec.value);
      if (kind === "unresolved") unresolved.hit = true;
      else if (kind === "file") add(photoFilename(rec.value));
    }
    for (const child of Object.values(rec)) walk(child);
  };
  walk(parsed);
}

function walkSavedImages(raw: unknown, add: (name: string | null) => void, unresolved: { hit: boolean }): void {
  const walk = (obj: unknown) => {
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const rec = asRecord(obj);
    if (!rec) return;
    const inputs = asRecord(rec.inputs);
    if (inputs && typeof rec.class_type === "string") {
      for (const [key, value] of Object.entries(inputs)) {
        if (typeof value !== "string") continue;
        if (key === "image") {
          const kind = imageSlotKind(value);
          if (kind === "unresolved") unresolved.hit = true;
          else if (kind === "file") add(photoFilename(value));
        }
        if (key === "timeline_data" || value.startsWith("{") || value.startsWith("[")) timelinePhotoNames(value, add, unresolved);
      }
      return;
    }
    for (const value of Object.values(rec)) walk(value);
  };
  walk(raw);
}

/** Photo filenames the job will load from ComfyUI's input folder when no new photo was picked. */
export function savedPhotoFilenames(raw: unknown): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (name: string | null) => {
    if (!name || seen.has(name)) return;
    seen.add(name);
    found.push(name);
  };
  walkSavedImages(raw, add, { hit: false });
  return found;
}

/** True when an image slot is empty or points at a previous output, so Run must ask for a photo. */
function savedImageUnresolved(raw: unknown): boolean {
  const unresolved = { hit: false };
  walkSavedImages(raw, () => {}, unresolved);
  return unresolved.hit;
}

function replaceTimelinePhotos(value: string, imageName: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  let changed = false;
  const walk = (obj: unknown): unknown => {
    if (Array.isArray(obj)) return obj.map(walk);
    const rec = asRecord(obj);
    if (!rec) return obj;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(rec)) {
      if (key === "value" && rec.type === "image" && typeof child === "string" && imageSlotKind(child) !== "other") {
        next[key] = imageName;
        if (child !== imageName) changed = true;
      } else if (child && typeof child === "object") {
        next[key] = walk(child);
      } else {
        next[key] = child;
      }
    }
    return next;
  };
  const next = walk(parsed);
  return changed ? JSON.stringify(next) : null;
}

/** Writes a newly uploaded photo over saved input photos and timeline image items. */
function replaceSavedPhotos(raw: Record<string, unknown>, imageName: string): boolean {
  let changed = false;
  for (const node of Object.values(raw)) {
    const rec = asRecord(node);
    const inputs = rec ? asRecord(rec.inputs) : null;
    if (!rec || !inputs || typeof rec.class_type !== "string") continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value !== "string") continue;
      if (key === "image" && imageSlotKind(value) !== "other" && value !== imageName) {
        inputs[key] = imageName;
        changed = true;
      }
      if (key === "timeline_data" || value.startsWith("{") || value.startsWith("[")) {
        const next = replaceTimelinePhotos(value, imageName);
        if (next) {
          inputs[key] = next;
          changed = true;
        }
      }
    }
  }
  return changed;
}

async function savedPhotoMissingOnServer(
  serverUrl: string,
  names: string[],
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const host = serverUrl.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
  for (const name of names) {
    const url = `http://${host}/view?type=input&filename=${encodeURIComponent(name)}`;
    try {
      const res = await fetchImpl(url, { method: "GET", cache: "no-store" });
      if (!res.ok) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Indexes of gallery entries whose pictures should be decoded.
 * `cell` is the row height in px. Only the rows inside the scroller, plus one
 * row of overscan, are returned — the other 2700 stay as JSON.
 */
export function galleryWindow(count: number, scrollTop: number, viewHeight: number, cell: number, columns = GALLERY_COLUMNS): { start: number; end: number } {
  if (count <= 0 || cell <= 0 || columns <= 0) return { start: 0, end: 0 };
  const rows = Math.ceil(count / columns);
  const startRow = Math.max(0, Math.floor(scrollTop / cell) - 1);
  const endRow = Math.min(rows, Math.ceil((scrollTop + viewHeight) / cell) + 1);
  return { start: startRow * columns, end: Math.min(count, endRow * columns) };
}

let gallerySession: Promise<StudioGalleryImage[]> | null = null;
let galleryReady: StudioGalleryImage[] | null = null;

/** Pictures already parsed this session, or null while the one fetch is still out. */
export function peekStudioGallery(): StudioGalleryImage[] | null {
  return galleryReady;
}

/**
 * Loads `/studio-thumbs/gallery.json` once per page session.
 * Later calls share that promise and do not fetch again.
 */
export function primeStudioGallery(fetchImpl: typeof fetch = fetch): Promise<StudioGalleryImage[]> {
  if (!gallerySession) {
    gallerySession = loadStudioGallery(fetchImpl).then((images) => {
      galleryReady = images;
      return images;
    });
  }
  return gallerySession;
}

/** Test hook. The phone keeps the gallery for the whole session. */
export function resetStudioGallerySession(): void {
  gallerySession = null;
  galleryReady = null;
}

/** GET `/studio-thumbs/gallery.json`. A missing or unreadable file throws. */
export async function loadStudioGallery(fetchImpl: typeof fetch = fetch): Promise<StudioGalleryImage[]> {
  const res = await fetchImpl(absoluteStudioUrl(STUDIO_GALLERY), { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(GALLERY_NOT_IN_BUILD);
  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    throw new Error(GALLERY_NOT_IN_BUILD);
  }
  if (!galleryList(raw)) throw new Error(GALLERY_NOT_IN_BUILD);
  return parseStudioGallery(raw);
}

/** GET `/studio-thumbs/<workflowFile>`. An unsafe path or a failed fetch throws. */
export async function loadStudioWorkflowFile(
  workflowFile: string,
  fetchImpl: typeof fetch = fetch,
  origin?: string,
): Promise<unknown> {
  const path = studioThumbUrl(workflowFile);
  if (!path?.startsWith(STUDIO_THUMBS_ROOT)) throw new Error(SETTINGS_NOT_IN_BUILD);
  const url = absoluteStudioUrl(path, origin);
  const res = await fetchImpl(url, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error(SETTINGS_NOT_IN_BUILD);
  // WebKit's response.json() throws "The string did not match the expected
  // pattern." on bare NaN. Python wrote those tokens; they stay in the file.
  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new Error(JOB_FILE_UNREADABLE);
  }
  return parseJobFile(text);
}

export type StudioSubmitResult =
  | { format: 'api'; postUrl: string; body: string; promptId: string }
  | { format: 'ui'; workflow: unknown; missed: Array<'prompt' | 'image'> }
  | { format: 'unknown'; missed: Array<'prompt' | 'image'> }
  | { format: 'needs-photo' };

/**
 * Loads a saved workflow from a relative path joined to an explicit page base,
 * then posts an API prompt as JSON.
 * The prompt string, including angle brackets, is a JSON field. It is not a URL.
 * `serverUrl` is the saved host, scheme or not. The post address is the
 * concatenation `http://` + host + `/prompt`. It is not passed to URL or Request.
 */
export async function submitSavedStudioPrompt(args: {
  workflowFile: string;
  serverUrl: string;
  pageOrigin?: string;
  fetchImpl?: typeof fetch;
  clientId?: string;
  edits?: { prompt?: StudioWidgetEdit | null; image?: StudioWidgetEdit | null };
  timeoutMs?: number;
}): Promise<StudioSubmitResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const json = await loadStudioWorkflowFile(args.workflowFile, fetchImpl, args.pageOrigin);
  const edits = args.edits ?? { prompt: null, image: null };
  if (!edits.image) {
    if (savedImageUnresolved(json)) return { format: "needs-photo" };
    const names = savedPhotoFilenames(json);
    if (names.length && (await savedPhotoMissingOnServer(args.serverUrl, names, fetchImpl))) {
      return { format: "needs-photo" };
    }
  }
  const patched = patchStudioRunFile(json, edits);
  if (patched.format === 'ui') return { format: 'ui', workflow: patched.workflow, missed: patched.missed };
  if (patched.format !== 'api') return { format: 'unknown', missed: patched.missed };
  const host = args.serverUrl.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
  const postUrl = `http://${host}/prompt`;
  const payload = stringifyJobFile({
    prompt: patched.prompt,
    client_id: args.clientId ?? '',
  });
  // Native fetch throws "The string did not match the expected pattern."
  // when this JSON is a string body, because it contains "<Picture 1>".
  // An ArrayBuffer is not a string. Header values stay the two fixed names.
  const body = jsonBytes(payload);
  const headers: HeadersInit = [
    ['Accept', 'application/json'],
    ['Content-Type', 'application/json'],
  ];
  const timeoutMs = args.timeoutMs ?? 0;
  const ctrl = new AbortController();
  const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  let res: Response;
  try {
    const init: RequestInit = { method: 'POST', headers, body };
    if (timeoutMs > 0) init.signal = ctrl.signal;
    res = await fetchImpl(postUrl, init);
  } catch (err) {
    if (timeoutMs > 0 && ctrl.signal.aborted) {
      throw new Error(`No response from ${postUrl} within ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(promptErrorText(text, res.status));
  let promptId = '';
  try {
    const data = JSON.parse(text) as { prompt_id?: string };
    promptId = typeof data.prompt_id === 'string' ? data.prompt_id : '';
  } catch {
    promptId = '';
  }
  return { format: 'api', postUrl, body: payload, promptId };
}

/** Posts an API graph that was already built. Same ArrayBuffer body as a card run. */
export async function submitApiGraph(args: {
  serverUrl: string;
  prompt: ApiPrompt;
  clientId?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const host = args.serverUrl.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
  const postUrl = `http://${host}/prompt`;
  const payload = stringifyJobFile({
    prompt: args.prompt,
    client_id: args.clientId ?? '',
  });
  const body = jsonBytes(payload);
  const headers: HeadersInit = [
    ['Accept', 'application/json'],
    ['Content-Type', 'application/json'],
  ];
  const res = await fetchImpl(postUrl, { method: 'POST', headers, body });
  const text = await res.text();
  if (!res.ok) throw new Error(promptErrorText(text, res.status));
  let promptId = '';
  try {
    const data = JSON.parse(text) as { prompt_id?: string };
    promptId = typeof data.prompt_id === 'string' ? data.prompt_id : '';
  } catch {
    promptId = '';
  }
  if (!promptId) throw new Error('The server did not return a prompt id.');
  return promptId;
}

/**
 * What the Run button calls. A relative workflow path is joined to the page
 * origin. An API prompt is posted as an ArrayBuffer. The prompt words stay
 * in that JSON. They are not a fetch body string and not a header value.
 */
export async function runStudioCard(args: {
  workflowFile: string;
  serverUrl: string;
  words: string;
  savedWords: string;
  promptNodeId: number | null;
  promptField: string | null;
  imageName: string | null;
  imageNodeId: number | null;
  imageField: string | null;
  clientId?: string;
  pageOrigin?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<StudioSubmitResult> {
  const edits = studioRunEdits({
    words: args.words,
    savedWords: args.savedWords,
    promptNodeId: args.promptNodeId,
    promptField: args.promptField,
    imageName: args.imageName,
    imageNodeId: args.imageNodeId,
    imageField: args.imageField,
  });
  const result = await submitSavedStudioPrompt({
    workflowFile: args.workflowFile,
    serverUrl: args.serverUrl,
    pageOrigin: args.pageOrigin,
    fetchImpl: args.fetchImpl,
    clientId: args.clientId,
    edits,
    timeoutMs: args.timeoutMs ?? 30_000,
  });
  if (result.format === 'api' && result.promptId) openQueueHistory();
  return result;
}

/**
 * The Queue is this page. Safari throws "The string did not match the expected
 * pattern." from pushState and replaceState when the URL is not a plain path
 * or contains the prompt. This path is only "/".
 */
export const QUEUE_HISTORY_PATH = '/';

export function openQueueHistory(): void {
  try {
    globalThis.history?.pushState(null, '', QUEUE_HISTORY_PATH);
  } catch {
    // The prompt id is already known. A history error must not replace it.
  }
}

function promptErrorText(text: string, status: number): string {
  const fallback = text.trim() || `POST /prompt failed (${status})`;
  try {
    const data = JSON.parse(text) as {
      error?: { message?: string };
      node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }>;
    };
    const first = Object.values(data.node_errors ?? {})[0]?.errors?.[0];
    if (first?.message) return `${first.message}${first.details ? ` — ${first.details}` : ''}`;
    if (data.error?.message) return data.error.message;
  } catch {
    /* the body is already the message */
  }
  return fallback;
}
