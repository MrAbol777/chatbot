import { ReactNode, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../../components/Icon';
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
  panelClassName?: string;
  dismissible?: boolean;
  closeLabel?: string;
};

function Dialog({ open, title, onClose, children, confirmText, cancelText = 'انصراف', onConfirm, showFooter = true, panelClassName = '', dismissible = true, closeLabel = 'بستن پنجره' }: Props) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  // Dialog consumers commonly pass an inline callback. Keep the latest callback
  // without treating each parent render as a dialog close/reopen cycle.
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onCloseRef.current();
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
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [dismissible, open]);

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

  const dialog = (
    <div className="ds-dialog-overlay" role="presentation" onClick={dismissible ? onClose : undefined}>
      <div className={`ds-dialog-panel ${panelClassName}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()} ref={panelRef}>
        <div className="ds-dialog-header">
          <h2 id={titleId}>{title}</h2>
          {dismissible ? <Button
            type="button"
            variant="ghost"
            iconOnly
            startIcon={<Icon name="x-close" size={20} aria-hidden="true" />}
            className="ds-dialog-close"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
          /> : null}
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

  const mountTarget = document.getElementById('modal-root') || document.body;
  return createPortal(dialog, mountTarget);
}

export default Dialog;
