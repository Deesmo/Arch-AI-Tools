/** Global overlays: toasts and the confirm dialog. */
import { useUiStore } from './ui';

export function Toasts() {
  const toasts = useUiStore((s) => s.toasts);
  const dismiss = useUiStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function ConfirmDialog() {
  const confirm = useUiStore((s) => s.confirm);
  const resolve = useUiStore((s) => s.resolveConfirm);
  if (!confirm) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={() => resolve(false)} />
      <div className="sheet" role="alertdialog">
        <div className="sheet-handle" />
        <div className="sheet-body">
          <h3 style={{ margin: '4px 0 6px' }}>{confirm.title}</h3>
          {confirm.message && <p className="muted" style={{ margin: 0 }}>{confirm.message}</p>}
        </div>
        <div className="sheet-footer">
          <button className="btn block" onClick={() => resolve(false)}>
            Cancel
          </button>
          <button className={`btn block ${confirm.danger ? 'danger' : 'primary'}`} onClick={() => resolve(true)}>
            {confirm.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </>
  );
}
