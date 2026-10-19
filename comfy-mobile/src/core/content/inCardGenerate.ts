/**
 * In-card generate: rewrite Brad's words into the author's format, build one
 * start-image graph per author step, and apply the approved prompts and
 * images onto the full workflow.
 *
 * Every sentence in a workflow description is a fact read off the graph.
 */
import type { HistoryEntry, ImageRef } from '../api/types';

export interface ApiNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ApiGraph = Record<string, ApiNode>;

export interface StepLora {
  file: string;
  strength: number;
}

export interface AuthorStep {
  /** `${nodeId}:${field}` */
  id: string;
  nodeId: string;
  field: string;
  authorPrompt: string;
  kind: 'image' | 'video';
  engine: string;
  engineFile: string;
  loras: StepLora[];
  samplerId: string | null;
  label: string;
}

export interface WorkflowBrief {
  engines: string[];
  scenes: number;
  needsStartImage: boolean;
  makesOwnStartImage: boolean;
  /** none = still. unknown = a video whose length is not in the graph. */
  video: 'none' | 'short' | 'long' | 'unknown';
  seconds: number | null;
  blurb: string;
}

export interface StillBuild {
  prompt: ApiGraph;
  seed: number;
}

const TEXT_FIELDS = ['text', 'value', 'prompt', 'string', 'caption'];
const SAMPLER_RE = /KSampler|SamplerCustomAdvanced|WanVideoSampler|WanMoeKSampler|MiniMaxH3Director|MiniMaxH3ImageToVideo|WanImageToVideo/;
const LOADER_RE = /UNETLoader|CheckpointLoaderSimple|WanVideoModelLoader|UnetLoaderGGUF|DiffusionModelLoader/;
const VIDEO_NODE_RE = /EmptyLTXVLatentVideo|LTXVImgToVideo|LTXDirector|MiniMaxH3|WanImageToVideo|WanVideo|VHS_VideoCombine|SaveVideo|CreateVideo|Hunyuan|EmptyHunyuan|ImageToVideo|I2V/;
const IMAGE_LATENT_RE = /^EmptyLatentImage$|^EmptySD3LatentImage$/;
const BOUNDARY_RE = /^KSampler$|^SamplerCustomAdvanced$|^VAEDecode/;
const BEAT = /(?<!\d)\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s\s*:/;
const SKIP_MODEL_RE = /vae|umt5|gemma|qwen|clip|text_enc|^ae\.safetensors$|embed|audio/i;
const FPS_VALUES = new Set([8, 12, 16, 24, 25, 30, 48]);
const LONG_SECONDS = 8;

function linkId(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const id = value[0];
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  return null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function apiGraphOf(raw: unknown): ApiGraph | null {
  if (!raw || typeof raw !== 'object') return null;
  const outer = raw as Record<string, unknown>;
  const inner = outer.prompt && typeof outer.prompt === 'object' && !Array.isArray(outer.prompt) ? outer.prompt : outer;
  const nodes: ApiGraph = {};
  for (const [id, node] of Object.entries(inner as Record<string, unknown>)) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
    const ct = (node as { class_type?: unknown }).class_type;
    if (typeof ct !== 'string' || !ct) continue;
    const inputs = (node as { inputs?: unknown }).inputs;
    nodes[id] = {
      class_type: ct,
      inputs: inputs && typeof inputs === 'object' && !Array.isArray(inputs) ? { ...(inputs as Record<string, unknown>) } : {},
      _meta: (node as ApiNode)._meta,
    };
  }
  return Object.keys(nodes).length ? nodes : null;
}

function cloneGraph(graph: ApiGraph): ApiGraph {
  return JSON.parse(JSON.stringify(graph)) as ApiGraph;
}

export function engineLabel(file: string): string | null {
  const base = file.split(/[/\\]/).pop() ?? file;
  if (SKIP_MODEL_RE.test(base)) return null;
  const n = base.toLowerCase();
  if (n.includes('pony')) return 'Pony';
  if (n.includes('sulphur')) return 'Sulphur';
  if (n.includes('wan')) return 'Wan';
  if (n.includes('ltx')) return 'LTX';
  if (n.includes('hunyuan')) return 'Hunyuan';
  if (n.includes('illustrious')) return 'Illustrious';
  if (n.includes('zimage') || n.includes('cyberrealistic')) return 'Z-Image';
  if (n.includes('minimax') || n.includes('h3eros') || n.includes('fl2va') || n.includes('ref2va') || n.includes('dasiwa')) return 'MiniMax H3';
  if (/\.(safetensors|ckpt|gguf|sft)$/i.test(base)) return base.replace(/\.(safetensors|ckpt|gguf|sft)$/i, '').replace(/[_]+/g, ' ');
  return null;
}

function isPromptText(value: string): boolean {
  const s = value.trim();
  if (s.length < 40) return false;
  if (/^[\w.\\/\-]+\.(safetensors|ckpt|png|jpe?g|json|mp4|webp)$/i.test(s)) return false;
  if ((s.match(/\\/g) ?? []).length >= 2 && !s.includes(' ')) return false;
  if (s.startsWith('{') || s.startsWith('[')) return false;
  return true;
}

function consumersOf(graph: ApiGraph, id: string): { id: string; field: string }[] {
  const out: { id: string; field: string }[] = [];
  for (const [nid, node] of Object.entries(graph)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      if (linkId(value) === id) out.push({ id: nid, field });
    }
  }
  return out;
}

function ancestorIds(graph: ApiGraph, startId: string, stopAtSampler = true): string[] {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    const node = graph[id];
    if (!node) continue;
    seen.add(id);
    for (const value of Object.values(node.inputs)) {
      const src = linkId(value);
      if (!src || seen.has(src) || !graph[src]) continue;
      if (stopAtSampler && src !== startId && BOUNDARY_RE.test(graph[src].class_type)) continue;
      stack.push(src);
    }
  }
  return [...seen];
}

