/**
 * Lays Video Studio previews (LoRA / workflow / copy cards from the 8140
 * API) over the bundle records' own visuals.
 */
import { useCallback, useMemo } from 'react';
import {
  studioCopyFor,
  studioLoraPreview,
  studioWorkflowFor,
  useStudioMediaStore,
  withStudioVisual,
  type BundledWorkflow,
  type CopyCard,
  type LoraIndexEntry,
  type Visual,
} from '../../core';

export function useStudioVisuals() {
  const cards = useStudioMediaStore((s) => s.cards);
  const baseUrl = useStudioMediaStore((s) => s.baseUrl);

  const forCopy = useCallback(
    (c: CopyCard): Visual => {
      const sc = studioCopyFor(cards, c);
      if (!sc) return c;
      return withStudioVisual(c, { thumb: sc.poster, examples: sc.video ? [{ path: sc.video, kind: 'video', poster: sc.poster }] : [] }, baseUrl);
    },
    [cards, baseUrl],
  );

  const forWorkflow = useCallback(
    (w: BundledWorkflow): Visual => {
      const sw = studioWorkflowFor(cards, w);
      return sw ? withStudioVisual(w, { thumb: sw.thumb, examples: sw.examples }, baseUrl) : w;
    },
    [cards, baseUrl],
  );

  const forLora = useCallback(
    (e: LoraIndexEntry, fallback: Visual | undefined): Visual | undefined => {
      const path = studioLoraPreview(cards, e.card?.file ?? e.key);
      if (!path) return fallback;
      const base: Visual = fallback ?? { examples: [] };
      return withStudioVisual(base, { thumb: path }, baseUrl);
    },
    [cards, baseUrl],
  );

  return useMemo(() => ({ forCopy, forWorkflow, forLora, counts: cards.counts }), [forCopy, forWorkflow, forLora, cards.counts]);
}
