/**
 * Copy, LoRA and workflow cards drawn only from `/studio-thumbs/`.
 * Copy cards play their preview inline. Nothing on these cards fetches another host.
 */
import { useEffect, useRef } from 'react';
import {
  cardImage,
  cardMeta,
  copyExtras,
  copyMainClip,
  isVideoPath,
  studioThumbUrl,
  type StudioThumbCopy,
  type StudioThumbLora,
  type StudioThumbWorkflow,
} from '../../core';
import { Stars } from './sections';

function Star({ on }: { on: boolean }) {
  if (!on) return null;
  return (
    <span className="ms-star" aria-label="Favorite">
      ★
    </span>
  );
}

function Meta({ text }: { text: string }) {
  if (!text) return null;
  return <div className="sub">{text}</div>;
}

/** Plays when it is on screen. Muted and looping, so no tap is required. */
function InlineClip({ src, poster, label }: { src: string; poster: string | null; label: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.muted = true;
    const play = () => {
      void el.play().catch(() => {});
    };
    const stop = () => el.pause();
    if (typeof IntersectionObserver !== 'function') {
      play();
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => (entry?.isIntersecting ? play() : stop()),
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);
  return (
    <video
      ref={ref}
      className="ms-copy-video"
      src={src}
      poster={poster ?? undefined}
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      aria-label={label}
    />
  );
}

function ExampleStrip({ urls }: { urls: string[] }) {
  if (!urls.length) return null;
  return (
    <div className="ms-copy-extras">
      {urls.map((src) =>
        isVideoPath(src) ? (
          <video key={src} src={src} muted playsInline preload="none" controls aria-label="Example" />
        ) : (
          <img key={src} src={src} alt="" loading="lazy" decoding="async" />
        ),
      )}
    </div>
  );
}

export function CopyCard({ card }: { card: StudioThumbCopy }) {
  const clip = copyMainClip(card);
  const extras = copyExtras(card);
  const posterOnly = !clip && studioThumbUrl(card.poster);
  return (
    <article className="card ms-copy-card">
      {clip ? (
        <InlineClip src={clip.src} poster={clip.poster} label={card.name} />
      ) : posterOnly ? (
        <img className="ms-copy-still" src={posterOnly} alt="" />
      ) : null}
      <ExampleStrip urls={extras} />
      <div className="ms-copy-meta">
        <div className="ms-item-title">
          {card.name}
          <Star on={card.favorite} />
        </div>
        <Meta text={cardMeta(card)} />
      </div>
    </article>
  );
}

function Still({ src, label }: { src: string | null; label: string }) {
  if (!src) {
    const initials = label.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');
    return (
      <div className="ms-thumb ms-thumb-lg" aria-label={`No preview for ${label}`}>
        <div className="ms-thumb-ph">
          <span className="ms-thumb-ph-ini">{initials || '?'}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="ms-thumb ms-thumb-lg">
      <img src={src} alt="" loading="lazy" decoding="async" />
    </div>
  );
}

export function LoraCard({ card }: { card: StudioThumbLora }) {
  return (
    <div className="list-item ms-item">
      <Still src={cardImage(card.thumb)} label={card.name} />
      <div className="title">
        <div className="ms-item-title">
          {card.name}
          <Star on={card.favorite} />
        </div>
        {card.rating !== null && (
          <div className="sub">
            <Stars rating={card.rating} />
          </div>
        )}
        {card.trigger && <div className="ms-text small">{card.trigger}</div>}
        {card.file && <div className="sub ellipsis mono">{card.file}</div>}
        <Meta text={cardMeta(card)} />
      </div>
    </div>
  );
}

export function WorkflowCard({ card }: { card: StudioThumbWorkflow }) {
  return (
    <div className="list-item ms-item">
      <Still src={cardImage(card.thumb, card.examples)} label={card.name} />
      <div className="title">
        <div className="ms-item-title">
          {card.name}
          <Star on={card.favorite} />
        </div>
        <Meta text={cardMeta(card)} />
        {card.examples.length > 0 && (
          <div className="sub">
            {card.examples.length} example{card.examples.length === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </div>
  );
}
