/**
 * LoRA matching + trigger-word lookup.
 *
 * Brad's cards name files loosely ("SVI_v2_PRO_Wan2.2_I2V_high.safetensors",
 * sometimes without extension or with a sub-folder); the server lists
 * `models/loras` relative paths. Both are reduced to a *key* — lower-case
 * basename without extension — and matched on that.
 */
import type { ContentBundle, LoraCard, StudioRecipe } from './schema';

export function loraKey(file: string): string {
  const base = file.replace(/\\/g, '/').split('/').pop() ?? file;
  return base.replace(/\.(safetensors|pt|pth|ckpt|gguf|bin|lora)$/i, '').trim().toLowerCase();
}

export interface LoraIndexEntry {
  key: string;
  card?: LoraCard;
  /** Recipes that reference this file (author "parts"). */
  recipes: StudioRecipe[];
  /** Union of card + recipe trigger words. */
  triggerWords: string[];
  rating: number | null;
}

export interface LoraIndex {
  byKey: Record<string, LoraIndexEntry>;
  /** Cards/recipes that could not be keyed (no file) — shown in LoRA Lab anyway. */
  size: number;
}

export function emptyLoraIndex(): LoraIndex {
  return { byKey: {}, size: 0 };
}

function uniq(words: string[]): string[] {
  const seen = new Set<string>();
  return words.filter((w) => {
    const k = w.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function buildLoraIndex(bundle: ContentBundle | null): LoraIndex {
  const byKey: Record<string, LoraIndexEntry> = {};
  if (!bundle) return emptyLoraIndex();
  const entry = (file: string): LoraIndexEntry => {
    const key = loraKey(file);
    return (byKey[key] ??= { key, recipes: [], triggerWords: [], rating: null });
  };
  for (const card of bundle.loras) {
    const e = entry(card.file);
    e.card = e.card ?? card;
    e.triggerWords = uniq([...e.triggerWords, ...card.triggerWords]);
    if (card.rating !== null && (e.rating === null || card.rating > e.rating)) e.rating = card.rating;
  }
  for (const recipe of bundle.recipes) {
    for (const l of recipe.loras) {
      const e = entry(l.file);
      e.recipes.push(recipe);
      e.triggerWords = uniq([...e.triggerWords, ...l.triggerWords, ...recipe.triggerWords]);
    }
  }
  return { byKey, size: Object.keys(byKey).length };
}

export function lookupLora(index: LoraIndex, file: string | null | undefined): LoraIndexEntry | undefined {
  if (!file) return undefined;
  return index.byKey[loraKey(file)];
}

/** Trigger words Brad's content says belong with this LoRA file (empty if unknown). */
export function triggerWordsForLora(index: LoraIndex, file: string | null | undefined): string[] {
  return lookupLora(index, file)?.triggerWords ?? [];
}

/**
 * Maps every bundle key to the server's actual relative path (first match),
 * so cards can be turned into values the LoRA picker understands.
 */
export function matchServerLoras(index: LoraIndex, serverFiles: string[] | undefined): { keyToServerFile: Record<string, string>; matched: number; unmatched: number } {
  const keyToServerFile: Record<string, string> = {};
  if (!serverFiles) return { keyToServerFile, matched: 0, unmatched: index.size };
  const serverByKey = new Map<string, string>();
  for (const f of serverFiles) {
    const k = loraKey(f);
    if (!serverByKey.has(k)) serverByKey.set(k, f);
  }
  let matched = 0;
  for (const k of Object.keys(index.byKey)) {
    const s = serverByKey.get(k);
    if (s) {
      keyToServerFile[k] = s;
      matched++;
    }
  }
  return { keyToServerFile, matched, unmatched: index.size - matched };
}

/** Human name for a card/file: "wan2.2_i2v_lightx2v_4steps" → "wan2.2 i2v lightx2v 4steps". */
export function prettyLoraName(fileOrName: string): string {
  return loraKey(fileOrName).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || fileOrName;
}
