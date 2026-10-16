/**
 * Library: pure helpers for everything the server exposes that is not a node
 * — model files per `/models/<folder>`, user-saved workflows (`/api/userdata`)
 * and input images. The Library tab renders these; the functions here are
 * UI-free so they can be unit-tested under Node.
 */
import type { ObjectInfo, UserdataListEntry } from '../api/types';
import { comboValues, isComboSpec, orderedInputs } from '../graph/widgets';
import { bakedValues, modelFolderFor, paramOptions } from '../templates/engine';
import type { StudioTemplate } from '../templates/schema';

// ---------------------------------------------------------------------------
// Model folders
// ---------------------------------------------------------------------------

/** Display order and plain-language labels for the folders ComfyUI ships with. */
const FOLDER_META: Record<string, { label: string; blurb: string }> = {
  checkpoints: { label: 'Checkpoints', blurb: 'Full image/video models (SD, SDXL, LTX…)' },
  diffusion_models: { label: 'Diffusion models', blurb: 'UNet / DiT weights loaded on their own (Wan, Hunyuan, Flux…)' },
  unet: { label: 'UNet (legacy folder)', blurb: 'Older location for diffusion models' },
  loras: { label: 'LoRAs', blurb: 'Small add-ons that change style, character or speed' },
  text_encoders: { label: 'Text encoders', blurb: 'Turn your prompt into something the model understands' },
  clip: { label: 'CLIP (legacy folder)', blurb: 'Older location for text encoders' },
  clip_vision: { label: 'CLIP Vision', blurb: 'Image encoders used by image-to-video and IP-Adapter' },
  vae: { label: 'VAEs', blurb: 'Decode latents into pixels' },
  embeddings: { label: 'Embeddings', blurb: 'Textual inversions — use as embedding:name in a prompt' },
  controlnet: { label: 'ControlNet', blurb: 'Guide composition with poses, depth or edges' },
  ipadapter: { label: 'IP-Adapter', blurb: 'Use a reference image as a style/subject guide' },
  upscale_models: { label: 'Upscalers', blurb: 'ESRGAN-style upscaling models' },
  style_models: { label: 'Style models', blurb: 'T2I style adapters / Flux Redux' },
  gligen: { label: 'GLIGEN', blurb: 'Box-guided layout models' },
  hypernetworks: { label: 'Hypernetworks', blurb: 'Legacy SD1.5 add-ons' },
  photomaker: { label: 'PhotoMaker', blurb: 'Identity-preserving portrait adapters' },
  audio_encoders: { label: 'Audio encoders', blurb: 'For audio-driven video models' },
  model_patches: { label: 'Model patches', blurb: 'Patch weights applied on top of a model' },
  animatediff_models: { label: 'AnimateDiff motion modules', blurb: 'Motion models for the AnimateDiff pack' },
  animatediff_motion_lora: { label: 'AnimateDiff motion LoRAs', blurb: 'Camera-motion LoRAs for AnimateDiff' },
  configs: { label: 'Configs', blurb: 'Model config files (rarely needed)' },
  diffusers: { label: 'Diffusers', blurb: 'Diffusers-format model folders' },
  vae_approx: { label: 'VAE approx', blurb: 'Fast preview decoders (TAESD)' },
  classifiers: { label: 'Classifiers', blurb: 'Safety / aesthetic classifiers' },
};

const FOLDER_ORDER = Object.keys(FOLDER_META);

export interface ModelGroup {
  folder: string;
  label: string;
  blurb: string;
  /** Files, exactly as the server names them (may include subfolders). */
  files: string[];
  count: number;
  /** True while the folder's list has not arrived yet. */
  loading: boolean;
}

