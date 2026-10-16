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
  // Some custom nodes use `videos`
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
