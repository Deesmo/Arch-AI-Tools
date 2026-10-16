/**
 * First-run walkthrough: four plain-language cards (Studio, Graph, Library,
 * "your server, no cloud"). Shown once on first launch (settings.guideSeen)
 * and again from Settings → "How this works". Swipe or tap through; "Skip"
 * and the last card's "Got it" both dismiss it for good.
 */
import { useRef, useState } from 'react';
import { useSettingsStore } from '../core';
import { Icon, type IconName } from './Icon';
import { useUiStore } from './ui';

interface Card {
  icon: IconName;
  title: string;
  body: string;
  bullets: string[];
  go?: { label: string; tab: 'studio' | 'graph' | 'library' };
}

export const GUIDE_CARDS: Card[] = [
  {
    icon: 'studio',
    title: 'Studio: make something fast',
    body: 'Studio is the simple way in. You never see a node.',
    bullets: ['Pick what to make: text → video, image → video, or an image.', 'Choose a template, type what you want, pick a model and your LoRAs.', 'Tap Generate. It runs on your server and the result shows up below.'],
    go: { label: 'Open Studio', tab: 'studio' },
  },
  {
    icon: 'graph',
    title: 'Graph: the full node editor',
    body: 'Everything Studio does is a ComfyUI workflow underneath. Graph shows that workflow.',
    bullets: ['Open any Studio run in Graph to tweak a node, or build from scratch.', 'Load workflows you saved on the server, import JSON / PNG, queue, watch progress.', 'Same workflows as the ComfyUI web UI — nothing is translated or lost.'],
    go: { label: 'Open Graph', tab: 'graph' },
  },
  {
    icon: 'library',
    title: 'Library: your models, LoRAs, workflows',
    body: 'Everything already on your server, in one place.',
    bullets: ['Models: every folder — checkpoints, LoRAs, diffusion models, text encoders, VAEs, embeddings, ControlNet…', 'Workflows: what you saved in the ComfyUI web UI. Open in Graph or run as-is.', 'Assets: your input images and everything you have generated.', 'Tap any file: use it in Studio or drop it into the graph.'],
    go: { label: 'Open Library', tab: 'library' },
  },
  {
    icon: 'lock',
    title: 'Your server. No cloud.',
    body: 'This app talks straight to your ComfyUI server — Skytech by default — over your private Tailscale network. No cloud in between.',
    bullets: ['Nothing is sent anywhere else — no accounts, no analytics, no update checks.', 'Models stay on the server; the phone only sends prompts and shows results.', 'Change the server address any time in Settings.'],
  },
];

export function Guide({ onClose }: { onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const setTab = useUiStore((s) => s.setTab);
  const set = useSettingsStore((s) => s.set);
  const touchX = useRef<number | null>(null);
  const last = index === GUIDE_CARDS.length - 1;
  const card = GUIDE_CARDS[index];

  const finish = () => {
    set({ guideSeen: true });
    onClose();
  };
  const go = (dir: 1 | -1) => setIndex((i) => Math.max(0, Math.min(GUIDE_CARDS.length - 1, i + dir)));

  return (
    <div className="guide-backdrop" role="dialog" aria-label="How this works">
      <div
        className="guide"
        onTouchStart={(e) => (touchX.current = e.touches[0].clientX)}
        onTouchEnd={(e) => {
          if (touchX.current === null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
          touchX.current = null;
        }}
      >
        <div className="row between" style={{ marginBottom: 6 }}>
          <span className="muted small">How this works · {index + 1} of {GUIDE_CARDS.length}</span>
          <button className="btn ghost sm" onClick={finish}>
            Skip
          </button>
        </div>
        <div className="guide-card" key={index}>
          <div className="guide-icon">
            <Icon name={card.icon} size={30} />
          </div>
          <h2>{card.title}</h2>
          <p>{card.body}</p>
          <ul>
            {card.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {card.go && (
            <button
              className="btn sm"
              onClick={() => {
                setTab(card.go!.tab);
                finish();
              }}
            >
              {card.go.label} <Icon name="chevron" size={14} />
            </button>
          )}
        </div>
        <div className="guide-dots" aria-hidden>
          {GUIDE_CARDS.map((_, i) => (
            <button key={i} className={i === index ? 'on' : ''} onClick={() => setIndex(i)} aria-label={`Card ${i + 1}`} />
          ))}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" style={{ flex: 1 }} disabled={index === 0} onClick={() => go(-1)}>
            <Icon name="back" size={16} /> Back
          </button>
          {last ? (
            <button className="btn primary" style={{ flex: 2 }} onClick={finish}>
              <Icon name="check" size={16} /> Got it
            </button>
          ) : (
            <button className="btn primary" style={{ flex: 2 }} onClick={() => go(1)}>
              Next <Icon name="chevron" size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
