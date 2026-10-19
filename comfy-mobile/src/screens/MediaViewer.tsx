/**
 * Fullscreen media viewer: swipe between items, native video controls,
 * save to device / share, open the producing workflow, delete (confirmed)
 * the run from ComfyUI's history.
 */
import { useEffect, useRef, useState } from 'react';
import { parseWorkflow, saveUrlToDevice, useGraphStore, useServerStore } from '../core';
import { Icon } from '../shared/Icon';
import { MediaView, kindLabel } from '../shared/MediaView';
import { useUiStore } from '../shared/ui';
import { useDeleteOutput } from '../shared/useDeleteOutput';

export function MediaViewer() {
  const viewer = useUiStore((s) => s.viewer);
  const close = useUiStore((s) => s.closeViewer);
  const openViewer = useUiStore((s) => s.openViewer);
  const toast = useUiStore((s) => s.toast);
  const setTab = useUiStore((s) => s.setTab);
  const history = useServerStore((s) => s.history);
  const info = useServerStore((s) => s.objectInfo);
  const load = useGraphStore((s) => s.load);
  const confirmAndDelete = useDeleteOutput();
  const [index, setIndex] = useState(viewer?.index ?? 0);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    setIndex(viewer?.index ?? 0);
  }, [viewer]);

  if (!viewer) return null;
  const items = viewer.items;
  const item = items[Math.min(index, items.length - 1)];
  if (!item) return null;

  const save = async () => {
    setSaving(true);
    try {
      const r = await saveUrlToDevice(item.url, item.ref.filename);
      toast(r === 'downloaded' ? 'Downloaded' : r === 'shared' ? 'Shared' : 'Saved to Documents/ComfyMobile', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setDeleting(true);
    try {
      const gone = await confirmAndDelete(item);
      if (!gone) return;
      // The whole run went: show what is left, or close when nothing is.
      const remaining = items.filter((m) => m.promptId !== item.promptId);
      if (!remaining.length) close();
      else openViewer(remaining, Math.min(index, remaining.length - 1));
    } finally {
      setDeleting(false);
    }
  };

  const openWorkflow = () => {
    const entry = item.promptId ? history?.[item.promptId] : undefined;
    const wf = entry?.prompt?.[3]?.extra_pnginfo?.workflow;
    if (!wf) return toast('No workflow stored for this output', 'error');
    try {
      load(parseWorkflow(wf, info), { name: `Run #${entry?.prompt?.[0]}` });
      close();
      setTab('graph');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="viewer">
      <div className="viewer-top">
        <button className="icon-btn" onClick={close} aria-label="Close">
          <Icon name="close" />
        </button>
        <span className="ellipsis" style={{ flex: 1, fontSize: 13 }}>
          {item.ref.filename}
        </span>
        <span className="badge">{kindLabel(item)}</span>
        {items.length > 1 && (
          <span className="muted small">
            {index + 1}/{items.length}
          </span>
        )}
      </div>
      <div
        className="viewer-stage"
        onTouchStart={(e) => (touchStart.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const start = touchStart.current;
          const end = e.changedTouches[0]?.clientX;
          if (start == null || end == null) return;
          const dx = end - start;
          if (dx < -60 && index < items.length - 1) setIndex(index + 1);
          if (dx > 60 && index > 0) setIndex(index - 1);
          touchStart.current = null;
        }}
      >
        <MediaView item={item} controls muted={false} autoPlay loop />
      </div>
      <div className="viewer-bottom">
        <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)} aria-label="Previous">
          <Icon name="back" size={16} />
        </button>
        <button className="btn" disabled={index >= items.length - 1} onClick={() => setIndex(index + 1)} aria-label="Next">
          <Icon name="chevron" size={16} />
        </button>
        <span style={{ flex: 1 }} />
        {item.promptId && (
          <button className="btn danger" onClick={() => void remove()} disabled={deleting} aria-label="Delete">
            <Icon name="trash" size={16} />
          </button>
        )}
        <button className="btn" onClick={openWorkflow}>
          <Icon name="graph" size={16} /> Workflow
        </button>
        <button className="btn primary" onClick={save} disabled={saving}>
          <Icon name="download" size={16} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
