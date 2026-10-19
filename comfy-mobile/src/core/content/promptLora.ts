/**
 * Prompt-to-LoRA match for in-card Generate.
 *
 * After the sentence is rewritten, one inventory LoRA may be added on that
 * step. It has to be installed (a file name) and for that step's engine.
 * A LoRA whose name or file names a different engine is never chosen.
 * The author's LoRAs already on the card are not removed.
 */

export interface PromptLora {
  name: string;
  file: string;
  trigger: string;
}

export interface PromptLoraMatch {
  name: string;
  file: string;
  /** The trigger phrase that matched his words. */
  trigger: string;
}

const FAMILIES: { family: string; tokens: string[] }[] = [
  { family: 'Sulphur', tokens: ['sulphur'] },
  { family: 'Pony', tokens: ['pony'] },
  { family: 'Illustrious', tokens: ['illustrious'] },
  { family: 'Hunyuan', tokens: ['hunyuan'] },
  { family: 'Z-Image', tokens: ['z-image', 'zimage', 'cyberrealistic'] },
  { family: 'MiniMax H3', tokens: ['minimax', 'h3eros'] },
  { family: 'Wan', tokens: ['wan'] },
  { family: 'LTX', tokens: ['ltx'] },
  { family: 'Flux', tokens: ['flux'] },
];

/** Known engine families named by this file or title. Unknown text names none. */
export function loraFamilies(text: string): string[] {
  const hay = text.toLowerCase();
  const found: string[] = [];
  for (const { family, tokens } of FAMILIES) {
    if (tokens.some((token) => hay.includes(token))) found.push(family);
  }
  return found;
}

/**
 * True when the LoRA names exactly the step's engine and no other engine.
 * A Pony file does not fit a Sulphur step. A title that names two engines fits neither.
 */
export function loraFitsEngine(stepEngine: string, lora: { file: string; name?: string }): boolean {
  const step = loraFamilies(stepEngine);
  if (step.length !== 1) return false;
  const hits = new Set([...loraFamilies(lora.file), ...loraFamilies(lora.name ?? '')]);
  return hits.size === 1 && hits.has(step[0]);
}

function triggerPhrases(trigger: string): string[] {
  const phrases: string[] = [];
  for (const part of trigger.split(/[,\n]/)) {
    const phrase = part.replace(/\s+/g, ' ').trim();
    if (phrase.length < 4) continue;
    if (phrase.includes(' ') && phrase.length < 8) continue;
    phrases.push(phrase);
  }
  return phrases;
}

function phraseHits(words: string, phrase: string): boolean {
  const hay = words.toLowerCase();
  const needle = phrase.toLowerCase();
  if (phrase.includes(' ')) return hay.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i').test(words);
}

/**
 * The server path for this catalog file. A bare filename matches one installed
 * file in a subfolder. Two installed files with the same name match neither.
 * An empty installed list matches nothing.
 */
export function installedLoraPath(file: string, installed: readonly string[]): string | null {
  const name = file.trim();
  if (!name) return null;
  const exact = installed.find((item) => item.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const base = name.split(/[/\\]/).pop()?.toLowerCase();
  if (!base) return null;
  const hits = installed.filter((item) => (item.split(/[/\\]/).pop() ?? '').toLowerCase() === base);
  return hits.length === 1 ? hits[0] : null;
}

/**
 * The installed inventory LoRA for this engine whose trigger phrase is in his
 * words. Longest phrase wins. No phrase, no file, or the wrong engine returns null.
 * When `installed` is passed, the file has to be on the server. The match uses
 * that server path, including a subfolder, so Comfy can load it.
 */
export function matchPromptLora(
  stepEngine: string,
  words: string,
  inventory: PromptLora[],
  installed?: readonly string[],
): PromptLoraMatch | null {
  let best: { lora: PromptLora; file: string; phrase: string; score: number } | null = null;
  for (const lora of inventory) {
    const file = installed ? installedLoraPath(lora.file, installed) : lora.file.trim();
    if (!file) continue;
    if (!loraFitsEngine(stepEngine, lora)) continue;
    if (installed && !loraFitsEngine(stepEngine, { file, name: lora.name })) continue;
    for (const phrase of triggerPhrases(lora.trigger)) {
      if (!phraseHits(words, phrase)) continue;
      const score = phrase.length;
      if (!best || score > best.score || (score === best.score && file < best.file)) {
        best = { lora, file, phrase, score };
      }
    }
  }
  if (!best) return null;
  return { name: best.lora.name || best.file, file: best.file, trigger: best.phrase };
}
