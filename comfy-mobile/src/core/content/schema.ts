/**
 * "My Studio" content bundle — the on-device copy of Brad's Video Studio
 * content (copy cards, author recipes, LoRA cards, workflows, presets,
 * characters/assets).
 *
 * The bundle is produced by `tools/export_video_studio.py` ON the Mac mini
 * and served/imported over the tailnet only. This file is the single source
 * of truth for its shape: the exporter writes exactly these keys and
 * `normaliseBundle()` accepts anything close to it (missing sections, extra
 * keys, older versions) so a partial export still loads.
 *
 * Nothing in here touches the network.
 */

export const CONTENT_SCHEMA = 'comfy-mobile-content' as const;
export const CONTENT_SCHEMA_VERSION = 1;

/** Where the phone fetches the bundle from by default (Mac mini over Tailscale). */
export const DEFAULT_CONTENT_SOURCE_URL = 'http://100.89.112.7:8152/bundle.json';

/** Every exported record carries the file (relative to the Video Studio root) it came from. */
export interface Sourced {
  id: string;
  /** Relative source path, e.g. `config/workflow_part_docs.json#parts[3]`. */
  source: string;
}

/** A reusable prompt snippet ("copy card" in Video Studio). */
export interface CopyCard extends Sourced {
  title: string;
  /** Positive prompt text to insert. */
  text: string;
  negative?: string;
  category?: string;
  tags: string[];
  notes?: string;
}

export interface RecipeLoraRef {
  /** LoRA file name (basename, as it appears in models/loras). */
  file: string;
  strength?: number;
  triggerWords: string[];
}

/**
 * Author recipe / "part": how a model author says their LoRA or checkpoint
 * should be used — trigger (trained) words plus recommended settings.
 */
export interface StudioRecipe extends Sourced {
  name: string;
  /** `trained_words` on Civitai parts. Injected into the prompt when applied. */
  triggerWords: string[];
  loras: RecipeLoraRef[];
  /** Author-recommended settings (`author_settings`), key → value, free-form. */
  settings: Record<string, unknown>;
  prompt?: string;
  negativePrompt?: string;
  /** Model family hint (Wan, LTX, Hunyuan, SDXL, Flux…). */
  engine?: string;
  /** What kind of part this is (lora, checkpoint, workflow, embedding…). */
  kind?: string;
  baseModel?: string;
  civitai?: { modelId?: number | string; versionId?: number | string; url?: string };
  notes?: string;
  tags: string[];
}

/** Brad's LoRA "adapter card": rating + trigger words + notes for one file. */
export interface LoraCard extends Sourced {
  /** File name (basename). Matched case-insensitively against /models/loras. */
  file: string;
  name?: string;
  /** 0–5 (null = unrated). */
  rating: number | null;
  favourite?: boolean;
  /** Benched = Brad has actually tested it. */
  benched?: boolean;
  triggerWords: string[];
  strength?: number;
  baseModel?: string;
  engine?: string;
  notes?: string;
  tags: string[];
  civitai?: { modelId?: number | string; versionId?: number | string; url?: string };
  /** Any other fields the exporter found on the card. */
  extra: Record<string, unknown>;
}

export type WorkflowFormat = 'ui' | 'api' | 'unknown';

export interface BundledWorkflow extends Sourced {
  name: string;
  /** `ui` = LiteGraph JSON (opens in Graph mode); `api` = /prompt payload (run as-is). */
  format: WorkflowFormat;
  workflow: Record<string, unknown>;
  nodeCount: number;
  engine?: string;
  notes?: string;
  tags: string[];
}

/** Saved Studio/Create settings ("preset"). */
export interface ContentPreset extends Sourced {
  name: string;
  engine?: string;
  values: Record<string, unknown>;
  prompt?: string;
  negativePrompt?: string;
  notes?: string;
  tags: string[];
}

export interface CharacterCard extends Sourced {
  name: string;
  description?: string;
  triggerWords: string[];
  loras: string[];
  tags: string[];
  attributes: Record<string, unknown>;
}

/** Asset list entry — names and metadata only, never media bytes. */
export interface AssetEntry extends Sourced {
  name: string;
  kind?: string;
  /** Relative path on the Mac (informational; the phone never fetches it). */
  path?: string;
  tags: string[];
  meta: Record<string, unknown>;
}

/** Anything the exporter could parse but not classify, keyed by source path. */
export interface RawEntry {
  source: string;
  kind: 'json' | 'jsonl' | 'yaml' | 'sqlite' | 'py' | 'js-embedded' | 'text';
  /** Schema-only digest (keys/types, never values). */
  shape: unknown;
  data: unknown;
}

