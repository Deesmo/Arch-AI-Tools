/**
 * Gallery of saved ComfyUI outputs plus the input library.
 * `/history` is wiped on every Comfy restart, so the list is rebuilt from
 * `/internal/files/output` and `/internal/files/input`. History still supplies
 * the prompt id used by the bin control (`useDeleteOutput`).
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';
import { historyOrder, loadDiskMedia, mediaFromHistoryEntry, mergeGalleryMedia, useServerStore, type MediaItem } from '../core';
import { Icon } from '../shared/Icon';
import { MediaView, kindLabel } from '../shared/MediaView';
import { useUiStore } from '../shared/ui';
import { useDeleteOutput } from '../shared/useDeleteOutput';

type Filter = 'all' | 'video' | 'image';

export function GalleryScreen() {
  const history = useServerStore((s) => s.history);
  const status = useServerStore((s) => s.status);
  const refreshHistory = useServerStore((s) => s.refreshHistory);
  const openViewer = useUiStore((s) => s.openViewer);
  const confirmAndDelete = useDeleteOutput();
  const [filter, setFilter] = useState<Filter>('all');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [disk, setDisk] = useState<MediaItem[] | null>(null);

  const refreshAll = useCallback(async () => {
    await refreshHistory();
    try {
      setDisk(await loadDiskMedia());
    } catch {
      setDisk((prev) => prev ?? []);
    }
  }, [refreshHistory]);

  useEffect(() => {
    if (status === 'connected') void refreshAll();
  }, [status, refreshAll]);

  const items = useMemo(() => {
    const fromHistory: MediaItem[] = [];
    for (const [id, entry] of Object.entries(history ?? {}).sort(historyOrder)) {
      fromHistory.push(...mediaFromHistoryEntry(id, entry).filter((m) => m.ref.type !== 'temp'));
    }
    const all = mergeGalleryMedia(fromHistory, disk ?? []);
    if (filter === 'video') return all.filter((m) => m.kind === 'video' || m.animated);
    if (filter === 'image') return all.filter((m) => m.kind === 'image' && !m.animated);
    return all;
  }, [history, disk, filter]);

  const onDelete = async (e: MouseEvent, m: MediaItem) => {
    e.stopPropagation();
    if (deleting) return;
    setDeleting(m.url);
    try {
      await confirmAndDelete(m);
    } finally {
      setDeleting(null);
    }
  };

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
        <button className="icon-btn" onClick={() => void refreshAll()} aria-label="Refresh">
          <Icon name="refresh" />
        </button>
      </div>
      <div className="screen-body">
        {status !== 'connected' && <div className="empty">Connect to a server to see outputs.</div>}
        {status === 'connected' && disk === null && items.length === 0 && <div className="empty">Loading gallery…</div>}
        {status === 'connected' && disk !== null && items.length === 0 && <div className="empty">No outputs yet. Generate something in Studio.</div>}
        <div className="media-grid">
          {items.map((m, i) => (
            <div className="media-tile" key={`${m.url}-${i}`} onClick={() => openViewer(items, i)}>
              <MediaView item={m} cover autoPlay={m.kind === 'video'} />
              <span className="kind">{kindLabel(m)}</span>
              {m.promptId && (
                <button type="button" className="tile-delete" aria-label={`Delete ${m.ref.filename}`} title="Delete" disabled={deleting === m.url} onClick={(e) => void onDelete(e, m)}>
                  <Icon name="trash" size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
