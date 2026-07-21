import { ReactNode, useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab' && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
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
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !panelRef.current) return;
    const firstFocusable = panelRef.current.querySelector<HTMLElement>('button, input, select, textarea, [href]');
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
      <div className="ds-dialog-panel" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} ref={panelRef}>
        <h3>{title}</h3>
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
