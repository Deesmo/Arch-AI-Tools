/**
 * Video Studio PIN gate: the PIN field and the card shown when Video Studio
 * could not be read (PIN required, HTML instead of JSON, unreachable).
 *
 * The PIN goes to the store's `unlock()` (→ `POST /pin` on 8140) and
 * nowhere else; it is stored only on this device.
 */
import { useState, type FormEvent } from 'react';
import { useStudioMediaStore, type StudioErrorKind } from '../../core';
import { Icon } from '../../shared/Icon';

/** Password-style PIN entry. */
export function PinField({ compact }: { compact?: boolean }) {
  const unlock = useStudioMediaStore((s) => s.unlock);
  const unlocking = useStudioMediaStore((s) => s.unlocking);
  const unlockError = useStudioMediaStore((s) => s.unlockError);
  const hasPin = useStudioMediaStore((s) => !!s.pin);
  const [pin, setPin] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) return;
    const ok = await unlock(pin);
    if (ok) setPin('');
  };
  return (
    <form className="ms-pin" onSubmit={(e) => void submit(e)}>
      <input
        className="input mono"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoCapitalize="none"
        placeholder={hasPin ? 'New PIN' : 'Video Studio PIN'}
        aria-label="Video Studio PIN"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        disabled={unlocking}
      />
      <button className="btn primary" type="submit" disabled={unlocking || !pin.trim()}>
        <Icon name="lock" size={14} /> {unlocking ? 'Unlocking…' : 'Unlock'}
      </button>
      {!compact && unlockError && <div className="small error-text ms-pin-error">{unlockError}</div>}
    </form>
  );
}

/** The card shown when Video Studio's thumbnails could not be read. */
export function StudioGate({ kind, message, onRetry }: { kind: StudioErrorKind | null; message: string | null; onRetry?: () => void }) {
  const baseUrl = useStudioMediaStore((s) => s.baseUrl);
  if (kind === 'pin') {
    return (
      <div className="card ms-gate">
        <div className="row" style={{ gap: 8 }}>
          <Icon name="lock" size={18} />
          <strong>Video Studio wants your PIN</strong>
        </div>
        <p className="small muted">Unlocks the LoRA, workflow and copy-card thumbnails. The PIN stays on this phone and is only sent to Video Studio on the Mac. It is never logged or put in the bundle.</p>
        <PinField />
      </div>
    );
  }
  return (
    <div className="card ms-gate">
      <div className="row" style={{ gap: 8 }}>
        <Icon name="warning" size={18} />
        <strong>{kind === 'not-json' ? 'Video Studio did not answer with JSON' : kind === 'mixed-content' ? 'Blocked by the browser' : 'Could not read Video Studio'}</strong>
      </div>
      <p className="small">{message ?? 'Unknown error.'}</p>
      <p className="small muted mono ellipsis">{baseUrl}</p>
      {kind === 'not-json' && <p className="small muted">That URL answered with a web page instead of data. Check the Video Studio URL under Source — it should be Video Studio itself on the Mac (port 8140).</p>}
      {kind === 'network' && <p className="small muted">Video Studio must be running on the Mac and reachable over the tailnet, and it must allow this page's origin with credentials (CORS). Card thumbnails fall back to the bundle's own previews meanwhile.</p>}
      {onRetry && (
        <button className="btn" onClick={onRetry}>
          <Icon name="refresh" size={14} /> Try again
        </button>
      )}
    </div>
  );
}
