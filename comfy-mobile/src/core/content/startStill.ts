/**
 * Start-image graphs for in-card generate.
 *
 * One still per author step. A step whose prompt is several scenes (shot
 * marks or time beats) returns one graph per scene. Each graph keeps that
 * step's engine and LoRAs, stays NSFW, and writes the rewritten sentence
 * into the author's text field. Every link points at a node in the graph.
 */
import {
  apiGraphOf,
  authorGenerateSteps,
  type ApiGraph,
  type ApiNode,
  type AuthorStep,
  type StepLora,
} from './inCardGenerate';

export interface StartStill {
  /** Author step id, `nodeId:field`. */
  stepId: string;
  /** 1-based scene inside this step. A one-scene step is scene 1. */
  scene: number;
  kind: 'image' | 'video';
  engine: string;
  engineFile: string;
  loras: StepLora[];
  /** The card is NSFW. The still uses that step's NSFW engine and LoRAs. */
  nsfw: true;
  /** The rewritten sentence the caller passed in. */
  text: string;
  prompt: ApiGraph;
  seed: number;
}

const IMAGE_DECODE_RE = /VAEDecode|AVDecode|TiledVAEDecode/;
const AUDIO_DECODE_RE = /Audio/;
const BEAT_RE = /(?<!\d)\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*s\s*:/gi;
const SHOT_RE = /\[Shot\s+(\d+)/gi;
const LONG_SECONDS = 8;
const FPS_VALUES = new Set([8, 12, 16, 24, 25, 30, 48]);

export interface StartStillPlan {
  step: AuthorStep;
  scene: number;
}

/** How many stills this step needs. Shots, otherwise time beats, otherwise one. */
export function scenesInAuthorPrompt(text: string): number {
  const shots = new Set<string>();
  for (const match of text.matchAll(SHOT_RE)) shots.add(match[1]);
  if (shots.size > 1) return shots.size;
  const beats = text.match(BEAT_RE);
  if (beats && beats.length > 1) return beats.length;
  return 1;
}

/**
 * One plan per scene. A long or multi-scene prompt expands to one entry per scene.
 */
export function startStillPlans(raw: unknown): StartStillPlan[] {
  const plans: StartStillPlan[] = [];
  for (const step of authorGenerateSteps(raw)) {
    const count = scenesInAuthorPrompt(step.authorPrompt);
    for (let scene = 1; scene <= count; scene++) plans.push({ step, scene });
  }
  return plans;
}

export interface SkippedStill {
  stepId: string;
  scene: number;
  reason: string;
}

/**
 * Still-image prompts for every scene in this copy card or workflow.
 * `text` is the user's sentence already rewritten into the author's format.
 * A step with no image decode, or whose prompt node is not on that image, is skipped.
 */
export function collectStartStills(raw: unknown, text: string, seed = 0): { stills: StartStill[]; skipped: SkippedStill[] } {
  const graph = apiGraphOf(raw);
  const plans = startStillPlans(raw);
  if (!graph || !plans.length) return { stills: [], skipped: [] };
  const samplerIds = new Set(plans.map((plan) => plan.step.samplerId).filter((id): id is string => !!id));
  const stills: StartStill[] = [];
  const skipped: SkippedStill[] = [];
  for (const plan of plans) {
    const built = buildOne(graph, plan.step, plan.scene, text, seed, samplerIds);
    if ('skip' in built) skipped.push({ stepId: plan.step.id, scene: plan.scene, reason: built.skip });
    else stills.push(built);
  }
  return { stills, skipped };
}

export function buildStartStills(raw: unknown, text: string, seed = 0): StartStill[] {
  return collectStartStills(raw, text, seed).stills;
}

function buildOne(graph: ApiGraph, step: AuthorStep, scene: number, text: string, seed: number, samplerIds: Set<string>): StartStill | { skip: string } {
  if (!step.samplerId || !graph[step.samplerId]) {
    return { skip: 'no sampler' };
  }
  const samplerId = step.samplerId;
  const stop = new Set<string>();
  for (const id of samplerIds) if (id !== samplerId) stop.add(id);
  const decodeId = imageDecode(graph, samplerId, stop);
  if (!decodeId) return { skip: `no image decode (${graph[samplerId].class_type})` };

  const { keep, dangling } = ancestorsExceptOtherScenes(graph, decodeId, samplerId, stop);
  const prompt: ApiGraph = {};
  for (const id of keep) prompt[id] = cloneNode(graph[id]);
  rewireCuts(prompt, graph, dangling);
  const source = prompt[step.nodeId];
  if (!source || !(step.field in source.inputs)) {
    return { skip: 'prompt node is not on this image' };
  }
  source.inputs[step.field] = text;
  shortenStill(prompt);
  applySeed(prompt, samplerId, seed);
  prompt.incard_save = {
    class_type: 'SaveImage',
    inputs: { images: [decodeId, 0], filename_prefix: `incard-s${scene}` },
  };
  const closed = pruneToSave(prompt);
  assertClosed(closed, step.id);
  return {
    stepId: step.id,
    scene,
    kind: step.kind,
    engine: step.engine,
    engineFile: step.engineFile,
    loras: step.loras.map((lora) => ({ ...lora })),
    nsfw: true,
    text,
    prompt: closed,
    seed,
  };
}

function imageDecode(graph: ApiGraph, samplerId: string, stop: Set<string>): string | null {
  const seen = new Set<string>();
  const queue = [samplerId];
  const samplerMemo = new Map<string, boolean>();
  const stopMemo = new Map<string, boolean>();
  while (queue.length) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const node = graph[id];
    if (!node) continue;
    if (id !== samplerId && isImageDecode(node.class_type) && hitsSampler(graph, id, samplerId, samplerMemo)) return id;
    for (const next of consumers(graph, id)) {
      if (seen.has(next) || stop.has(next)) continue;
      if (otherSceneOnly(graph, next, samplerId, stop, samplerMemo, stopMemo)) continue;
      queue.push(next);
    }
  }
  return null;
}

