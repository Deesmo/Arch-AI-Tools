/** Gallery of all outputs in server history, videos first, with a fullscreen viewer. */
import { useEffect, useMemo, useState } from 'react';
import { historyOrder, mediaFromHistoryEntry, useServerStore, type MediaItem } from '../core';
import { Icon } from '../shared/Icon';
import { MediaView, kindLabel } from '../shared/MediaView';
import { useUiStore } from '../shared/ui';

type Filter = 'all' | 'video' | 'image';

export function GalleryScreen() {
  const history = useServerStore((s) => s.history);
  const status = useServerStore((s) => s.status);
  const refreshHistory = useServerStore((s) => s.refreshHistory);
  const openViewer = useUiStore((s) => s.openViewer);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    if (status === 'connected') void refreshHistory();
  }, [status, refreshHistory]);

  const items = useMemo(() => {
    const all: MediaItem[] = [];
    for (const [id, entry] of Object.entries(history ?? {}).sort(historyOrder)) {
      all.push(...mediaFromHistoryEntry(id, entry).filter((m) => m.ref.type !== 'temp'));
    }
    if (filter === 'video') return all.filter((m) => m.kind === 'video' || m.animated);
    if (filter === 'image') return all.filter((m) => m.kind === 'image' && !m.animated);
    return all;
  }, [history, filter]);

  return (
    <div className="screen">
      <div className="screen-header">
        <h1>Gallery</h1>
        <div className="segmented">
          {(['all', 'video', 'image'] as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={() => void refreshHistory()} aria-label="Refresh">
          <Icon name="refresh" />
        </button>
      </div>
      <div className="screen-body">
        {status !== 'connected' && <div className="empty">Connect to a server to see outputs.</div>}
        {status === 'connected' && items.length === 0 && <div className="empty">No outputs yet. Generate something in Studio.</div>}
        <div className="media-grid">
          {items.map((m, i) => (
            <div className="media-tile" key={`${m.url}-${i}`} onClick={() => openViewer(items, i)}>
              <MediaView item={m} cover autoPlay={m.kind === 'video'} />
              <span className="kind">{kindLabel(m)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