export function folderLabel(folder: string): string {
  return FOLDER_META[folder]?.label ?? folder.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Turns the `/models` folder list plus per-folder file lists into display
 * groups: known folders first in a sensible order, unknown (custom-node)
 * folders after, alphabetically. Empty folders stay (with count 0) so the
 * user can see what the server has slots for; `hideEmpty` drops them.
 */
export function groupModelFolders(folders: string[], lists: Record<string, string[] | undefined>, opts: { hideEmpty?: boolean } = {}): ModelGroup[] {
  const rank = (f: string) => {
    const i = FOLDER_ORDER.indexOf(f);
    return i < 0 ? FOLDER_ORDER.length : i;
  };
  const groups = [...new Set(folders)]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map<ModelGroup>((folder) => {
      const files = lists[folder];
      return {
        folder,
        label: folderLabel(folder),
        blurb: FOLDER_META[folder]?.blurb ?? 'Added by a custom node pack',
        files: files ?? [],
        count: files?.length ?? 0,
        loading: files === undefined,
      };
    });
  return opts.hideEmpty ? groups.filter((g) => g.loading || g.count > 0) : groups;
}

/** Case-insensitive, whitespace-separated AND match on the file name (every word must appear). */
export function matchesQuery(file: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = file.toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** Filters every group's files by the query; groups with no matches are dropped (unless the query is empty). */
export function filterModelGroups(groups: ModelGroup[], query: string): ModelGroup[] {
  if (!query.trim()) return groups;
  return groups
    .map((g) => {
      const files = g.files.filter((f) => matchesQuery(f, query));
      return { ...g, files, count: files.length };
    })
    .filter((g) => g.count > 0);
}

/** Total files across groups (what the Library header shows). */
export function totalModelCount(groups: ModelGroup[]): number {
  return groups.reduce((n, g) => n + g.count, 0);
}

// ---------------------------------------------------------------------------
// Loader nodes: which node + widget loads a file from a given folder
// ---------------------------------------------------------------------------

export interface LoaderTarget {
  type: string;
  widget: string;
}

/** Core ComfyUI loaders by folder. Verified against object_info before use, so custom packs can override. */
const PREFERRED_LOADERS: Record<string, LoaderTarget[]> = {
  checkpoints: [{ type: 'CheckpointLoaderSimple', widget: 'ckpt_name' }],
  diffusion_models: [{ type: 'UNETLoader', widget: 'unet_name' }],
  unet: [{ type: 'UNETLoader', widget: 'unet_name' }],
  loras: [{ type: 'LoraLoaderModelOnly', widget: 'lora_name' }, { type: 'LoraLoader', widget: 'lora_name' }],
  text_encoders: [{ type: 'CLIPLoader', widget: 'clip_name' }, { type: 'DualCLIPLoader', widget: 'clip_name1' }],
  clip: [{ type: 'CLIPLoader', widget: 'clip_name' }],
  clip_vision: [{ type: 'CLIPVisionLoader', widget: 'clip_name' }],
  vae: [{ type: 'VAELoader', widget: 'vae_name' }],
  controlnet: [{ type: 'ControlNetLoader', widget: 'control_net_name' }],
  upscale_models: [{ type: 'UpscaleModelLoader', widget: 'model_name' }],
  style_models: [{ type: 'StyleModelLoader', widget: 'style_model_name' }],
  gligen: [{ type: 'GLIGENLoader', widget: 'gligen_name' }],
  hypernetworks: [{ type: 'HypernetworkLoader', widget: 'hypernetwork_name' }],
  photomaker: [{ type: 'PhotoMakerLoader', widget: 'photomaker_model_name' }],
  ipadapter: [{ type: 'IPAdapterModelLoader', widget: 'ipadapter_file' }],
  animatediff_models: [{ type: 'ADE_AnimateDiffLoaderGen1', widget: 'model_name' }],
  animatediff_motion_lora: [{ type: 'ADE_AnimateDiffLoRALoader', widget: 'name' }],
};

function hasComboWith(info: ObjectInfo, type: string, widget: string, file: string): boolean {
  const def = info[type];
  if (!def) return false;
  const input = orderedInputs(def).find((i) => i.name === widget);
  return !!input && isComboSpec(input.spec) && comboValues(input.spec).includes(file);
}

/**
 * Picks the node that loads `file` from `folder`: a preferred core loader
 * whose combo actually lists the file, otherwise any node in object_info
 * with a combo containing it (custom folders), otherwise the preferred
 * loader even if the list is stale (the server may have new files since
 * object_info was fetched). Null for folders nothing loads (embeddings).
 */
export function loaderFor(folder: string, file: string, info: ObjectInfo | null): LoaderTarget | null {
  const preferred = PREFERRED_LOADERS[folder] ?? [];
  if (info) {
    for (const t of preferred) if (hasComboWith(info, t.type, t.widget, file)) return t;
    for (const [type, def] of Object.entries(info)) {
      for (const input of orderedInputs(def)) {
        if (isComboSpec(input.spec) && comboValues(input.spec).includes(file)) return { type, widget: input.name };
      }
    }
    for (const t of preferred) if (info[t.type]) return t;
    return null;
  }
  return preferred[0] ?? null;
}

/** Prompt token for a textual-inversion embedding file. */
export function embeddingToken(file: string): string {
  return `embedding:${file.replace(/\.(safetensors|pt|bin|ckpt)$/i, '')}`;
}

// ---------------------------------------------------------------------------
// "Use in Studio": where a library file lands in the current template
// ---------------------------------------------------------------------------

export type StudioTarget =
  /** Add to the Studio LoRA stack (video templates). */
  | { kind: 'stack' }
  /** Write into a template param (model combo or single LoRA slot). */
  | { kind: 'param'; key: string; label: string }
  /** Append an `embedding:` token to the positive prompt. */
  | { kind: 'prompt'; token: string }
  /** Nothing in this template takes the file. */
  | { kind: 'none'; reason: string };

/**
 * Decides what "Use in Studio" does for `file` from `folder` with the given
 * template: LoRAs go to the stack when the template supports it, otherwise
 * to its first LoRA param; other model files go to the first `role: model`
 * combo whose server list contains the file (or whose baked file lives in the
 * same folder); embeddings become prompt tokens.
 */
export function studioTargetFor(
  template: StudioTemplate,
  folder: string,
  file: string,
  info: ObjectInfo | null,
  modelLists: Record<string, string[]>,
  opts: { stackSupported?: boolean } = {},
): StudioTarget {
  if (folder === 'embeddings') return { kind: 'prompt', token: embeddingToken(file) };
  if (folder === 'loras') {
    if (opts.stackSupported) return { kind: 'stack' };
    const p = template.params.find((x) => x.type === 'lora' && !x.advanced) ?? template.params.find((x) => x.type === 'lora');
    return p ? { kind: 'param', key: p.key, label: p.label } : { kind: 'none', reason: `“${template.name}” has no LoRA slot.` };
  }
  const baked = bakedValues(template, info);
  const candidates = template.params.filter((p) => p.role === 'model' && p.type === 'combo');
  const byOptions = candidates.find((p) => paramOptions(p, template, info).includes(file) || (modelLists[folder] ?? []).includes(file) && modelFolderFor(template, baked[p.key]) === folder);
  const byFolder = byOptions ?? candidates.find((p) => modelFolderFor(template, baked[p.key]) === folder);
  if (byFolder) return { kind: 'param', key: byFolder.key, label: byFolder.label };
  return { kind: 'none', reason: `“${template.name}” has no ${folderLabel(folder).toLowerCase()} setting.` };
}

// ---------------------------------------------------------------------------
// User-data workflows
// ---------------------------------------------------------------------------

export interface UserWorkflow {
  /** Path relative to the `workflows` dir, e.g. "video/wan22.json". */
  path: string;
  /** Display name: path without the .json extension. */
  name: string;
  size?: number;
  modified?: number;
}

/** Normalises either `/api/userdata` response shape to `UserWorkflow`s, JSON files only, newest first. */
export function parseUserdataList(raw: unknown): UserWorkflow[] {
  if (!Array.isArray(raw)) return [];
  const out: UserWorkflow[] = [];
  for (const entry of raw as UserdataListEntry[]) {
    const path = typeof entry === 'string' ? entry : entry?.path;
    if (!path || !/\.json$/i.test(path)) continue;
    const info = typeof entry === 'string' ? undefined : entry;
    out.push({
      path: path.replace(/\\/g, '/'),
      name: path.replace(/\\/g, '/').replace(/\.json$/i, ''),
      size: info?.size,
      modified: info?.modified,
    });
  }
  return out.sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0) || a.name.localeCompare(b.name));
}

/** Full user-data path for a workflow file, as `getUserdata` expects it. */
export function userWorkflowPath(w: Pick<UserWorkflow, 'path'>): string {
  return `workflows/${w.path}`;
}

// ---------------------------------------------------------------------------
// Input images
// ---------------------------------------------------------------------------

const IMAGE_FILE = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?)$/i;

/** Files selectable in LoadImage (the server's input folder) plus this session's uploads, images only, de-duplicated. */
export function inputImages(info: ObjectInfo | null, uploaded: string[] = []): string[] {
  const def = info?.LoadImage;
  const combo = def ? orderedInputs(def).find((i) => i.name === 'image') : undefined;
  const fromServer = combo && isComboSpec(combo.spec) ? comboValues(combo.spec) : [];
  return [...new Set([...fromServer, ...uploaded])].filter((f) => IMAGE_FILE.test(f));
}
