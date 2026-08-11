import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

export type NotificationVariant = 'success' | 'error' | 'warning' | 'info';

export type NotifyOptions = {
  title?: string;
  duration?: number;
};

type Id = number;

type ToastItem = {
  id: Id;
  key: string;
  message: string;
  variant: NotificationVariant;
  title?: string;
  duration: number;
  leaving: boolean;
};

type NotifyPush = (
  message: string,
  variant?: NotificationVariant,
  options?: NotifyOptions
) => Id;

export type NotifyApi = {
  success: (message: string, options?: NotifyOptions) => Id;
  error: (message: string, options?: NotifyOptions) => Id;
  warning: (message: string, options?: NotifyOptions) => Id;
  info: (message: string, options?: NotifyOptions) => Id;
  push: NotifyPush;
};

export type ConfirmVariant = 'default' | 'danger';

export type ConfirmOptions = {
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: ConfirmVariant;
};

export type PromptOptions = {
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
};

type DialogKind = 'confirm' | 'prompt';

type DialogState = {
  id: Id;
  kind: DialogKind;
  title?: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText: string;
  cancelText: string;
  variant: ConfirmVariant;
  resolve: (value: boolean | string | null) => void;
};

type NotificationContextValue = {
  notify: NotifyApi;
  dismiss: (id: Id) => void;
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  prompt: (options: PromptOptions | string) => Promise<string | null>;
  pushToast: (
    message: string,
    variant?: 'default' | 'success' | 'warning' | 'danger',
    title?: string
  ) => void;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

const DEFAULT_DURATION = 4200;
const EXIT_DURATION = 280;
const MAX_VISIBLE = 5;

const VARIANT_ICONS: Record<NotificationVariant, ReactNode> = {
  success: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 12.5 4.8 4.8L19.5 7.2" />
    </svg>
  ),
  error: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M12 3.6 21 19.2H3L12 3.6Z" />
      <path d="M12 10v4.2" />
      <path d="M12 17.4h.01" />
    </svg>
  ),
  warning: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.2 21.6 19.8H2.4L12 3.2Z" />
      <path d="M12 9.4v4.2" />
      <path d="M12 16.6h.01" />
    </svg>
  ),
  info: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </svg>
  )
};

const buildDedupeKey = (message: string, variant: NotificationVariant) => `${variant}::${message.trim()}`;

const normalizeConfirmOptions = (options: ConfirmOptions | string): ConfirmOptions =>
  typeof options === 'string' ? { message: options } : options;

