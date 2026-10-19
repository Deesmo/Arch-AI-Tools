import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/** Bottom sheet used for pickers, inspectors and dialogs. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  full,
  headerExtra,
  className,
  portal,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  full?: boolean;
  headerExtra?: ReactNode;
  className?: string;
  /** Draw on document.body so a scrolling screen cannot clip the sheet. */
  portal?: boolean;
}) {
  const sheet = (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className={`sheet${full ? ' full' : ''}${className ? ` ${className}` : ''}`} role="dialog" aria-label={title}>
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
  if (portal && typeof document !== 'undefined') return createPortal(sheet, document.body);
  return sheet;
}
