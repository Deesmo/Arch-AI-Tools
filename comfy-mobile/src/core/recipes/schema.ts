/**
 * Recipes = saved Studio presets. A recipe pins a template, a set of
 * parameter values, optional LoRAs and trigger words that are injected into
 * the prompt at generate time. This is the extension point for the Video
 * Studio "author recipes + trigger-word binding" feature.
 */
import type { TemplateValues } from '../templates/schema';

export interface RecipeLora {
  /** File name under models/loras */
  file: string;
  strength: number;
  /** Words to prepend to the positive prompt when this LoRA is active. */
  triggerWords: string[];
}

export interface Recipe {
  id: string;
  name: string;
  templateId: string;
  /** Parameter values applied on top of the template defaults. */
  values: TemplateValues;
  /** Trigger words injected into the positive prompt (deduplicated). */
  triggerWords: string[];
  loras: RecipeLora[];
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

/** Builds the final positive prompt from user text + recipe trigger words. */
export function bindTriggerWords(prompt: string, recipe: Pick<Recipe, 'triggerWords' | 'loras'> | null): string {
  if (!recipe) return prompt;
  const words = [...recipe.triggerWords, ...recipe.loras.flatMap((l) => l.triggerWords)]
    .map((w) => w.trim())
    .filter(Boolean);
  const missing = words.filter((w) => !prompt.toLowerCase().includes(w.toLowerCase()));
  if (!missing.length) return prompt;
  return `${[...new Set(missing)].join(', ')}, ${prompt}`.replace(/,\s*$/, '');
}