function isImageDecode(classType: string): boolean {
  return IMAGE_DECODE_RE.test(classType) && !AUDIO_DECODE_RE.test(classType);
}

/** True when some upstream path reaches `samplerId`. */
function hitsSampler(graph: ApiGraph, id: string, samplerId: string, memo: Map<string, boolean>): boolean {
  if (id === samplerId) return true;
  const cached = memo.get(id);
  if (cached != null) return cached;
  memo.set(id, false);
  const node = graph[id];
  if (!node) return false;
  for (const value of Object.values(node.inputs)) {
    const src = linkId(value);
    if (!src || !graph[src]) continue;
    if (hitsSampler(graph, src, samplerId, memo)) {
      memo.set(id, true);
      return true;
    }
  }
  return false;
}

/**
 * True when an upstream path reaches another scene's sampler without passing
 * through this step's sampler. A join that also feeds this sampler is not
 * other-scene-only.
 */
function otherSceneOnly(
  graph: ApiGraph,
  id: string,
  samplerId: string,
  stop: Set<string>,
  samplerMemo: Map<string, boolean>,
  stopMemo: Map<string, boolean>,
): boolean {
  return hitsStop(graph, id, stop, samplerId, stopMemo) && !hitsSampler(graph, id, samplerId, samplerMemo);
}

function hitsStop(graph: ApiGraph, id: string, stop: Set<string>, samplerId: string, memo: Map<string, boolean>): boolean {
  if (id === samplerId) return false;
  if (stop.has(id)) return true;
  const cached = memo.get(id);
  if (cached != null) return cached;
  memo.set(id, false);
  const node = graph[id];
  if (!node) return false;
  for (const value of Object.values(node.inputs)) {
    const src = linkId(value);
    if (!src || !graph[src]) continue;
    if (hitsStop(graph, src, stop, samplerId, memo)) {
      memo.set(id, true);
      return true;
    }
  }
  return false;
}

function ancestorsExceptOtherScenes(
  graph: ApiGraph,
  decodeId: string,
  samplerId: string,
  stop: Set<string>,
): { keep: Set<string>; dangling: { id: string; field: string }[] } {
  const keep = new Set<string>();
  const dangling: { id: string; field: string }[] = [];
  const samplerMemo = new Map<string, boolean>();
  const stack = [decodeId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || keep.has(id) || !graph[id]) continue;
    keep.add(id);
    for (const [field, value] of Object.entries(graph[id].inputs)) {
      const src = linkId(value);
      if (!src || !graph[src]) continue;
      if (crossesScene(graph, src, samplerId, stop, samplerMemo)) {
        dangling.push({ id, field });
        continue;
      }
      stack.push(src);
    }
  }
  return { keep, dangling };
}