export interface ContentBundle {
  schema: typeof CONTENT_SCHEMA;
  version: number;
  /** ISO timestamp of the export. */
  exportedAt: string;
  exporter: { name: string; version: string; root: string; host?: string };
  copyCards: CopyCard[];
  recipes: StudioRecipe[];
  loras: LoraCard[];
  workflows: BundledWorkflow[];
  presets: ContentPreset[];
  characters: CharacterCard[];
  assets: AssetEntry[];
  raw: Record<string, RawEntry>;
  /** Files that were seen but skipped (too big, binary, unparsable) — paths only. */
  skipped: { source: string; reason: string }[];
  counts: Record<string, number>;
}

export type BundleSection = 'copyCards' | 'recipes' | 'loras' | 'workflows' | 'presets' | 'characters' | 'assets';
export const BUNDLE_SECTIONS: BundleSection[] = ['copyCards', 'recipes', 'loras', 'workflows', 'presets', 'characters', 'assets'];

export function emptyBundle(): ContentBundle {
  return {
    schema: CONTENT_SCHEMA,
    version: CONTENT_SCHEMA_VERSION,
    exportedAt: '',
    exporter: { name: '', version: '', root: '' },
    copyCards: [],
    recipes: [],
    loras: [],
    workflows: [],
    presets: [],
    characters: [],
    assets: [],
    raw: {},
    skipped: [],
    counts: {},
  };
}

// ---------------------------------------------------------------------------
// Normalisation — accept loosely-shaped input, never throw on a missing field.
// ---------------------------------------------------------------------------

export class ContentBundleError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : v == null ? fallback : String(v));
const optStr = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);
const optNum = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : v === 1 || v === 'true' ? true : v === 0 || v === 'false' ? false : undefined);
const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});

