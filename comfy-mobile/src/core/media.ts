/**
 * Classifies node outputs into displayable media items (image / video / audio)
 * and builds their /view URLs. Handles core ComfyUI outputs (`images` with
 * `animated`), SaveVideo/SaveAnimatedWEBP, and VideoHelperSuite (`gifs`).
 */
import { api } from './api/client';
import type { HistoryEntry, ImageRef, NodeOutput } from './api/types';

export type MediaKind = 'image' | 'video' | 'audio' | 'file';

export interface MediaItem {
  kind: MediaKind;
  url: string;
  ref: ImageRef;
  /** MIME-ish format hint when known (e.g. "video/h264-mp4"). */
  format?: string;
  frameRate?: number;
  nodeId?: string;
  promptId?: string;
  /** Animated gif/webp images render with <img>, but are "video-like". */
  animated?: boolean;
}

const VIDEO_EXT = /\.(mp4|webm|mov|mkv|m4v|avi)$/i;
const ANIMATED_IMG_EXT = /\.(gif|webp|apng)$/i;
const AUDIO_EXT = /\.(mp3|wav|flac|ogg|opus|m4a)$/i;
const IMAGE_EXT = /\.(png|jpe?g|bmp|tiff?|avif|heic)$/i;

export function kindFromFilename(name: string, format?: string): MediaKind {
  if (format?.startsWith('video/')) return 'video';
  if (format?.startsWith('audio/')) return 'audio';
  if (VIDEO_EXT.test(name)) return 'video';
  if (AUDIO_EXT.test(name)) return 'audio';
  if (IMAGE_EXT.test(name) || ANIMATED_IMG_EXT.test(name)) return 'image';
  if (format?.startsWith('image/')) return 'image';
  return 'file';
}

export function isAnimatedImage(name: string): boolean {
  return ANIMATED_IMG_EXT.test(name);
}

/** Flattens a node output into media items. */
export function mediaFromOutput(output: NodeOutput, nodeId?: string, promptId?: string): MediaItem[] {
  const items: MediaItem[] = [];
  const animatedFlags = (output as { animated?: boolean[] }).animated;

  const push = (ref: ImageRef & { format?: string; frame_rate?: number }, idx: number, forceVideo = false) => {
    if (!ref?.filename) return;
    const kind: MediaKind = forceVideo ? 'video' : kindFromFilename(ref.filename, ref.format);
    const animated = kind === 'image' && (isAnimatedImage(ref.filename) || !!animatedFlags?.[idx]);
    items.push({
      kind,
      url: api.viewUrl(ref),
      ref: { filename: ref.filename, subfolder: ref.subfolder ?? '', type: ref.type ?? 'output' },
      format: ref.format,
      frameRate: ref.frame_rate,
      nodeId,
      promptId,
      animated,
    });
  };

  (output.images ?? []).forEach((r, i) => push(r, i));
  // VideoHelperSuite VHS_VideoCombine
  (output.gifs ?? []).forEach((r, i) => push(r as ImageRef & { format?: string }, i));
  // SaveVideo uses `video`; some custom nodes use `videos`
  ((output as { video?: ImageRef[] }).video ?? []).forEach((r, i) => push(r, i, true));
  ((output as { videos?: ImageRef[] }).videos ?? []).forEach((r, i) => push(r, i, true));
  (output.audio ?? []).forEach((r, i) => push(r, i));
  return items;
}

export function mediaFromHistoryEntry(promptId: string, entry: HistoryEntry): MediaItem[] {
  const out: MediaItem[] = [];
  for (const [nodeId, output] of Object.entries(entry.outputs ?? {})) {
    out.push(...mediaFromOutput(output, nodeId, promptId));
  }
  return out;
}

const INTERNAL_FILE = /^(.*) \[(output|input|temp)\]$/;

/**
 * `/internal/files/{output|input|temp}` returns `"relative/path [type]"`,
 * newest first. A subfolder is everything before the last slash; `/view`
 * wants that split, not the relative path stuffed into `filename`.
 */
export function parseInternalFileEntry(entry: string): ImageRef | null {
  const match = INTERNAL_FILE.exec(entry.trim());
  if (!match) return null;
  const rel = match[1].replace(/\\/g, '/');
  const slash = rel.lastIndexOf('/');
  const filename = slash >= 0 ? rel.slice(slash + 1) : rel;
  const subfolder = slash >= 0 ? rel.slice(0, slash) : '';
  if (!filename || filename.startsWith('.')) return null;
  return { filename, subfolder, type: match[2] };
}

/** Saved pictures, video, and audio from a directory listing. Temp files are skipped. */
export function mediaFromInternalFiles(entries: readonly string[]): MediaItem[] {
  const items: MediaItem[] = [];
  for (const entry of entries) {
    const ref = parseInternalFileEntry(entry);
    if (!ref || ref.type === 'temp') continue;
    const kind = kindFromFilename(ref.filename);
    if (kind === 'file') continue;
    items.push({
      kind,
      url: api.viewUrl(ref),
      ref,
      animated: kind === 'image' && isAnimatedImage(ref.filename),
    });
  }
  return items;
}

function mediaKey(item: MediaItem): string {
  return `${item.ref.type}\0${item.ref.subfolder ?? ''}\0${item.ref.filename}`;
}

/**
 * Disk listing is the durable gallery (it survives a Comfy restart). History
 * entries overwrite the same file so a run can still be deleted, and files
 * that exist only in history stay visible.
 */
export function mergeGalleryMedia(historyItems: readonly MediaItem[], diskItems: readonly MediaItem[]): MediaItem[] {
  const byKey = new Map<string, MediaItem>();
  for (const item of diskItems) byKey.set(mediaKey(item), item);
  for (const item of historyItems) byKey.set(mediaKey(item), item);
  return [...byKey.values()];
}

/** Output folder plus the input library. Either listing can fail on its own. */
export async function loadDiskMedia(): Promise<MediaItem[]> {
  const [outputs, inputs] = await Promise.all([
    api.listDirectory('output'),
    api.listDirectory('input').catch(() => [] as string[]),
  ]);
  return mediaFromInternalFiles([...outputs, ...inputs]);
}

/** Sort key for history entries: newest first using the prompt number. */
export function historyOrder(a: [string, HistoryEntry], b: [string, HistoryEntry]): number {
  return (b[1].prompt?.[0] ?? 0) - (a[1].prompt?.[0] ?? 0);
}

/** Extracts a "prompt text" summary from an API prompt for feeds (first CLIPTextEncode). */
export function summarisePrompt(entry: HistoryEntry): string {
  const prompt = entry.prompt?.[2] ?? {};
  for (const node of Object.values(prompt)) {
    if (node.class_type === 'CLIPTextEncode' && typeof node.inputs?.text === 'string' && node.inputs.text) {
      return node.inputs.text;
    }
  }
  const first = Object.values(prompt)[0];
  return first ? first.class_type : '';
}
