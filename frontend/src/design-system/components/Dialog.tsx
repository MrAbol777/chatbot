import { ReactNode, useEffect, useId, useRef } from 'react';
import Button from './Button';

type Props = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  showFooter?: boolean;
};

function Dialog({ open, title, onClose, children, confirmText, cancelText = 'انصراف', onConfirm, showFooter = true }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const firstFocusable = panelRef.current.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href]');
    firstFocusable?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="ds-dialog-overlay" role="presentation" onClick={onClose}>
      <div className="ds-dialog-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()} ref={panelRef}>
        <div className="ds-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <Button type="button" variant="ghost" iconOnly className="ds-dialog-close" aria-label="بستن پنجره" onClick={onClose}>×</Button>
        </div>
        {children}
        {showFooter ? (
          <div className="ds-dialog-actions">
            {onConfirm && confirmText ? <Button onClick={onConfirm}>{confirmText}</Button> : null}
            <Button variant="secondary" onClick={onClose}>{cancelText}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default Dialog;
