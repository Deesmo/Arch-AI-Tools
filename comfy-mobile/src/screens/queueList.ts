import type { QueueItem } from '../core/api/types';

export interface VisibleQueueRow {
  item: QueueItem;
  /** Shown before `/queue` refresh includes this prompt id. */
  placeholder: boolean;
}

/** Live queue rows, with the just-accepted prompt kept on screen if the refresh has not landed. */
export function visibleQueueItems(running: QueueItem[], pending: QueueItem[], focusId: string | null): VisibleQueueRow[] {
  const rows: VisibleQueueRow[] = [...running, ...pending].map((item) => ({ item, placeholder: false }));
  if (focusId && !rows.some((row) => row.item[1] === focusId)) {
    const placeholder: QueueItem = [0, focusId, {}, {}, []];
    return [{ item: placeholder, placeholder: true }, ...rows];
  }
  return rows;
}
