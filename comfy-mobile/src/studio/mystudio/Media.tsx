/**
 * Visual side of My Studio: thumbnails on every card, a media sheet that
 * plays/opens a record's example images and videos, and the Videos grid.
 *
 * Every media path in the bundle is relative to the Video Studio root on the
 * Mac; the only host we ever load from is the user-configured content source
 * (`/media/<path>` on the same server that served `bundle.json`). No CDNs,
 * nothing external. A card with no media gets a labelled placeholder.
 */
import { useCallback, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { contentMediaUrl, useContentStore, type BundledVideo, type ContentBundle, type MediaRef, type Visual } from '../../core';
import { Icon } from '../../shared/Icon';
import { Sheet } from '../../shared/Sheet';

/** Builds `/media/` URLs on the configured content server (null when no path / no URL). */
export function useMediaUrl(): (path: string | undefined | null) => string | null {
  const sourceUrl = useContentStore((s) => s.sourceUrl);
  return useCallback((path) => contentMediaUrl(sourceUrl, path ?? undefined), [sourceUrl]);
}

export const hasMedia = (v: Visual | undefined | null): boolean => !!v && (!!v.thumb || !!v.thumbUrl || v.examples.length > 0);

/** Short label for the placeholder, e.g. "Copy card". */
export type ThumbKind = 'Copy card' | 'Recipe' | 'LoRA' | 'Workflow' | 'Preset' | 'Character' | 'Video';

function Placeholder({ kind, label, icon }: { kind: ThumbKind; label?: string; icon?: 'image' | 'video' | 'film' | 'cards' | 'graph' | 'star' }) {
  const initials = (label ?? '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return (
    <div className="ms-thumb-ph" aria-label={`No preview for this ${kind.toLowerCase()}`}>
      {initials ? <span className="ms-thumb-ph-ini">{initials}</span> : <Icon name={icon ?? 'image'} size={18} />}
      <span className="ms-thumb-ph-kind">{kind}</span>
    </div>
  );
}

/**
 * A 56×56 thumbnail. Tap opens the record's examples (when it has any);
 * otherwise the tap falls through to the card's own action.
 */
export function Thumb({ visual, kind, label, size = 56, onOpen }: { visual: Visual | undefined | null; kind: ThumbKind; label?: string; size?: number; onOpen?: () => void }) {
  const url = useMediaUrl();
  const [broken, setBroken] = useState<string | null>(null);
  // Video Studio thumb first; if it fails, the bundle's own /media/ thumb; then the placeholder.
  const candidates = [visual?.thumbUrl ?? null, url(visual?.thumb)].filter((u): u is string => !!u);
  const src = candidates.find((u) => u !== broken) ?? null;
  const examples = visual?.examples ?? [];
  const videos = examples.filter((e) => e.kind === 'video').length;
  const openable = hasMedia(visual) && !!onOpen;
  const open = (e: MouseEvent) => {
    if (!openable) return;
    e.stopPropagation();
    onOpen?.();
  };
  return (
    <div
      className={`ms-thumb${openable ? ' openable' : ''}`}
      style={{ width: size, height: size }}
      role={openable ? 'button' : undefined}
      aria-label={openable ? `Open ${examples.length || 1} preview${examples.length === 1 ? '' : 's'}` : undefined}
      onClick={open}
    >
      {src ? <img key={src} src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(src)} /> : <Placeholder kind={kind} label={label} />}
      {videos > 0 && (
        <span className="ms-thumb-play" aria-hidden>
          <Icon name="play" size={10} />
        </span>
      )}
      {examples.length > 1 && <span className="ms-thumb-count">{examples.length}</span>}
    </div>
  );
}

function MediaItem({ item, autoPlay }: { item: MediaRef; autoPlay?: boolean }) {
  const url = useMediaUrl();
  const [broken, setBroken] = useState(false);
  const src = item.url ?? url(item.path);
  const poster = item.posterUrl ?? url(item.poster);
  if (!src || broken) {
    return (
      <div className="ms-media ms-media-missing">
        <Icon name={item.kind === 'video' ? 'video' : 'image'} size={20} />
        <span className="small">{broken ? 'Could not load from the Mac' : 'Set a Source URL to load previews'}</span>
        <span className="mono small ellipsis">{item.path}</span>
      </div>
    );
  }
  return (
    <figure className="ms-media">
      {item.kind === 'video' ? (
        <video src={src} poster={poster ?? undefined} controls playsInline preload="metadata" autoPlay={autoPlay} onError={() => setBroken(true)} />
      ) : (
        <img src={src} alt={item.label ?? ''} loading="lazy" decoding="async" onError={() => setBroken(true)} />
      )}
      <figcaption className="mono small ellipsis muted">{item.label ?? item.path}</figcaption>
    </figure>
  );
}