function lorasOnNode(node: ApiNode): StepLora[] {
  const found: StepLora[] = [];
  const inputs = node.inputs;
  if (typeof inputs.lora_name === 'string' && inputs.lora_name.trim() && inputs.lora_name.toLowerCase() !== 'none') {
    found.push({ file: inputs.lora_name, strength: asNumber(inputs.strength_model) ?? asNumber(inputs.strength) ?? 1 });
  }
  for (const [key, value] of Object.entries(inputs)) {
    if (!/lora/i.test(key) || key === 'lora_name') continue;
    if (typeof value === 'string' && /\.safetensors$/i.test(value) && value.toLowerCase() !== 'none') {
      found.push({ file: value, strength: 1 });
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const row = value as { on?: unknown; lora?: unknown; strength?: unknown };
      if (row.on === false) continue;
      if (typeof row.lora === 'string' && row.lora.trim() && row.lora.toLowerCase() !== 'none') {
        found.push({ file: row.lora, strength: asNumber(row.strength) ?? 1 });
      }
    }
  }
  return found;
}

function engineOnAncestors(graph: ApiGraph, ids: string[]): { engine: string; file: string } {
  for (const id of ids) {
    const node = graph[id];
    if (!node || !LOADER_RE.test(node.class_type)) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (typeof value !== 'string' || !/unet|ckpt|model/i.test(key)) continue;
      const engine = engineLabel(value);
      if (engine) return { engine, file: value };
    }
  }
  return { engine: '', file: '' };
}

function lorasOnAncestors(graph: ApiGraph, ids: string[]): StepLora[] {
  const found: StepLora[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const node = graph[id];
    if (!node || !/lora/i.test(node.class_type)) continue;
    for (const lora of lorasOnNode(node)) {
      const key = lora.file.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(lora);
    }
  }
  return found;
}

function kindOfSampler(graph: ApiGraph, samplerId: string): 'image' | 'video' {
  const node = graph[samplerId];
  if (!node) return 'image';
  if (/MiniMaxH3|WanImageToVideo|WanVideo|ImageToVideo|I2V|LTXDirector/.test(node.class_type)) return 'video';
  const ids = ancestorIds(graph, samplerId, true);
  for (const id of ids) {
    if (VIDEO_NODE_RE.test(graph[id].class_type)) return 'video';
  }
  return 'image';
}

interface PromptHit {
  nodeId: string;
  field: string;
  text: string;
  samplerId: string | null;
  negative: boolean;
}

function promptHits(graph: ApiGraph): PromptHit[] {
  const hits: PromptHit[] = [];
  for (const [nodeId, node] of Object.entries(graph)) {
    for (const field of TEXT_FIELDS) {
      const value = node.inputs[field];
      if (typeof value !== 'string' || !isPromptText(value)) continue;
      const reached = followToSampler(graph, nodeId);
      if (!reached || reached.negative) continue;
      hits.push({ nodeId, field, text: value, samplerId: reached.samplerId, negative: false });
    }
  }
  return hits;
}

