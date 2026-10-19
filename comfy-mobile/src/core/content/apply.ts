/**
 * Pure helpers that turn My Studio content into Studio state:
 *   - author settings / presets → template parameter values
 *   - LoRA slots of a template (and the toggle that enables each)
 *   - prompt text insertion
 */
import type { StudioTemplate, TemplateParam, TemplateValues } from '../templates/schema';

/** Alias → template param role or key fragment. Order = precedence. */
const SETTING_ALIASES: { names: string[]; role?: TemplateParam['role']; keyIncludes?: string[]; numeric?: boolean }[] = [
  { names: ['steps', 'num_steps', 'sampling_steps', 'step'], role: 'steps', numeric: true },
  { names: ['cfg', 'cfg_scale', 'guidance', 'guidance_scale', 'cfgscale'], role: 'cfg', numeric: true },
  { names: ['width', 'w'], role: 'width', numeric: true },
  { names: ['height', 'h'], role: 'height', numeric: true },
  { names: ['frames', 'length', 'num_frames', 'frame_count', 'video_length'], role: 'frames', numeric: true },
  { names: ['fps', 'frame_rate', 'framerate'], role: 'fps', numeric: true },
  { names: ['seed'], role: 'seed', numeric: true },
  { names: ['strength', 'lora_strength', 'strength_model', 'weight', 'denoise_strength'], role: 'strength', keyIncludes: ['strength'], numeric: true },
  { names: ['negative', 'negative_prompt', 'neg'], role: 'negative_prompt' },
  { names: ['shift', 'model_shift', 'sampling_shift'], keyIncludes: ['shift'], numeric: true },
  { names: ['sampler', 'sampler_name'], keyIncludes: ['sampler'] },
  { names: ['scheduler', 'scheduler_name'], keyIncludes: ['scheduler'] },
  { names: ['denoise'], keyIncludes: ['denoise'], numeric: true },
];

export interface SettingsMapping {
  values: TemplateValues;
  applied: { setting: string; param: string; value: unknown }[];
  ignored: string[];
}

function coerce(p: TemplateParam, v: unknown): unknown | undefined {
  if (v === null || v === undefined || typeof v === 'object') return undefined;
  if (p.type === 'number' || p.type === 'seed') {
    const n = typeof v === 'number' ? v : Number(String(v).trim());
    if (!Number.isFinite(n)) return undefined;
    let out = n;
    if (p.min !== undefined) out = Math.max(p.min, out);
    if (p.max !== undefined) out = Math.min(p.max, out);
    return out;
  }
  if (p.type === 'toggle') return v === true || v === 1 || v === 'true' || v === 'on';
  if (p.type === 'combo' && p.options?.length) {
    const s = String(v);
    const hit = p.options.find((o) => o.toLowerCase() === s.toLowerCase());
    return hit;
  }
  return String(v);
}

/**
 * Maps a free-form settings object (Civitai `author_settings`, a Video Studio
 * preset, …) onto a template's params. Exact key matches win, then role
 * aliases, then "param key contains" fragments. Prompts are never mapped here.
 */
export function mapSettingsToTemplate(template: StudioTemplate, settings: Record<string, unknown>): SettingsMapping {
  const values: TemplateValues = {};
  const applied: SettingsMapping['applied'] = [];
  const ignored: string[] = [];
  const params = template.params.filter((p) => p.role !== 'positive_prompt' && p.type !== 'image' && p.type !== 'video' && p.type !== 'lora');
  const used = new Set<string>();

  for (const [rawKey, rawVal] of Object.entries(settings)) {
    const key = rawKey.trim().toLowerCase().replace(/[\s-]+/g, '_');
    let target: TemplateParam | undefined = params.find((p) => p.key.toLowerCase() === key && !used.has(p.key));
    if (!target) {
      const alias = SETTING_ALIASES.find((a) => a.names.includes(key));
      if (alias) {
        if (alias.role) target = params.find((p) => p.role === alias.role && !used.has(p.key));
        if (!target && alias.keyIncludes) target = params.find((p) => alias.keyIncludes!.some((frag) => p.key.toLowerCase().includes(frag)) && !used.has(p.key));
      }
    }
    if (!target) {
      ignored.push(rawKey);
      continue;
    }
    const v = coerce(target, rawVal);
    if (v === undefined) {
      ignored.push(rawKey);
      continue;
    }
    values[target.key] = v;
    used.add(target.key);
    applied.push({ setting: rawKey, param: target.key, value: v });
  }
  return { values, applied, ignored };
}

export interface LoraSlot {
  param: TemplateParam;
  /** Toggle param (target: mode) that enables the node this slot writes to, if any. */
  toggleKey?: string;
}

function nodeIdsOf(p: TemplateParam): string[] {
  return p.bindings.map((b) => JSON.stringify(b.node));
}

/** LoRA file params of a template, each with the toggle that activates its node. */
export function loraSlotsFor(template: StudioTemplate): LoraSlot[] {
  const toggles = template.params.filter((p) => p.type === 'toggle' && p.bindings.some((b) => b.target === 'mode'));
  return template.params
    .filter((p) => p.type === 'lora')
    .map((param) => {
      const ids = new Set(nodeIdsOf(param));
      const toggle = toggles.find((t) => t.bindings.some((b) => b.target === 'mode' && ids.has(JSON.stringify(b.node))));
      return { param, toggleKey: toggle?.key };
    });
}

/** LoRA files currently selected AND active (toggle on) in the given values. */
export function activeLoraFiles(template: StudioTemplate, values: TemplateValues): string[] {
  const out: string[] = [];
  for (const slot of loraSlotsFor(template)) {
    const file = values[slot.param.key];
    if (typeof file !== 'string' || !file) continue;
    if (slot.toggleKey && values[slot.toggleKey] === false) continue;
    out.push(file);
  }
  return out;
}

/** Appends `text` to a prompt unless it is already there. */
export function joinPrompt(current: string, text: string): string {
  const t = text.trim();
  const c = current.trim();
  if (!t) return current;
  if (!c) return t;
  if (c.toLowerCase().includes(t.toLowerCase())) return current;
  return `${c.replace(/[,\s]+$/, '')}, ${t}`;
}

/** Pretty label for a content record: strips extension, underscores → spaces. */
export function prettyName(s: string): string {
  return s
    .replace(/\.(safetensors|pt|pth|ckpt|gguf|json)$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "steps 20 · cfg 3.5 · sampler euler" */
export function summariseSettings(settings: Record<string, unknown>, max = 6): string {
  return Object.entries(settings)
    .filter(([k, v]) => !k.startsWith('_') && v !== null && v !== undefined && typeof v !== 'object')
    .slice(0, max)
    .map(([k, v]) => `${k} ${typeof v === 'number' ? Number(v.toFixed(3)) : String(v)}`)
    .join(' · ');
}