/** Cut the edge that enters another scene's sampler or its decoded image. */
function crossesScene(
  graph: ApiGraph,
  src: string,
  samplerId: string,
  stop: Set<string>,
  samplerMemo: Map<string, boolean>,
): boolean {
  if (src === samplerId) return false;
  if (stop.has(src)) return true;
  const node = graph[src];
  if (!node || !isImageDecode(node.class_type)) return false;
  return !hitsSampler(graph, src, samplerId, samplerMemo);
}

function rewireCuts(prompt: ApiGraph, source: ApiGraph, dangling: { id: string; field: string }[]): void {
  let needsImage = false;
  let needsLatent = false;
  for (const edge of dangling) {
    const node = prompt[edge.id];
    const target = source[linkId(source[edge.id]?.inputs[edge.field]) ?? ''];
    if (!node) continue;
    if (target && isImageCut(edge.field, target)) needsImage = true;
    else needsLatent = true;
  }
  if (needsImage) prompt.incard_load = { class_type: 'LoadImage', inputs: { image: 'start.png' } };
  if (needsLatent) prompt.incard_latent = { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } };
  for (const edge of dangling) {
    const node = prompt[edge.id];
    const targetId = linkId(source[edge.id]?.inputs[edge.field]);
    const target = targetId ? source[targetId] : undefined;
    if (!node) continue;
    node.inputs[edge.field] = target && isImageCut(edge.field, target) ? ['incard_load', 0] : ['incard_latent', 0];
  }
}

function isImageCut(field: string, target: ApiNode): boolean {
  if (/latent/i.test(field)) return false;
  if (isImageDecode(target.class_type)) return true;
  return /image|pixel|photo/i.test(field);
}

function pruneToSave(graph: ApiGraph): ApiGraph {
  const keep = new Set<string>();
  const stack = ['incard_save'];
  while (stack.length) {
    const id = stack.pop();
    if (!id || keep.has(id) || !graph[id]) continue;
    keep.add(id);
    for (const value of Object.values(graph[id].inputs)) {
      const src = linkId(value);
      if (src) stack.push(src);
    }
  }
  const next: ApiGraph = {};
  for (const id of keep) next[id] = graph[id];
  return next;
}

function assertClosed(graph: ApiGraph, stepId: string): void {
  for (const [id, node] of Object.entries(graph)) {
    for (const [field, value] of Object.entries(node.inputs)) {
      const src = linkId(value);
      if (src && !graph[src]) throw new Error(`Step ${stepId} still links ${id}.${field} to missing node ${src}.`);
    }
  }
}

function shortenStill(graph: ApiGraph): void {
  for (const node of Object.values(graph)) {
    const duration = asNumber(node.inputs.duration);
    if (duration != null && duration > 2 && /MiniMax|Video|LTX|Wan|Hunyuan/.test(node.class_type)) node.inputs.duration = 2;
  }
  for (const node of Object.values(graph)) {
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

function applySeed(graph: ApiGraph, samplerId: string, seed: number): void {
  const sampler = graph[samplerId];
  if (sampler) {
    if ('seed' in sampler.inputs) sampler.inputs.seed = seed;
    if ('noise_seed' in sampler.inputs) sampler.inputs.noise_seed = seed;
  }
  for (const node of Object.values(graph)) {
    if (node.class_type === 'RandomNoise' || 'noise_seed' in node.inputs) node.inputs.noise_seed = seed;
  }
}

function consumers(graph: ApiGraph, id: string): string[] {
  const out: string[] = [];
  for (const [nid, node] of Object.entries(graph)) {
    for (const value of Object.values(node.inputs)) {
      if (linkId(value) === id) {
        out.push(nid);
        break;
      }
    }
  }
  return out;
}

function linkId(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const id = value[0];
  if (typeof id !== 'string' && typeof id !== 'number') return null;
  if (typeof value[1] !== 'number') return null;
  return String(id);
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cloneNode(node: ApiNode): ApiNode {
  return JSON.parse(JSON.stringify(node)) as ApiNode;
}