const normalizePromptOptions = (options: PromptOptions | string): PromptOptions =>
  typeof options === 'string' ? { message: options } : options;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogQueueRef = useRef<DialogState[]>([]);
  const timersRef = useRef<Map<Id, { timeoutId: number; total: number; startedAt: number }>>(new Map());
  const exitTimersRef = useRef<Set<Id>>(new Set());
  const idRef = useRef(0);

  const nextId = () => {
    idRef.current += 1;
    return idRef.current || Date.now() + Math.floor(Math.random() * 1000);
  };

  const clearToastTimer = (id: Id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer.timeoutId);
      timersRef.current.delete(id);
    }
  };

  const removeToast = useCallback((id: Id) => {
    clearToastTimer(id);
    exitTimersRef.current.delete(id);
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const scheduleExit = useCallback((id: Id) => {
    if (exitTimersRef.current.has(id)) return;
    exitTimersRef.current.add(id);
    setToasts((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
    window.setTimeout(() => removeToast(id), EXIT_DURATION);
  }, [removeToast]);

  const startAutoDismiss = useCallback((id: Id, duration: number) => {
    clearToastTimer(id);
    if (duration <= 0) return;
    const timeoutId = window.setTimeout(() => scheduleExit(id), duration);
    timersRef.current.set(id, { timeoutId, total: duration, startedAt: Date.now() });
  }, [scheduleExit]);

  const dismiss = useCallback((id: Id) => {
    scheduleExit(id);
  }, [scheduleExit]);

  const push = useCallback<NotifyPush>((message, variant = 'info', options) => {
    const text = String(message ?? '').trim();
    if (!text) return -1;
    const duration = options?.duration ?? DEFAULT_DURATION;
    const key = buildDedupeKey(text, variant);

    let resolvedId = -1;
    setToasts((prev) => {
      const existingIndex = prev.findIndex((item) => !item.leaving && item.key === key);
      if (existingIndex !== -1) {
        const existing = prev[existingIndex];
        resolvedId = existing.id;
        startAutoDismiss(existing.id, duration);
        return prev;
      }

      const id = nextId();
      resolvedId = id;
      const fresh: ToastItem = {
        id,
        key,
        message: text,
        variant,
        title: options?.title,
        duration,
        leaving: false
      };

      let nextToasts = [...prev, fresh];
      const nonLeaving = nextToasts.filter((item) => !item.leaving);
      if (nonLeaving.length > MAX_VISIBLE) {
        const oldestId = nonLeaving[0].id;
        scheduleExit(oldestId);
        nextToasts = nextToasts.map((item) =>
          item.id === oldestId ? { ...item, leaving: true } : item
        );
      }
      startAutoDismiss(id, duration);
      return nextToasts;
    });

    return resolvedId;
  }, [scheduleExit, startAutoDismiss]);

  const pauseToast = useCallback((id: Id) => {
    const timer = timersRef.current.get(id);
    if (!timer) return;
    window.clearTimeout(timer.timeoutId);
    const elapsed = Date.now() - timer.startedAt;
    const remaining = Math.max(400, timer.total - elapsed);
    timersRef.current.set(id, { timeoutId: -1, total: remaining, startedAt: Date.now() });
  }, []);

  const resumeToast = useCallback((id: Id) => {
    const timer = timersRef.current.get(id);
    if (!timer) return;
    startAutoDismiss(id, timer.total);
  }, [startAutoDismiss]);

  const notify = useMemo<NotifyApi>(() => ({
    success: (message, options) => push(message, 'success', options),
    error: (message, options) => push(message, 'error', options),
    warning: (message, options) => push(message, 'warning', options),
    info: (message, options) => push(message, 'info', options),
    push
  }), [push]);

  const pushToast = useCallback<NotificationContextValue['pushToast']>(
    (message, variant = 'default', title) => {
      const mapped: NotificationVariant =
        variant === 'danger' ? 'error' : variant === 'success' ? 'success' : variant === 'warning' ? 'warning' : 'info';
      push(message, mapped, { title });
    },
    [push]
  );

  const processDialogQueue = useCallback(() => {
    if (dialogQueueRef.current.length === 0) return;
    const next = dialogQueueRef.current.shift();
    if (next) setDialog(next);
  }, []);

  const enqueueDialog = useCallback((state: DialogState) => {
    setDialog((current) => {
      if (current) {
        dialogQueueRef.current.push(state);
        return current;
      }
      return state;
    });
  }, []);

  const closeDialog = useCallback((resolveValue: boolean | string | null) => {
    setDialog((current) => {
      if (current) current.resolve(resolveValue);
      return null;
    });
    window.setTimeout(processDialogQueue, 0);
  }, [processDialogQueue]);

  const confirm = useCallback((options: ConfirmOptions | string) => {
    const opts = normalizeConfirmOptions(options);
    return new Promise<boolean>((resolve) => {
      enqueueDialog({
        id: nextId(),
        kind: 'confirm',
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText || 'تایید',
        cancelText: opts.cancelText || 'انصراف',
        variant: opts.variant === 'danger' ? 'danger' : 'default',
        resolve: (value) => resolve(Boolean(value))
      });
    });
  }, [enqueueDialog]);

  const prompt = useCallback((options: PromptOptions | string) => {
    const opts = normalizePromptOptions(options);
    return new Promise<string | null>((resolve) => {
      enqueueDialog({
        id: nextId(),
        kind: 'prompt',
        title: opts.title,
        message: opts.message,
        placeholder: opts.placeholder,
        defaultValue: opts.defaultValue,
        confirmText: opts.confirmText || 'تایید',
        cancelText: opts.cancelText || 'انصراف',
        variant: 'default',
        resolve: (value) => resolve(typeof value === 'string' ? value : null)
      });
    });
  }, [enqueueDialog]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer.timeoutId));
      timersRef.current.clear();
      dialogQueueRef.current.forEach((item) => item.resolve(false));
      dialogQueueRef.current = [];
    };
  }, []);

  const contextValue = useMemo<NotificationContextValue>(
    () => ({ notify, dismiss, confirm, prompt, pushToast }),
    [notify, dismiss, confirm, prompt, pushToast]
  );

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <ToastRegion
        toasts={toasts}
        onDismiss={dismiss}
        onPause={pauseToast}
        onResume={resumeToast}
      />
      {dialog ? (
        <ConfirmDialog
          key={dialog.id}
          dialog={dialog}
          onConfirm={() => closeDialog(true)}
          onCancel={() => closeDialog(false)}
        />
      ) : null}
    </NotificationContext.Provider>
  );
}

