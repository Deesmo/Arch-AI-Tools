import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** Bottom sheet used for pickers, inspectors and dialogs. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  full,
  headerExtra,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
  headerExtra?: ReactNode;
}) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={`sheet${full ? ' full' : ''}`} role="dialog" aria-label={title}>
        <div className="sheet-handle" />
        <div className="sheet-header">
          <h2>{title}</h2>
          {headerExtra}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-footer">{footer}</div>}
      </div>
    </>
  );
}
