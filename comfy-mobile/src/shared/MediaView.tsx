/**
 * Renders a MediaItem: <video> for mp4/webm, <img> for images (animated
 * gif/webp play natively), <audio> for audio. Used by nodes, gallery, feed.
 */
import type { CSSProperties } from 'react';
import type { MediaItem } from '../core';

export function MediaView({
  item,
  autoPlay = true,
  controls = false,
  muted = true,
  loop = true,
  style,
  className,
  cover,
  onClick,
}: {
  item: MediaItem;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  loop?: boolean;
  style?: CSSProperties;
  className?: string;
  cover?: boolean;
  onClick?: () => void;
}) {
  const fit: CSSProperties = cover ? { width: '100%', height: '100%', objectFit: 'cover' } : {};
  if (item.kind === 'video') {
    return (
      <video
        key={item.url}
        className={className}
        style={{ ...fit, ...style }}
        src={item.url}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        playsInline
        controls={controls}
        preload="metadata"
        onClick={onClick}
      />
    );
  }
  if (item.kind === 'audio') {
    return <audio className={className} style={style} src={item.url} controls preload="metadata" />;
  }
  if (item.kind === 'file') {
    return (
      <a className={className} style={style} href={item.url} target="_blank" rel="noreferrer">
        {item.ref.filename}
      </a>
    );
  }
  return (
    <img
      className={className}
      style={{ ...fit, ...style }}
      src={item.url}
      alt={item.ref.filename}
      loading="lazy"
      draggable={false}
      onClick={onClick}
    />
  );
}

export function kindLabel(item: MediaItem): string {
  if (item.ref.type === 'input') return 'library';
  if (item.kind === 'video') return 'video';
  if (item.animated) return 'anim';
  return item.kind;
}