type ToastRegionProps = {
  toasts: ToastItem[];
  onDismiss: (id: Id) => void;
  onPause: (id: Id) => void;
  onResume: (id: Id) => void;
};

function ToastRegion({ toasts, onDismiss, onPause, onResume }: ToastRegionProps) {
  return (
    <div className="ds-toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((item) => (
        <div
          key={item.id}
          className={`ds-toast${item.leaving ? ' is-leaving' : ''}`}
          data-variant={item.variant}
          role={item.variant === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => onPause(item.id)}
          onMouseLeave={() => onResume(item.id)}
          onFocus={() => onPause(item.id)}
          onBlur={() => onResume(item.id)}
        >
          <span className="ds-toast__icon" aria-hidden="true">
            {VARIANT_ICONS[item.variant]}
          </span>
          <span className="ds-toast__body">
            {item.title ? <strong className="ds-toast__title">{item.title}</strong> : null}
            <span className="ds-toast__message">{item.message}</span>
          </span>
          <button
            type="button"
            className="ds-toast__close"
            aria-label="بستن"
            onClick={() => onDismiss(item.id)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}

type ConfirmDialogProps = {
  dialog: DialogState;
  onConfirm: () => void;
  onCancel: () => void;
};

function ConfirmDialog({ dialog, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (dialog.kind === 'prompt') {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        confirmRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialog.kind]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  const handlePromptSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onConfirm();
  };

  return (
    <div
      className="ds-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className={`ds-confirm ds-confirm--${dialog.variant}`}
        role={dialog.kind === 'prompt' ? 'dialog' : 'alertdialog'}
        aria-modal="true"
        aria-labelledby={dialog.title ? `ds-confirm-title-${dialog.id}` : undefined}
        aria-describedby={dialog.message ? `ds-confirm-desc-${dialog.id}` : undefined}
      >
        {dialog.title ? (
          <h2 id={`ds-confirm-title-${dialog.id}`} className="ds-confirm__title">{dialog.title}</h2>
        ) : null}
        {dialog.message ? (
          <p id={`ds-confirm-desc-${dialog.id}`} className="ds-confirm__message">{dialog.message}</p>
        ) : null}

        {dialog.kind === 'prompt' ? (
          <form className="ds-confirm__form" onSubmit={handlePromptSubmit}>
            <input
              ref={inputRef}
              className="ds-confirm__input"
              type="text"
              placeholder={dialog.placeholder}
              defaultValue={dialog.defaultValue}
              aria-label={dialog.message || dialog.title || 'ورود مقدار'}
            />
            <div className="ds-confirm__actions">
              <button type="button" className="ds-confirm__btn ds-confirm__btn--cancel" onClick={onCancel}>
                {dialog.cancelText}
              </button>
              <button type="submit" ref={confirmRef} className="ds-confirm__btn ds-confirm__btn--confirm">
                {dialog.confirmText}
              </button>
            </div>
          </form>
        ) : (
          <div className="ds-confirm__actions">
            <button
              type="button"
              className="ds-confirm__btn ds-confirm__btn--cancel"
              onClick={onCancel}
            >
              {dialog.cancelText}
            </button>
            <button
              type="button"
              ref={confirmRef}
              className={`ds-confirm__btn ds-confirm__btn--confirm${dialog.variant === 'danger' ? ' is-danger' : ''}`}
              onClick={onConfirm}
            >
              {dialog.confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within ToastProvider');
  }
  return context;
}

export function useToast() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return { pushToast: context.pushToast };
}
