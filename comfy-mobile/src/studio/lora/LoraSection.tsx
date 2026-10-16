/**
 * Studio "LoRAs" section: the per-template LoRA stack (up to 4) with a
 * strength slider each. Picking files opens `LoraPicker` in multi-select
 * mode; the stack is turned into `LoraLoaderModelOnly` nodes by
 * `withStudioLoras` when the workflow is built (see useStudio.buildWorkflow).
 */
import { useState } from 'react';
import { MAX_STUDIO_LORAS, useServerStore, type StudioLora } from '../../core';
import { Icon } from '../../shared/Icon';
import { LoraPicker } from './LoraPicker';

interface Props {
  loras: StudioLora[];
  onAdd: (file: string) => boolean;
  onRemove: (file: string) => void;
  onStrength: (file: string, strength: number) => void;
  /** Human description of what the stack applies to, e.g. "both Wan experts". */
  appliesTo?: string;
}

const shortName = (f: string) => f.split('/').pop()?.replace(/\.[^.]+$/, '') ?? f;

export function LoraSection({ loras, onAdd, onRemove, onStrength, appliesTo }: Props) {
  const total = useServerStore((s) => s.modelLists.loras?.length);
  const [open, setOpen] = useState(loras.length > 0);
  const [picking, setPicking] = useState(false);

  const toggle = (file: string) => {
    if (loras.some((l) => l.file === file)) onRemove(file);
    else onAdd(file);
  };

  return (
    <div className="field lora-section">
      <button className="row between lora-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="row" style={{ gap: 8 }}>
          <label style={{ margin: 0, cursor: 'pointer' }}>LoRAs</label>
          <span className={`badge${loras.length ? ' blue' : ''}`}>{loras.length ? `${loras.length} of ${MAX_STUDIO_LORAS}` : 'none'}</span>
        </span>
        <span className="row" style={{ gap: 6 }}>
          {total !== undefined && <span className="muted small">{total} on server</span>}
          <Icon name={open ? 'down' : 'chevron'} size={16} />
        </span>
      </button>
      <div className="field-hint">Add up to {MAX_STUDIO_LORAS} of your LoRAs on top of the model{appliesTo ? ` (${appliesTo})` : ''}. 1.0 = as trained; lower to soften.</div>

      {open && (
        <div style={{ marginTop: 8 }}>
          {loras.map((l) => (
            <div className="card lora-row" key={l.file}>
              <div className="row between" style={{ gap: 8 }}>
                <div className="title" style={{ minWidth: 0 }}>
                  <div className="ellipsis" title={l.file}>{shortName(l.file)}</div>
                  <div className="sub ellipsis mono">{l.file}</div>
                </div>
                <span className="mono small" style={{ minWidth: 40, textAlign: 'right' }}>{l.strength.toFixed(2)}</span>
                <button className="icon-btn" aria-label={`Remove ${shortName(l.file)}`} onClick={() => onRemove(l.file)}>
                  <Icon name="close" size={18} />
                </button>
              </div>
              <input
                type="range"
                className="slider"
                min={0}
                max={2}
                step={0.05}
                value={l.strength}
                aria-label={`${shortName(l.file)} strength`}
                onChange={(e) => onStrength(l.file, Number(e.target.value))}
              />
            </div>
          ))}
          <button className="btn block" onClick={() => setPicking(true)}>
            <Icon name="plus" size={16} /> {loras.length ? 'Add or change LoRAs…' : 'Choose LoRAs…'}
          </button>
        </div>
      )}

      {picking && <LoraPicker selected={loras.map((l) => l.file)} max={MAX_STUDIO_LORAS} onToggle={toggle} onClose={() => setPicking(false)} />}
    </div>
  );
}
