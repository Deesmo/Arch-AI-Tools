/**
 * Touch-friendly value editors shared by the node inspector (Graph mode) and
 * the Studio parameter form.
 */
import { useRef, useState } from 'react';
import { api } from '../core';
import { Icon } from './Icon';
import { ListPicker } from './ListPicker';
import { useUiStore } from './ui';

export function NumberField({
  value,
  min = -Infinity,
  max = Infinity,
  step = 1,
  precision = 0,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const clamp = (v: number) => {
    let n = Math.min(max, Math.max(min, v));
    if (precision === 0) n = Math.round(n);
    else n = Number(n.toFixed(precision));
    return n;
  };
  const shown = text ?? (precision > 0 ? value.toFixed(precision) : String(value));
  const bounded = Number.isFinite(min) && Number.isFinite(max) && (max - min) / step <= 4000;
  return (
    <div>
      <div className="number-field">
        <button className="stepper" onClick={() => onChange(clamp(value - step))} aria-label="Decrease">
          −
        </button>
        <input
          className="input"
          inputMode={precision > 0 ? 'decimal' : 'numeric'}
          value={shown}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text !== null) {
              const n = Number(text);
              if (Number.isFinite(n)) onChange(clamp(n));
              setText(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
        <button className="stepper" onClick={() => onChange(clamp(value + step))} aria-label="Increase">
          +
        </button>
      </div>
      {bounded && (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={Math.min(max, Math.max(min, value))}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          style={{ marginTop: 6 }}
        />
      )}
    </div>
  );
}

export function ComboField({
  value,
  options,
  onChange,
  title,
  placeholder,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  title: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const missing = !!value && options.length > 0 && !options.includes(value);
  return (
    <>
      <button className="btn block" style={{ justifyContent: 'space-between', textAlign: 'left' }} onClick={() => setOpen(true)}>
        <span className="ellipsis" style={{ color: value ? undefined : 'var(--descrip-text)' }}>
          {value || placeholder || 'Select…'}
        </span>
        <span className="row" style={{ gap: 6 }}>
          {missing && <span className="badge red">not on server</span>}
          <Icon name="down" size={16} />
        </span>
      </button>
      {open && <ListPicker title={title} options={options} value={value} onSelect={onChange} onClose={() => setOpen(false)} />}
    </>
  );
}

export function TextField({
  value,
  onChange,
  multiline,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  if (multiline) {
    return <textarea className="textarea" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function ToggleField({
  value,
  onChange,
  labelOn,
  labelOff,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  labelOn?: string;
  labelOff?: string;
}) {
  return (
    <div className="row">
      <button className={`switch${value ? ' on' : ''}`} onClick={() => onChange(!value)} aria-pressed={value} />
      <span className="muted small">{value ? (labelOn ?? 'On') : (labelOff ?? 'Off')}</span>
    </div>
  );
}

export const CONTROL_OPTIONS = ['fixed', 'increment', 'decrement', 'randomize'] as const;

export function SeedField({
  value,
  control,
  onChange,
  onChangeControl,
  max = Number.MAX_SAFE_INTEGER,
}: {
  value: number;
  control?: string;
  onChange: (v: number) => void;
  onChangeControl?: (c: string) => void;
  max?: number;
}) {
  const randomize = () => onChange(Math.floor(Math.random() * Math.min(max, 1_125_899_906_842_624)));
  return (
    <div>
      <div className="number-field">
        <input
          className="input mono"
          inputMode="numeric"
          value={String(value)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(Math.max(0, Math.floor(n)));
          }}
        />
        <button className="stepper" onClick={randomize} aria-label="Randomise seed" title="Randomise">
          <Icon name="dice" size={18} />
        </button>
      </div>
      {onChangeControl && (
        <div className="segmented" style={{ marginTop: 6, width: '100%' }}>
          {CONTROL_OPTIONS.map((c) => (
            <button key={c} className={control === c ? 'active' : ''} style={{ flex: 1 }} onClick={() => onChangeControl(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {onChangeControl && <div className="field-hint">"after generate" behaviour, same as the ComfyUI seed control.</div>}
    </div>
  );
}

/**
 * Uploads an image/video to the server's input folder via /upload/image and
 * returns the stored filename (what LoadImage / LoadVideo combos expect).
 */
export function UploadField({
  value,
  kind,
  onUploaded,
}: {
  value: string;
  kind: 'image' | 'video';
  onUploaded: (filename: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useUiStore((s) => s.toast);
  const previewUrl = value ? api.viewUrl({ filename: value, subfolder: '', type: 'input' }) : null;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await api.uploadImage(file, file.name, true);
      onUploaded(res.subfolder ? `${res.subfolder}/${res.name}` : res.name);
      toast(`Uploaded ${res.name}`, 'success');
    } catch (err) {
      toast(`Upload failed: ${(err as Error).message}`, 'error');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="upload-box">
      {previewUrl ? (
        kind === 'video' ? (
          <video src={previewUrl} muted loop autoPlay playsInline />
        ) : (
          <img src={previewUrl} alt={value} />
        )
      ) : (
        <span className="row" style={{ gap: 8 }}>
          <Icon name="upload" size={20} /> {busy ? 'Uploading…' : `Tap to upload ${kind}`}
        </span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={kind === 'video' ? 'video/*' : 'image/*'}
        onChange={(e) => onFile(e.target.files?.[0])}
        disabled={busy}
      />
    </div>
  );
}