/** Splits "a, b; c" / arrays / nested arrays into a clean, de-duplicated word list. */
export function words(v: unknown): string[] {
  const out: string[] = [];
  const push = (w: unknown) => {
    if (Array.isArray(w)) return w.forEach(push);
    if (isObj(w)) return push(w.word ?? w.text ?? w.name ?? w.value);
    if (typeof w !== 'string') return;
    // Only split on commas/semicolons/newlines when the string looks like a list.
    const parts = /[,;\n]/.test(w) ? w.split(/[,;\n]/) : [w];
    for (const p of parts) {
      const t = p.trim();
      if (t) out.push(t);
    }
  };
  push(v);
  const seen = new Set<string>();
  return out.filter((w) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function rating(v: unknown): number | null {
  const n = optNum(v);
  if (n === undefined) return null;
  // Accept 0–5, 0–10 and 0–100 scales.
  const scaled = n > 10 ? n / 20 : n > 5 ? n / 2 : n;
  return Math.max(0, Math.min(5, Math.round(scaled * 2) / 2));
}

function civitai(v: unknown): StudioRecipe['civitai'] {
  if (!isObj(v)) return undefined;
  const out = { modelId: v.modelId ?? v.model_id, versionId: v.versionId ?? v.version_id, url: optStr(v.url) } as NonNullable<StudioRecipe['civitai']>;
  return out.modelId !== undefined || out.versionId !== undefined || out.url ? out : undefined;
}

function list<T>(v: unknown, map: (x: Record<string, unknown>, i: number) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  v.forEach((x, i) => {
    if (!isObj(x)) return;
    const r = map(x, i);
    if (r) out.push(r);
  });
  return out;
}

const idOf = (x: Record<string, unknown>, prefix: string, i: number) => str(x.id, `${prefix}-${i}`);
const sourceOf = (x: Record<string, unknown>) => str(x.source, 'unknown');

/** Workflow format detection, shared with the exporter's heuristics. */
export function detectWorkflowFormat(wf: unknown): WorkflowFormat {
  if (!isObj(wf)) return 'unknown';
  if (Array.isArray(wf.nodes)) return 'ui';
  const vals = Object.values(wf);
  if (vals.length && vals.every((v) => isObj(v) && typeof v.class_type === 'string')) return 'api';
  return 'unknown';
}

export function workflowNodeCount(wf: unknown, format: WorkflowFormat): number {
  if (!isObj(wf)) return 0;
  if (format === 'ui') return Array.isArray(wf.nodes) ? wf.nodes.length : 0;
  if (format === 'api') return Object.keys(wf).length;
  return 0;
}

/**
 * Accepts any JSON value and returns a well-formed bundle. Throws
 * `ContentBundleError` only when the input is not a bundle at all.
 */
export function normaliseBundle(input: unknown): ContentBundle {
  let raw: unknown = input;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new ContentBundleError('Not valid JSON');
    }
  }
  if (!isObj(raw)) throw new ContentBundleError('Bundle must be a JSON object');
  const looksLikeBundle = raw.schema === CONTENT_SCHEMA || BUNDLE_SECTIONS.some((k) => Array.isArray(raw[k]));
  if (!looksLikeBundle) throw new ContentBundleError('This JSON is not a My Studio bundle (expected "schema": "comfy-mobile-content").');

  const b = emptyBundle();
  b.version = optNum(raw.version) ?? CONTENT_SCHEMA_VERSION;
  b.exportedAt = str(raw.exportedAt ?? raw.exported_at);
  const ex = obj(raw.exporter);
  b.exporter = { name: str(ex.name), version: str(ex.version), root: str(ex.root), host: optStr(ex.host) };

  b.copyCards = list(raw.copyCards ?? raw.copy_cards, (x, i) => {
    const text = str(x.text ?? x.prompt ?? x.body ?? x.content);
    if (!text.trim()) return null;
    return {
      id: idOf(x, 'copy', i),
      source: sourceOf(x),
      title: str(x.title ?? x.name, text.slice(0, 48)),
      text,
      negative: optStr(x.negative ?? x.negativePrompt),
      category: optStr(x.category),
      tags: words(x.tags),
      notes: optStr(x.notes),
    };
  });

  b.recipes = list(raw.recipes, (x, i) => ({
    id: idOf(x, 'recipe', i),
    source: sourceOf(x),
    name: str(x.name ?? x.title, `Recipe ${i + 1}`),
    triggerWords: words(x.triggerWords ?? x.trained_words ?? x.trigger_words),
    loras: list(x.loras, (l) => (optStr(l.file) ? { file: str(l.file), strength: optNum(l.strength), triggerWords: words(l.triggerWords) } : null)),
    settings: obj(x.settings ?? x.author_settings),
    prompt: optStr(x.prompt),
    negativePrompt: optStr(x.negativePrompt),
    engine: optStr(x.engine),
    kind: optStr(x.kind),
    baseModel: optStr(x.baseModel),
    civitai: civitai(x.civitai),
    notes: optStr(x.notes),
    tags: words(x.tags),
  }));

  b.loras = list(raw.loras, (x, i) => {
    const file = optStr(x.file ?? x.filename);
    if (!file) return null;
    return {
      id: idOf(x, 'lora', i),
      source: sourceOf(x),
      file,
      name: optStr(x.name),
      rating: rating(x.rating),
      favourite: bool(x.favourite),
      benched: bool(x.benched),
      triggerWords: words(x.triggerWords ?? x.trained_words),
      strength: optNum(x.strength),
      baseModel: optStr(x.baseModel),
      engine: optStr(x.engine),
      notes: optStr(x.notes),
      tags: words(x.tags),
      civitai: civitai(x.civitai),
      extra: obj(x.extra),
    };
  });

  b.workflows = list(raw.workflows, (x, i) => {
    if (!isObj(x.workflow)) return null;
    const declared = str(x.format);
    const format: WorkflowFormat = declared === 'ui' || declared === 'api' ? declared : detectWorkflowFormat(x.workflow);
    return {
      id: idOf(x, 'workflow', i),
      source: sourceOf(x),
      name: str(x.name, `Workflow ${i + 1}`),
      format,
      workflow: x.workflow,
      nodeCount: optNum(x.nodeCount) ?? workflowNodeCount(x.workflow, format),
      engine: optStr(x.engine),
      notes: optStr(x.notes),
      tags: words(x.tags),
    };
  });

  b.presets = list(raw.presets, (x, i) => ({
    id: idOf(x, 'preset', i),
    source: sourceOf(x),
    name: str(x.name, `Preset ${i + 1}`),
    engine: optStr(x.engine),
    values: obj(x.values),
    prompt: optStr(x.prompt),
    negativePrompt: optStr(x.negativePrompt),
    notes: optStr(x.notes),
    tags: words(x.tags),
  }));

  b.characters = list(raw.characters, (x, i) => ({
    id: idOf(x, 'character', i),
    source: sourceOf(x),
    name: str(x.name, `Character ${i + 1}`),
    description: optStr(x.description),
    triggerWords: words(x.triggerWords),
    loras: words(x.loras),
    tags: words(x.tags),
    attributes: obj(x.attributes),
  }));

  b.assets = list(raw.assets, (x, i) => ({
    id: idOf(x, 'asset', i),
    source: sourceOf(x),
    name: str(x.name, `Asset ${i + 1}`),
    kind: optStr(x.kind),
    path: optStr(x.path),
    tags: words(x.tags),
    meta: obj(x.meta),
  }));

  if (isObj(raw.raw)) {
    for (const [k, v] of Object.entries(raw.raw)) {
      if (!isObj(v)) continue;
      b.raw[k] = { source: str(v.source, k), kind: (str(v.kind, 'json') as RawEntry['kind']), shape: v.shape, data: v.data };
    }
  }
  b.skipped = list(raw.skipped, (x) => ({ source: str(x.source), reason: str(x.reason) }));
  b.counts = countBundle(b);
  return b;
}

export function countBundle(b: ContentBundle): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const k of BUNDLE_SECTIONS) counts[k] = b[k].length;
  counts.raw = Object.keys(b.raw).length;
  counts.skipped = b.skipped.length;
  return counts;
}

export function bundleIsEmpty(b: ContentBundle | null): boolean {
  return !b || BUNDLE_SECTIONS.every((k) => b[k].length === 0);
}