/** All examples of a record (its thumb first when it is not already among them). */
export function ExamplesGrid({ visual, autoPlayFirstVideo }: { visual: Visual; autoPlayFirstVideo?: boolean }) {
  const items = useMemo(() => {
    const list = [...visual.examples];
    if (visual.thumbUrl && !list.some((e) => e.url === visual.thumbUrl)) list.unshift({ path: visual.thumbUrl, kind: 'image', url: visual.thumbUrl, label: 'thumbnail' });
    if (visual.thumb && !list.some((e) => e.path === visual.thumb)) list.push({ path: visual.thumb, kind: 'image' });
    return list;
  }, [visual]);
  if (!items.length) return null;
  let played = false;
  return (
    <div className="ms-media-grid">
      {items.map((m) => {
        const auto = autoPlayFirstVideo && m.kind === 'video' && !played;
        if (auto) played = true;
        return <MediaItem key={m.path} item={m} autoPlay={auto} />;
      })}
    </div>
  );
}

/** Bottom sheet: the record's images and inline-playable videos. */
export function MediaSheet({ title, visual, onClose, footer }: { title: string; visual: Visual; onClose: () => void; footer?: ReactNode }) {
  const n = visual.examples.length;
  return (
    <Sheet title={title} onClose={onClose} footer={footer}>
      <p className="muted small ms-hint">
        {n ? `${n} preview${n === 1 ? '' : 's'} · ` : ''}loaded from the Mac over the tailnet; nothing leaves it.
      </p>
      <ExamplesGrid visual={visual} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------

/** Example clips under `videos/` in the bundle that no card claimed ("Clips"). Tap a tile to play it in place. */
export function VideosSection({ bundle, q }: { bundle: ContentBundle; q: string }) {
  const url = useMediaUrl();
  const [playing, setPlaying] = useState<string | null>(null);
  const needle = q.toLowerCase();
  const items = useMemo(() => bundle.videos.filter((v) => !needle || v.name.toLowerCase().includes(needle) || v.folder.toLowerCase().includes(needle) || v.path.toLowerCase().includes(needle)), [bundle, needle]);
  const groups = useMemo(() => {
    const m = new Map<string, BundledVideo[]>();
    for (const v of items) (m.get(v.folder) ?? m.set(v.folder, []).get(v.folder)!).push(v);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [items]);
  if (!items.length) return <div className="empty">{q ? `No clips match “${q}”.` : 'No clips in this bundle.'}</div>;
  return (
    <>
      <p className="muted small ms-hint">Example clips found next to the bundle's data files that are not tied to a card. Tap to play; they stream from the Mac. The full Video Studio video gallery is under <strong>Videos</strong>.</p>
      {groups.map(([folder, vids]) => (
        <div key={folder}>
          <div className="section-title">{folder || 'videos'} <span className="muted">{vids.length}</span></div>
          <div className="ms-video-grid">
            {vids.map((v) => {
              const src = url(v.path);
              const poster = url(v.poster);
              const on = playing === v.id;
              return (
                <div key={v.id} className={`ms-video-tile${on ? ' playing' : ''}`} onClick={() => !on && setPlaying(v.id)} role="button" aria-label={`Play ${v.name}`}>
                  {on && src ? (
                    <video src={src} poster={poster ?? undefined} controls playsInline preload="metadata" autoPlay onEnded={() => setPlaying(null)} />
                  ) : poster ? (
                    <img src={poster} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <Placeholder kind="Video" icon="film" />
                  )}
                  {!on && (
                    <span className="ms-video-play" aria-hidden>
                      <Icon name="play" size={16} />
                    </span>
                  )}
                  <div className="ms-video-name ellipsis">{v.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