function followToSampler(graph: ApiGraph, startId: string): { samplerId: string; negative: boolean } | null {
  const start = graph[startId];
  if (start && SAMPLER_RE.test(start.class_type)) return { samplerId: startId, negative: false };
  const seen = new Set<string>();
  const stack: { id: string; negative: boolean }[] = [{ id: startId, negative: false }];
  let negativeHit: string | null = null;
  while (stack.length) {
    const cur = stack.pop();
    if (!cur) continue;
    const key = `${cur.id}:${cur.negative ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = graph[cur.id];
    if (!node) continue;
    if (cur.id !== startId && SAMPLER_RE.test(node.class_type)) {
      if (!cur.negative) return { samplerId: cur.id, negative: false };
      negativeHit = cur.id;
      continue;
    }
    const nexts = consumersOf(graph, cur.id).sort((a, b) => Number(b.field === 'negative') - Number(a.field === 'negative'));
    for (const next of nexts) {
      const negative = cur.negative || next.field === 'negative' || graph[next.id]?.class_type === 'ConditioningZeroOut';
      stack.push({ id: next.id, negative });
    }
  }
  return negativeHit ? { samplerId: negativeHit, negative: true } : null;
}

export function authorGenerateSteps(raw: unknown): AuthorStep[] {
  const graph = apiGraphOf(raw);
  if (!graph) return [];
  const hits = promptHits(graph);
  const steps: AuthorStep[] = hits.map((hit) => {
    const samplerId = hit.samplerId;
    const ids = samplerId ? ancestorIds(graph, samplerId, true) : [];
    const engine = engineOnAncestors(graph, ids);
    const kind = samplerId ? kindOfSampler(graph, samplerId) : 'image';
    const loras = lorasOnAncestors(graph, ids);
    const engineName = engine.engine || 'the model in the graph';
    return {
      id: `${hit.nodeId}:${hit.field}`,
      nodeId: hit.nodeId,
      field: hit.field,
      authorPrompt: hit.text,
      kind,
      engine: engineName,
      engineFile: engine.file,
      loras,
      samplerId,
      label: kind === 'video' ? `Video · ${engineName}` : `Still · ${engineName}`,
    };
  });
  steps.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'image' ? -1 : 1;
    if (a.samplerId && b.samplerId && a.samplerId !== b.samplerId) {
      const aIds = new Set(ancestorIds(graph, a.samplerId, false));
      if (b.samplerId && aIds.has(b.samplerId)) return 1;
      const bIds = new Set(ancestorIds(graph, b.samplerId, false));
      if (a.samplerId && bIds.has(a.samplerId)) return -1;
    }
    return a.nodeId < b.nodeId ? -1 : 1;
  });
  return steps;
}

function fileStem(file: string): string {
  const base = file.split(/[/\\]/).pop() ?? file;
  return base.replace(/\.(safetensors|ckpt|gguf|sft)$/i, '');
}

export function spokenLines(text: string): string[] {
  const lines: string[] = [];
  for (const match of text.matchAll(/<d>(?:\[[^\]]+\]\s*)?([\s\S]*?)<\/d>/gi)) {
    const line = match[1].trim();
    if (line) lines.push(line);
  }
  if (lines.length) return lines;
  for (const match of text.matchAll(/"([^"\n]{1,240})"/g)) lines.push(match[1]);
  return lines;
}

function camerasIn(text: string): string[] {
  const found: string[] = [];
  const re = /\b(wide shot|medium close-up|medium shot|close-up|close up|fixed camera(?: angle)?|front-facing angle|static camera)\b/gi;
  for (const match of text.matchAll(re)) {
    const value = match[1];
    if (!found.some((item) => item.toLowerCase() === value.toLowerCase())) found.push(value);
  }
  return found;
}

function styleBits(text: string): string[] {
  const found: string[] = [];
  const re = /\b(live-action|cinematic realism|cinematic lighting|cinematic|photorealistic|photoreal|35mm|shallow depth of field)\b/gi;
  for (const match of text.matchAll(re)) {
    const value = match[1];
    if (!found.some((item) => item.toLowerCase() === value.toLowerCase())) found.push(value);
  }
  return found;
}

const H3_CAMERAS = ['Static Shot', 'Push In', 'Pan Left', 'Tracking Shot'];
const PONY_SCORES = 'score_9, score_8_up, score_7_up, BREAK, ';
const ILLUSTRIOUS_QUALITY = 'masterpiece,best quality,amazing quality,';

function visualWords(words: string): string {
  return words
    .replace(/<d>[\s\S]*?<\/d>/gi, ' ')
    .replace(/"[^"\n]*"/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rewriteVideoStyle(engine: string, author: string, words: string, roll: number): string {
  const name = engine.toLowerCase();
  if (name.includes('wan')) return words;
  if (name.includes('sulphur')) return rewriteSulphur(author, words);
  if (name.includes('hunyuan')) return rewriteHunyuan(words);
  if (name.includes('minimax') || name.includes('h3')) return rewriteH3(author, words, roll);
  if (name.includes('ltx')) return rewriteLtx(words);
  if (/integrated_multimodal_description|subject_definitions|\[Shot\s+\d+/i.test(author)) return rewriteH3(author, words, roll);
  return words;
}

function rewriteSulphur(author: string, words: string): string {
  if (BEAT.test(author)) return rewriteSulphurBeats(author, words);
  if (!/global_prompt|smart_prompt/i.test(author)) return words;
  if (/Scene\s+\d+\s*:/i.test(author)) return `global_prompt: ${words}\nsmart_prompt: Scene 1: ${words}`;
  if (author.includes('|')) return `global_prompt: ${words}\nsmart_prompt: ${words}`;
  return `global_prompt: ${words}\nsmart_prompt: ${words}`;
}

/** One clip. His subject replaces the author's subject. The timed actions stay. */
function rewriteSulphurBeats(author: string, words: string): string {
  const beats = [...author.matchAll(/(?<!\d)\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s\s*:[^\n]*/g)].map((match) => match[0].trim());
  const subject = words.trim().replace(/\.+$/, '');
  const lead = /Immediate action/i.test(author) ? ' Immediate action.' : '';
  return `${subject}.${lead}${beats.length ? `\n${beats.join('\n')}` : ''}`;
}

function rewriteLtx(words: string): string {
  const quotes = spokenLines(words);
  const dialogue = quotes.length ? ` Dialogue: ${quotes.map((line) => `"${line}"`).join(' ')}` : '';
  return `Use the provided start image exactly as the first frame. Performance: ${words}.${dialogue}`;
}

function rewriteHunyuan(words: string): string {
  const parts = [`([Scene: ${words}]:1)`, `([Action: ${words}]:1)`];
  if (/\b(woman|female|she|her)\b/i.test(words)) parts.splice(1, 0, `([Woman: ${words}]:1)`);
  if (/\b(man|male|he|his|him)\b/i.test(words)) parts.splice(1, 0, `([Man: ${words}]:1)`);
  return parts.join(' ');
}

function withSpokenTags(words: string): string {
  if (/<d>/i.test(words)) return words;
  return words.replace(/"([^"\n]*)"/g, '<d>[English] $1</d>');
}

function rewriteH3(author: string, words: string, roll: number): string {
  const visual = visualWords(words) || words;
  const spoken = withSpokenTags(words);
  const camera = H3_CAMERAS[roll % H3_CAMERAS.length];
  const shot = `[Shot 1] Live-action, cinematic, ${camera} with small amplitude at slow speed. ${spoken}`;
  const align = h3Align(author);
  const hasRef = /subject_definitions|detailed_description/i.test(author);
  const hasImd = /integrated_multimodal_description|\[Shot\s+\d+/i.test(author);
  const hasSound = /overall_soundscape/i.test(author);
  const hasMusic = /non_diegetic_music/i.test(author);
  if (hasRef && !hasImd) {
    return [
      align,
      'subject_definitions:',
      'summary:',
      'retention_analysis:',
      `detailed_description: ${spoken}`,
      hasSound ? `overall_soundscape: ${visual}` : '',
      hasMusic ? 'non_diegetic_music: N/A' : '',
    ].filter(Boolean).join('\n');
  }
  return [
    align,
    `integrated_multimodal_description: ${shot}`,
    hasSound ? `overall_soundscape: ${visual}` : '',
    hasMusic ? 'non_diegetic_music: N/A' : '',
  ].filter(Boolean).join('\n');
}

function h3Align(author: string): string {
  if (/For the target video/i.test(author)) {
    return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
  }
  const fl = author.match(/How the reference pictures align[\s\S]*?(?=\n\s*\n|integrated_multimodal_description|subject_definitions|$)/i);
  if (fl) return fl[0].trim();
  return '';
}

function applyLines(originals: string[], supplied: string[]): string[] {
  if (!supplied.length) return originals;
  return originals.map((line, index) => supplied[index] ?? line);
}

export interface RewriteStep {
  kind?: 'image' | 'video';
  engine?: string;
}

function hisClauses(words: string, pony: boolean): string[] {
  let text = words.trim();
  const quotes: string[] = [];
  text = text.replace(/"([^"\n]*)"/g, (_match, quote: string) => {
    quotes.push(`"${quote}"`);
    return ' ';
  });
  if (pony) {
    text = text
      .replace(/\bwomen\b/gi, 'female')
      .replace(/\bwoman\b/gi, 'female')
      .replace(/\bmen\b/gi, 'male')
      .replace(/\bman\b/gi, 'male');
  }
  const clauses = text.split(',').map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...clauses, ...quotes];
}

function rollClauses(clauses: string[], roll: number): string[] {
  if (clauses.length < 2) return clauses;
  const turn = roll % clauses.length;
  return [...clauses.slice(turn), ...clauses.slice(0, turn)];
}

function imageFamily(engine: string): 'pony' | 'illustrious' | 'zimage' | 'klein' | 'plain' {
  const name = engine.toLowerCase();
  if (name.includes('pony')) return 'pony';
  if (name.includes('illustrious') || name.includes('wai')) return 'illustrious';
  if (name.includes('z-image') || name.includes('zimage') || name.includes('cyberrealistic')) return 'zimage';
  if (name.includes('klein') || name.includes('flux') || name.includes('snofs')) return 'klein';
  return 'plain';
}

/** Published image negative. Empty string clears it. Null leaves the graph alone. */
export function publishedImageNegative(engine: string): string | null {
  switch (imageFamily(engine)) {
    case 'pony':
      return 'score_4, score_5, score_6';
    case 'illustrious':
      return 'bad quality,worst quality,worst detail,sketch,censor,';
    case 'zimage':
    case 'klein':
      return '';
    default:
      return null;
  }
}

function rewriteImageStyle(engine: string, words: string, roll: number): string {
  const family = imageFamily(engine);
  if (family === 'pony') return `${PONY_SCORES}${rollClauses(hisClauses(words, true), roll).join(', ')}`;
  if (family === 'illustrious') return `${rollClauses(hisClauses(words, false), roll).join(', ')},${ILLUSTRIOUS_QUALITY}`;
  if (family === 'zimage' || family === 'klein') {
    const clauses = hisClauses(words, false);
    const quotes = clauses.filter((clause) => clause.startsWith('"'));
    const body = clauses.filter((clause) => !clause.startsWith('"'));
    const sentence = roll % 2 === 0 || body.length < 2 ? words : `${body.join('. ')}.${quotes.length ? ` ${quotes.join(' ')}` : ''}`;
    return sentence;
  }
  return words;
}

/**
 * Video steps use the published video prompt styles. Image steps use the
 * published image prompt styles. His subject, action, and quotes stay.
 * The sample sentences in those notes are not copied.
 */
export function rewriteInAuthorStyle(author: string, userWords: string, roll: number, step?: RewriteStep): string {
  const words = userWords.trim();
  if (!words) return author;
  if (step?.kind === 'video') return rewriteVideoStyle(step.engine ?? '', author, words, roll);
  if (step?.kind === 'image') return rewriteImageStyle(step.engine ?? '', words, roll);
  const authorLines = spokenLines(author);
  const userLines = spokenLines(words);
  const lines = applyLines(authorLines, userLines);
  if (/\[Shot\s+\d+/i.test(author) || /integrated_multimodal_description/i.test(author)) {
    return rewriteShotScript(author, words, roll, lines);
  }
  if (BEAT.test(author)) {
    return rewriteBeats(author, words, roll, lines);
  }
  if (isTagPrompt(author)) return rewriteTags(author, words, roll);
  return rewriteProse(author, words, roll, lines);
}

function rewriteShotScript(author: string, words: string, roll: number, lines: string[]): string {
  const shotRe = /\[Shot\s+\d+[^\]]*\]/gi;
  const shots = [...author.matchAll(shotRe)];
  const headEnd = shots.length ? shots[0].index ?? 0 : 0;
  const tailStart = author.search(/\n\s*overall_soundscape\s*:/i);
  const head = author.slice(0, headEnd).trim();
  const tail = tailStart >= 0 ? author.slice(tailStart).trim() : '';
  const cameras = camerasIn(author);
  const styles = styleBits(author);
  const style = styles.slice(0, 2).join(', ');
  let lineAt = 0;
  const blocks = shots.map((shot, index) => {
    const from = shot.index ?? 0;
    const to = index + 1 < shots.length ? (shots[index + 1].index ?? author.length) : tailStart >= 0 ? tailStart : author.length;
    const body = author.slice(from, to);
    const ownLines = spokenLines(body);
    const taken = lines.slice(lineAt, lineAt + ownLines.length);
    lineAt += ownLines.length;
    const camera = cameras.length ? cameras[(index + roll) % cameras.length] : '';
    const prefix = [style, camera].filter(Boolean).join(', ');
    const spoken = taken.map((line, i) => dialogueTag(ownLines[i] ? body : '', line, ownLines[i] ?? line));
    return `${shot[0]} ${prefix ? `${prefix}. ` : ''}${rollWords(words, roll)}${spoken.length ? ` ${spoken.join(' ')}` : ''}`;
  });
  return [head, blocks.join('\n\n'), tail].filter(Boolean).join('\n\n');
}

function dialogueTag(body: string, line: string, originalLine: string): string {
  const wrapped = body.match(/<d>\s*(\[[^\]]+\])?/i);
  if (wrapped) {
    const lang = wrapped[1] ? `${wrapped[1]} ` : '';
    return `<d>${lang}${line}</d>`;
  }
  if (originalLine && body.includes(`"${originalLine}"`)) return `"${line}"`;
  return `<d>${line}</d>`;
}

function rewriteBeats(author: string, words: string, roll: number, lines: string[]): string {
  const parts = author.split(/(?=(?<!\d)\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s\s*:)/);
  const cameras = camerasIn(author);
  let lineAt = 0;
  return parts
    .map((part) => {
      const match = part.match(/^((?<!\d)\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s\s*:\s*)([\s\S]*)$/);
      if (!match) return words;
      const own = camerasIn(match[2]);
      const camera = cameras.length
        ? cameras[(Math.max(0, cameras.findIndex((item) => own[0] && item.toLowerCase() === own[0].toLowerCase())) + roll) % cameras.length]
        : '';
      const ownLines = spokenLines(match[2]);
      const taken = lines.slice(lineAt, lineAt + ownLines.length);
      lineAt += ownLines.length;
      const spoken = taken.map((line) => `"${line}"`).join(' ');
      return `${match[1]}${camera ? `${camera}, ` : ''}${rollWords(words, roll)}${spoken ? `. ${spoken}` : ''}`;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTagPrompt(text: string): boolean {
  const parts = text.split(',');
  return parts.length >= 6 && parts.every((part) => part.trim().length > 0 && part.trim().length < 48);
}

function rewriteTags(author: string, words: string, roll: number): string {
  const style = author
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /score_|rating_|source_|masterpiece|best quality|highly detailed|embedding:|\bBREAK\b/i.test(part));
  if (roll > 0 && style.length > 1) {
    const turn = roll % style.length;
    style.unshift(...style.splice(turn));
  }
  return [...style, words].filter(Boolean).join(', ');
}

function rollWords(words: string, roll: number): string {
  if (roll % 2 === 0) return words;
  const clauses = words.split(/,\s*/);
  if (clauses.length > 1) return [...clauses.slice(1), clauses[0]].join(', ');
  const tokens = words.split(/\s+/);
  if (tokens.length > 4) return [...tokens.slice(2), ...tokens.slice(0, 2)].join(' ');
  return words;
}

function rewriteProse(author: string, words: string, roll: number, lines: string[]): string {
  const bits = styleBits(author);
  const bit = bits.length ? bits[roll % bits.length] : '';
  const spoken = lines.map((line) => `"${line}"`).join(' ');
  const lead = author.trim().startsWith('A ') || author.trim().startsWith('An ');
  const bodyWords = rollWords(words, roll);
  const body = roll % 2 === 0
    ? `${lead ? 'A ' : ''}${bodyWords}${bit ? `, ${bit}` : ''}`
    : `${bit ? `${bit}, ` : ''}${bodyWords}`;
  return `${body}${spoken ? `. ${spoken}` : '.'}`;
}

function allPromptTexts(graph: ApiGraph): string[] {
  const texts: string[] = [];
  for (const node of Object.values(graph)) {
    for (const field of TEXT_FIELDS) {
      const value = node.inputs[field];
      if (typeof value === 'string' && isPromptText(value)) texts.push(value);
    }
  }
  return texts;
}

function sceneCount(texts: string[]): number {
  const blob = texts.join('\n');
  const shots = new Set<string>();
  for (const match of blob.matchAll(/\[Shot\s+(\d+)/gi)) shots.add(match[1]);
  if (shots.size) return shots.size;
  return 0;
}

function beatSeconds(texts: string[]): number | null {
  let max = 0;
  for (const text of texts) {
    for (const match of text.matchAll(/(?<!\d)\d+(?:\.\d+)?\s*-\s*(\d+(?:\.\d+)?)\s*s\s*:/gi)) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return max > 0 ? max : null;
}

function durationSeconds(graph: ApiGraph): number | null {
  let max = 0;
  for (const node of Object.values(graph)) {
    if (!VIDEO_NODE_RE.test(node.class_type) && node.class_type !== 'VHS_VideoCombine') continue;
    const duration = asNumber(node.inputs.duration);
    if (duration && duration > max) max = duration;
  }
  return max > 0 ? max : null;
}

function expressionSeconds(graph: ApiGraph): number | null {
  let max = 0;
  for (const node of Object.values(graph)) {
    if (!/EmptyLTXVLatentVideo|LTXVEmptyLatentAudio|VHS_VideoCombine|EmptyHunyuanLatentVideo/.test(node.class_type)) continue;
    const lengthId = linkId(node.inputs.length) ?? linkId(node.inputs.frames_number) ?? linkId(node.inputs.frames);
    if (!lengthId) {
      const direct = asNumber(node.inputs.length) ?? asNumber(node.inputs.frames);
      const fps = asNumber(node.inputs.frame_rate) ?? asNumber(node.inputs.fps);
      if (direct && fps && fps > 0) max = Math.max(max, direct / fps);
      continue;
    }
    const math = graph[lengthId];
    if (!math || math.class_type !== 'ComfyMathExpression') continue;
    const expr = typeof math.inputs.expression === 'string' ? math.inputs.expression.replace(/\s+/g, '') : '';
    if (expr !== 'a*b+1' && expr !== 'a*b') continue;
    const a = primitiveValue(graph, linkId(math.inputs['values.a']));
    const b = primitiveValue(graph, linkId(math.inputs['values.b']));
    if (a == null || b == null) continue;
    const seconds = FPS_VALUES.has(a) ? b : FPS_VALUES.has(b) ? a : null;
    if (seconds && seconds > max) max = seconds;
  }
  return max > 0 ? max : null;
}

function primitiveValue(graph: ApiGraph, id: string | null): number | null {
  if (!id || !graph[id]) return null;
  return asNumber(graph[id].inputs.value);
}

function hasLoadImage(graph: ApiGraph): boolean {
  for (const node of Object.values(graph)) {
    if (!/LoadImage|PixaromaLoadImage/.test(node.class_type)) continue;
    const image = node.inputs.image ?? node.inputs.image_path;
    if (typeof image === 'string' && image.trim()) return true;
  }
  for (const node of Object.values(graph)) {
    const timeline = node.inputs.timeline_data;
    if (typeof timeline === 'string' && /"type"\s*:\s*"image"/i.test(timeline)) return true;
  }
  return false;
}

function hasImageSampler(graph: ApiGraph): boolean {
  for (const [id, node] of Object.entries(graph)) {
    if (!/^KSampler/.test(node.class_type)) continue;
    const ids = ancestorIds(graph, id, true);
    if (ids.some((item) => IMAGE_LATENT_RE.test(graph[item].class_type))) return true;
  }
  return false;
}

function hasVideo(graph: ApiGraph): boolean {
  return Object.values(graph).some((node) => VIDEO_NODE_RE.test(node.class_type));
}

function enginesInOrder(graph: ApiGraph): string[] {
  const found: string[] = [];
  const consider = (value: string) => {
    const label = engineLabel(value);
    if (label && !found.includes(label)) found.push(label);
  };
  for (const node of Object.values(graph)) {
    if (LOADER_RE.test(node.class_type)) {
      for (const [key, value] of Object.entries(node.inputs)) {
        if (typeof value === 'string' && /unet|ckpt|model/i.test(key)) consider(value);
      }
    }
    if (node.class_type === 'MiniMaxH3Director') {
      for (const key of ['fl2va_model', 'ref2va_model']) {
        const value = node.inputs[key];
        if (typeof value === 'string') consider(value);
      }
    }
  }
  return found;
}

function purposeLine(texts: string[]): string | null {
  const ordered = [...texts].sort((a, b) => b.length - a.length);
  for (const text of ordered) {
    const imd = text.split(/integrated_multimodal_description\s*:/i)[1];
    const source = (imd ?? text).replace(/<[^>]+>/g, ' ');
    const shot = source.match(/\[Shot\s+\d+[^\]]*\]\s*([^)\n][\s\S]{20,160}?)(?:\.|<d>|\n)/i);
    const sentence = (shot ? shot[1] : source).split(/(?<=\.)\s/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
    if (sentence.length >= 20 && !sentence.startsWith(')')) return sentence.slice(0, 180);
  }
  return null;
}

export function describeWorkflow(raw: unknown): WorkflowBrief {
  const graph = apiGraphOf(raw);
  if (!graph) return uiBrief(raw);
  const texts = allPromptTexts(graph);
  const steps = authorGenerateSteps(raw);
  const scenes = sceneCount(texts) || steps.length;
  const stepEngines = steps.map((step) => step.engine).filter((engine) => engine && engine !== 'the model in the graph');
  const seconds = beatSeconds(texts) ?? durationSeconds(graph) ?? expressionSeconds(graph);
  const videoNode = hasVideo(graph);
  const video: WorkflowBrief['video'] = !videoNode ? 'none' : seconds == null ? 'unknown' : seconds >= LONG_SECONDS ? 'long' : 'short';
  const needsStartImage = hasLoadImage(graph) || (videoNode && !hasImageSampler(graph) && /ImageToVideo|I2V|ImgToVideo|ReferenceToVideo|Director/.test(Object.values(graph).map((node) => node.class_type).join(' ')));
  const makesOwnStartImage = !needsStartImage && hasImageSampler(graph) && videoNode;
  const engines = stepEngines.length ? [...new Set(stepEngines)] : enginesInOrder(graph);
  const purpose = purposeLine(texts);
  const how = howLine(steps, makesOwnStartImage, videoNode);
  const blurb = [
    engines.length ? `Engine: ${engines.join(', then ')}.` : 'The graph names no diffusion model.',
    scenes ? `${scenes} scene${scenes === 1 ? '' : 's'}.` : 'The graph does not split this into scenes.',
    needsStartImage ? 'It needs a start image.' : makesOwnStartImage ? 'It makes its own start image.' : 'It does not use a start image.',
    videoSentence(video, seconds),
    how,
    purpose,
  ].filter(Boolean).join(' ');
  return { engines, scenes, needsStartImage, makesOwnStartImage, video, seconds, blurb };
}

function howLine(steps: AuthorStep[], makesOwn: boolean, videoNode: boolean): string {
  if (!steps.length) {
    if (videoNode) return 'The graph renders a video.';
    return 'The graph samples an image.';
  }
  const parts = steps.map((step) => {
    const loras = step.loras.map((lora) => fileStem(lora.file));
    const loraText = loras.length ? ` with the LoRA${loras.length === 1 ? '' : 's'} ${loras.join(' and ')}` : '';
    return step.kind === 'video'
      ? `renders the video on ${step.engine}${loraText}`
      : `samples a still on ${step.engine}${loraText}`;
  });
  const lead = makesOwn ? 'It makes the start image, then ' : 'It ';
  return `${lead}${parts.join(', then ')}.`;
}

function videoSentence(video: WorkflowBrief['video'], seconds: number | null): string {
  if (video === 'none') return 'It is a still, not a video.';
  if (video === 'unknown') return 'It is a video. The graph does not say the length.';
  const length = seconds == null ? '' : ` (${trimSeconds(seconds)} seconds)`;
  return video === 'long' ? `It is a long video${length}.` : `It is a short video${length}.`;
}

function trimSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function uiBrief(raw: unknown): WorkflowBrief {
  const nodes = uiNodes(raw);
  if (!nodes.length) {
    return {
      engines: [],
      scenes: 0,
      needsStartImage: false,
      makesOwnStartImage: false,
      video: 'none',
      seconds: null,
      blurb: 'This workflow file has no graph to describe.',
    };
  }
  const types = nodes.map((node) => node.type);
  const blob = types.join(' ');
  const texts = nodes.flatMap((node) => node.texts);
  const engines: string[] = [];
  for (const node of nodes) {
    for (const text of node.texts) {
      const label = engineLabel(text);
      if (label && !engines.includes(label)) engines.push(label);
    }
  }
  const videoNode = VIDEO_NODE_RE.test(blob);
  const needsStartImage = /LoadImage/.test(blob);
  const scenes = sceneCount(texts);
  const seconds = beatSeconds(texts);
  const video: WorkflowBrief['video'] = !videoNode ? 'none' : seconds == null ? 'unknown' : seconds >= LONG_SECONDS ? 'long' : 'short';
  const purpose = purposeLine(texts.filter((text) => isPromptText(text)));
  const blurb = [
    engines.length ? `Engine: ${engines.join(', then ')}.` : 'The graph names no diffusion model.',
    scenes ? `${scenes} scene${scenes === 1 ? '' : 's'}.` : 'The graph does not split this into scenes.',
    needsStartImage ? 'It needs a start image.' : 'It does not use a start image.',
    videoSentence(video, seconds),
    videoNode ? 'The graph renders a video.' : 'The graph samples an image.',
    purpose,
  ].filter(Boolean).join(' ');
  return { engines, scenes, needsStartImage, makesOwnStartImage: false, video, seconds, blurb };
}

function uiNodes(raw: unknown): { type: string; texts: string[] }[] {
  if (!raw || typeof raw !== 'object') return [];
  const outer = raw as Record<string, unknown>;
  const graph = outer.nodes ? outer : outer.workflow && typeof outer.workflow === 'object' ? (outer.workflow as Record<string, unknown>) : null;
  if (!graph || !Array.isArray(graph.nodes)) return [];
  return graph.nodes.flatMap((node) => {
    if (!node || typeof node !== 'object') return [];
    const type = typeof (node as { type?: unknown }).type === 'string' ? (node as { type: string }).type : '';
    const widgets = (node as { widgets_values?: unknown }).widgets_values;
    const texts = Array.isArray(widgets) ? widgets.filter((item): item is string => typeof item === 'string') : [];
    return [{ type, texts }];
  });
}

function stillKeep(graph: ApiGraph, samplerId: string): { keep: Set<string>; dangling: { id: string; field: string }[]; decodeId: string | null } {
  const keep = new Set<string>();
  const dangling: { id: string; field: string }[] = [];
  const stack = [samplerId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || keep.has(id) || !graph[id]) continue;
    keep.add(id);
    for (const [field, value] of Object.entries(graph[id].inputs)) {
      const src = linkId(value);
      if (!src || !graph[src]) continue;
      if (src !== samplerId && BOUNDARY_RE.test(graph[src].class_type)) {
        dangling.push({ id, field });
        continue;
      }
      stack.push(src);
    }
  }
  let decodeId: string | null = null;
  const down = [samplerId];
  const seen = new Set<string>([samplerId]);
  while (down.length) {
    const id = down.shift();
    if (!id) continue;
    for (const next of consumersOf(graph, id)) {
      if (seen.has(next.id)) continue;
      const node = graph[next.id];
      if (!node || node.class_type === 'KSampler') continue;
      if (SAMPLER_RE.test(node.class_type)) {
        seen.add(next.id);
        keep.add(next.id);
        for (const anc of ancestorIds(graph, next.id, true)) {
          if (!BOUNDARY_RE.test(graph[anc].class_type) || anc === next.id) keep.add(anc);
        }
        down.push(next.id);
        continue;
      }
      seen.add(next.id);
      if (/^VAEDecode/.test(node.class_type)) {
        decodeId = next.id;
        keep.add(next.id);
        const vae = linkId(node.inputs.vae);
        if (vae && graph[vae] && !BOUNDARY_RE.test(graph[vae].class_type)) {
          for (const anc of ancestorIds(graph, vae, true)) {
            if (!BOUNDARY_RE.test(graph[anc].class_type) || anc === vae) keep.add(anc);
          }
        }
        continue;
      }
      if (/Preview|SaveImage|SaveVideo|CreateVideo|VHS_|FrameInterpolate|ReActor|Resize|ImageScale|LoadImage/.test(node.class_type)) continue;
      keep.add(next.id);
      down.push(next.id);
    }
  }
  return { keep, dangling, decodeId };
}

function shortenStill(graph: ApiGraph, keep: Set<string>): void {
  for (const id of keep) {
    const node = graph[id];
    const duration = asNumber(node.inputs.duration);
    if (duration != null && duration > 2 && /MiniMax|Video|LTX|Wan|Hunyuan/.test(node.class_type)) node.inputs.duration = 2;
  }
  for (const id of keep) {
    const node = graph[id];
    if (!/EmptyLTXVLatentVideo|LTXVEmptyLatentAudio|VHS_VideoCombine|EmptyHunyuanLatentVideo/.test(node.class_type)) continue;
    const lengthId = linkId(node.inputs.length) ?? linkId(node.inputs.frames_number);
    const math = lengthId ? graph[lengthId] : null;
    if (!math || math.class_type !== 'ComfyMathExpression') continue;
    for (const key of ['values.a', 'values.b'] as const) {
      const pid = linkId(math.inputs[key]);
      if (!pid || !graph[pid]) continue;
      const value = asNumber(graph[pid].inputs.value);
      if (value != null && value >= LONG_SECONDS && !FPS_VALUES.has(value)) graph[pid].inputs.value = 2;
    }
  }
}

function applySeed(graph: ApiGraph, samplerId: string, seed: number, keep?: Set<string>): void {
  const sampler = graph[samplerId];
  if (!sampler) return;
  if ('seed' in sampler.inputs) sampler.inputs.seed = seed;
  if ('noise_seed' in sampler.inputs) sampler.inputs.noise_seed = seed;
  const ids = keep ? [...keep] : ancestorIds(graph, samplerId, true);
  for (const id of ids) {
    const node = graph[id];
    if (!node) continue;
    if (node.class_type === 'RandomNoise' || 'noise_seed' in node.inputs) node.inputs.noise_seed = seed;
  }
}

/**
 * A start-image prompt for one author step.
 * Video steps keep that step's model and LoRAs and use `startImage` where the
 * graph's still would have fed them. The full workflow is not shortened here;
 * only this preview graph uses a short length.
 */
export function buildStepStill(raw: unknown, step: AuthorStep, promptText: string, seed: number, startImage: string | null): StillBuild | null {
  const graph = apiGraphOf(raw);
  if (!graph || !step.samplerId || !graph[step.samplerId]) return null;
  const { keep, dangling, decodeId } = stillKeep(graph, step.samplerId);
  if (!decodeId) return null;
  if (dangling.length && !startImage && step.kind === 'video') return null;
  const prompt: ApiGraph = {};
  for (const id of keep) prompt[id] = JSON.parse(JSON.stringify(graph[id])) as ApiNode;
  const source = prompt[step.nodeId];
  if (source && step.field in source.inputs) source.inputs[step.field] = promptText;
  shortenStill(prompt, new Set(Object.keys(prompt)));
  applySeed(prompt, step.samplerId, seed, new Set(Object.keys(prompt)));
  if (dangling.length && startImage) {
    prompt.incard_load = { class_type: 'LoadImage', inputs: { image: startImage } };
    for (const edge of dangling) {
      if (!prompt[edge.id]) continue;
      prompt[edge.id].inputs[edge.field] = ['incard_load', 0];
    }
  }
  prompt.incard_save = { class_type: 'SaveImage', inputs: { images: [decodeId, 0], filename_prefix: 'incard' } };
  return { prompt, seed };
}

export interface ApprovedEdit {
  nodeId: string;
  field: string;
  text: string;
  samplerId: string | null;
  seed: number | null;
  image: string | null;
  kind: 'image' | 'video';
  engine?: string;
}

/**
 * Full author graph with the rewritten prompts, the accepted seeds, and the
 * accepted stills wired in. Video length stays as the author set it.
 */
export function applyApprovedRun(raw: unknown, edits: ApprovedEdit[]): ApiGraph | null {
  const graph = apiGraphOf(raw);
  if (!graph) return null;
  const prompt = cloneGraph(graph);
  for (const edit of edits) {
    const node = prompt[edit.nodeId];
    if (node && edit.field in node.inputs) node.inputs[edit.field] = edit.text;
    if (edit.samplerId && edit.seed != null) applySeed(prompt, edit.samplerId, edit.seed);
    if (edit.kind === 'image' && edit.engine && edit.samplerId) {
      const negative = publishedImageNegative(edit.engine);
      if (negative !== null) setNegativeText(prompt, edit.samplerId, negative);
    }
    if (edit.image && edit.kind === 'image' && edit.samplerId) injectStill(prompt, edit.samplerId, edit.image);
    if (edit.image && edit.kind === 'video' && edit.samplerId) replaceAncestralLoadImages(prompt, edit.samplerId, edit.image);
  }
  return prompt;
}

function nearestDecode(graph: ApiGraph, samplerId: string): string | null {
  const stack = [samplerId];
  const seen = new Set<string>();
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    for (const next of consumersOf(graph, id)) {
      const node = graph[next.id];
      if (!node || node.class_type === 'KSampler') continue;
      if (/^VAEDecode/.test(node.class_type)) return next.id;
      if (/Preview|Save|ReActor|Resize|Image|Video|LTX|Wan|MiniMax|Hunyuan/.test(node.class_type)) continue;
      stack.push(next.id);
    }
  }
  return null;
}

function injectStill(graph: ApiGraph, samplerId: string, filename: string): void {
  const decodeId = nearestDecode(graph, samplerId);
  if (!decodeId) {
    replaceAncestralLoadImages(graph, samplerId, filename);
    return;
  }
  const loadId = `incard_load_${samplerId.replace(/[^a-zA-Z0-9]/g, '_')}`;
  graph[loadId] = { class_type: 'LoadImage', inputs: { image: filename } };
  graph[`incard_save_${samplerId.replace(/[^a-zA-Z0-9]/g, '_')}`] = {
    class_type: 'SaveImage',
    inputs: { images: [decodeId, 0], filename_prefix: 'incard_full' },
  };
  for (const next of consumersOf(graph, decodeId)) {
    const node = graph[next.id];
    if (!node || node.class_type === 'SaveImage') continue;
    if (linkId(node.inputs[next.field]) === decodeId) node.inputs[next.field] = [loadId, 0];
  }
}

function setNegativeText(graph: ApiGraph, samplerId: string, text: string): void {
  for (const [nodeId, node] of Object.entries(graph)) {
    for (const field of TEXT_FIELDS) {
      if (typeof node.inputs[field] !== 'string') continue;
      const hit = followToSampler(graph, nodeId);
      if (hit?.negative && hit.samplerId === samplerId) node.inputs[field] = text;
    }
  }
}

function replaceAncestralLoadImages(graph: ApiGraph, samplerId: string, filename: string): void {
  const ids = ancestorIds(graph, samplerId, false);
  for (const id of ids) {
    const node = graph[id];
    if (!/LoadImage|PixaromaLoadImage/.test(node.class_type)) continue;
    if (typeof node.inputs.image === 'string') node.inputs.image = filename;
    if (typeof node.inputs.image_path === 'string') node.inputs.image_path = filename;
  }
}

export function firstOutputImage(entry: HistoryEntry | undefined): ImageRef | null {
  if (!entry?.outputs) return null;
  for (const output of Object.values(entry.outputs)) {
    if (!output || typeof output !== 'object') continue;
    const images = output.images ?? [];
    if (images.length) return images[0];
    for (const value of Object.values(output)) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        if (item && typeof item === 'object' && typeof (item as ImageRef).filename === 'string') {
          const file = item as ImageRef;
          if (/\.(png|jpe?g|webp|mp4|webm|gif)$/i.test(file.filename)) return file;
        }
      }
    }
  }
  return null;
}

export async function waitForIdleQueue(
  getQueue: () => Promise<{ queue_running: unknown[]; queue_pending: unknown[] }>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<void> {
  for (;;) {
    const queue = await getQueue();
    if (queue.queue_running.length === 0 && queue.queue_pending.length === 0) return;
    await sleep(3000);
  }
}
