import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { useNotification } from '../design-system/components';
import './BroadcastMessageLayer.css';

type DisplayMode = 'toast' | 'notification' | 'dismissible_modal' | 'required_modal' | 'modal_and_notification';

type BroadcastNotification = {
  id: string;
  title: string;
  message: string;
  imageUrl?: string | null;
  actionUrl?: string | null;
  actionLabel?: string | null;
  displayMode: DisplayMode;
  priority: 'low' | 'normal' | 'high';
  createdAt?: string | null;
  publishedAt?: string | null;
  expiresAt?: string | null;
  viewedAt?: string | null;
  dismissedAt?: string | null;
  acknowledgedAt?: string | null;
  clickedAt?: string | null;
  unread: boolean;
};

type Props = { userId?: string | number; enabled: boolean; placement?: 'floating' | 'header' | 'profile' | 'hidden' };

const UPDATE_SUCCESS_MESSAGE = 'به‌روزرسانی با موفقیت انجام شد. نسخه اول دانا برای شما فعال شد و قابلیت‌های جدید در نسخه‌های بعدی اضافه می‌شوند.';

const isUpdateAction = (label?: string | null) => {
  const normalized = String(label || '').trim().toLocaleLowerCase('fa-IR');
  return /به[‌\u200c ]?روز|بروز|آپدیت|update|refresh/.test(normalized);
};

const sessionKey = (prefix: string, userId: string | number, messageId: string) =>
  `danoa:broadcast:${prefix}:${String(userId)}:${messageId}`;

const readSessionFlag = (key: string) => {
  try {
    return window.sessionStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

const writeSessionFlag = (key: string) => {
  try {
    window.sessionStorage.setItem(key, '1');
  } catch {
    // Session storage is an optional convenience; server state remains authoritative.
  }
};

const postAction = async (id: string, action: 'view' | 'dismiss' | 'acknowledge' | 'click') => {
  try {
    await fetch(`/api/notifications/${encodeURIComponent(id)}/${action}`, { method: 'POST', credentials: 'include' });
  } catch {
    // Notification state is best effort; the next poll reconciles it with the server.
  }
};

export default function BroadcastMessageLayer({ userId, enabled, placement = 'floating' }: Props) {
  const { notify } = useNotification();
  const [items, setItems] = useState<BroadcastNotification[]>([]);
  const [toastItem, setToastItem] = useState<BroadcastNotification | null>(null);
  const [updateItem, setUpdateItem] = useState<BroadcastNotification | null>(null);
  const [modalItem, setModalItem] = useState<BroadcastNotification | null>(null);
  const [centerOpen, setCenterOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !userId) return;
    const successKey = `danoa:broadcast:update-success:${String(userId)}`;
    if (!readSessionFlag(successKey)) return;
    try {
      window.sessionStorage.removeItem(successKey);
    } catch {
      // Session storage is optional.
    }
    const timer = window.setTimeout(() => notify.success(UPDATE_SUCCESS_MESSAGE, { title: 'به‌روزرسانی موفق' }), 0);
    return () => window.clearTimeout(timer);
  }, [enabled, notify, userId]);

  const loadNotifications = useCallback(async () => {
    if (!enabled || !userId) return;
    setLoading(true);
    try {
      const response = await fetch('/api/notifications?limit=50', { credentials: 'include' });
      if (!response.ok) return;
      const payload = (await response.json()) as { items?: BroadcastNotification[] };
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      setItems(nextItems);
      const nextUpdate = nextItems.find((item) =>
        item.displayMode === 'notification'
        && isUpdateAction(item.actionLabel)
        && !readSessionFlag(sessionKey('update-shown', userId, item.id))
      );
      if (!updateItem && nextUpdate) {
        setUpdateItem(nextUpdate);
        writeSessionFlag(sessionKey('update-shown', userId, nextUpdate.id));
        void postAction(nextUpdate.id, 'view');
      }
      const nextModal = nextItems.find((item) => item.displayMode === 'required_modal')
        || nextItems.find((item) => item.displayMode === 'dismissible_modal' || item.displayMode === 'modal_and_notification');
      if (!modalItem && nextModal) {
        setModalItem(nextModal);
        void postAction(nextModal.id, 'view');
      }
      const nextToast = nextItems.find((item) => item.displayMode === 'toast' && item.unread);
      if (!toastItem && !modalItem && !updateItem && nextToast) {
        setToastItem(nextToast);
        void postAction(nextToast.id, 'view');
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, userId, modalItem, toastItem, updateItem]);

  useEffect(() => {
    if (!enabled || !userId) return;
    void loadNotifications();
    const timer = window.setInterval(() => void loadNotifications(), 45_000);
    return () => window.clearInterval(timer);
  }, [enabled, userId, loadNotifications]);

  useEffect(() => {
    if (!toastItem) return;
    const timer = window.setTimeout(() => setToastItem(null), 7500);
    return () => window.clearTimeout(timer);
  }, [toastItem]);

  const persistentItems = useMemo(
    () => items.filter((item) => item.displayMode === 'notification' || item.displayMode === 'modal_and_notification'),
    [items]
  );
  const unreadCount = persistentItems.filter((item) => item.unread).length;

  const dismissModal = async () => {
    if (!modalItem || modalItem.displayMode === 'required_modal') return;
    const id = modalItem.id;
    setModalItem(null);
    setItems((previous) => previous.filter((item) => item.id !== id));
    await postAction(id, 'dismiss');
  };

  const acknowledgeModal = async () => {
    if (!modalItem) return;
    const id = modalItem.id;
    setModalItem(null);
    setItems((previous) => previous.filter((item) => item.id !== id));
    await postAction(id, 'acknowledge');
  };

  const openAction = async (item: BroadcastNotification) => {
    await postAction(item.id, 'click');
    if (item.actionUrl) window.location.assign(item.actionUrl);
  };

  const dismissUpdate = () => {
    if (!updateItem || !userId) return;
    writeSessionFlag(sessionKey('update-dismissed', userId, updateItem.id));
    setUpdateItem(null);
  };

  const applyUpdate = async () => {
    if (!updateItem || !userId || updatingId) return;
    const item = updateItem;
    setUpdatingId(item.id);
    try {
      await Promise.all([postAction(item.id, 'click'), postAction(item.id, 'acknowledge')]);
      writeSessionFlag(`danoa:broadcast:update-success:${String(userId)}`);
      window.location.reload();
    } finally {
      setUpdatingId(null);
    }
  };

  if (!enabled || !userId) return null;

  return (
    <>
      {updateItem ? (
        <section className="broadcast-user-update" role="status" aria-live="polite" aria-labelledby="broadcast-user-update-title">
          <div className="broadcast-user-update__icon" aria-hidden="true"><Icon name="retry" size={21} /></div>
          <div className="broadcast-user-update__content">
            <strong id="broadcast-user-update-title">{updateItem.title || 'نسخه جدید دانا آماده است'}</strong>
            <p>{updateItem.message}</p>
            <button type="button" className="broadcast-user-update__action" onClick={() => void applyUpdate()} disabled={Boolean(updatingId)} aria-busy={Boolean(updatingId)}>
              {updatingId ? 'در حال به‌روزرسانی…' : updateItem.actionLabel || 'به‌روزرسانی'}
            </button>
          </div>
          <button type="button" className="broadcast-user-update__close" onClick={dismissUpdate} aria-label="بستن اعلان به‌روزرسانی">
            <Icon name="x-close" size={18} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      {toastItem ? (
        <div className={`broadcast-user-toast broadcast-user-toast--${toastItem.priority}`} role="status" aria-live="polite">
          <div className="broadcast-user-toast__icon" aria-hidden="true"><Icon name="bell" size={21} /></div>
          <div className="broadcast-user-toast__content"><strong>{toastItem.title || 'اعلان جدید'}</strong><p>{toastItem.message}</p>{toastItem.actionUrl ? <button type="button" onClick={() => void openAction(toastItem)}>{toastItem.actionLabel || 'مشاهده بیشتر'}</button> : null}</div>
          <button type="button" className="broadcast-user-toast__close" onClick={() => setToastItem(null)} aria-label="بستن اعلان"><Icon name="x-close" size={18} aria-hidden="true" /></button>
        </div>
      ) : null}

      {placement !== 'hidden' ? (
        <div className={`broadcast-user-center ${placement === 'header' ? 'broadcast-user-center--header' : ''}${placement === 'profile' ? ' broadcast-user-center--profile' : ''}`}>
          <button type="button" className={`broadcast-user-bell ${unreadCount ? 'has-unread' : ''}`} onClick={() => setCenterOpen((open) => !open)} aria-label={`اعلان‌ها${unreadCount ? `، ${unreadCount} اعلان خوانده‌نشده` : ''}`} aria-expanded={centerOpen}>
            <Icon name="bell" size={21} aria-hidden="true" />{unreadCount ? <span>{unreadCount > 9 ? '۹+' : unreadCount.toLocaleString('fa-IR')}</span> : null}
          </button>
          {centerOpen ? <div className="broadcast-user-center__panel" role="region" aria-label="مرکز اعلان‌ها"><div className="broadcast-user-center__header"><strong>اعلان‌ها</strong><button type="button" onClick={() => setCenterOpen(false)} aria-label="بستن اعلان‌ها"><Icon name="x-close" size={17} aria-hidden="true" /></button></div>{persistentItems.length === 0 ? <div className="broadcast-user-center__empty">اعلان جدیدی ندارید.</div> : <div className="broadcast-user-center__list">{persistentItems.map((item) => <article key={item.id} className={`broadcast-user-center__item ${item.unread ? 'is-unread' : ''}`} onClick={() => { void postAction(item.id, 'view'); if (item.actionUrl) void openAction(item); }}><span className="broadcast-user-center__item-dot" aria-hidden="true" /><div><strong>{item.title || 'اعلان جدید'}</strong><p>{item.message}</p>{item.actionUrl ? <small>{item.actionLabel || 'مشاهده بیشتر'}</small> : null}</div></article>)}</div>}{loading ? <span className="broadcast-user-center__loading">در حال به‌روزرسانی...</span> : null}</div> : null}
        </div>
      ) : null}

      {modalItem ? <div className={`broadcast-user-modal-backdrop ${modalItem.displayMode === 'required_modal' ? 'is-required' : ''}`} role="presentation"><section className="broadcast-user-modal" role="dialog" aria-modal="true" aria-labelledby="broadcast-user-modal-title"><div className="broadcast-user-modal__header"><span className={`broadcast-user-modal__priority broadcast-user-modal__priority--${modalItem.priority}`} aria-hidden="true"><Icon name="bell" size={21} /></span><div><span className="broadcast-user-modal__eyebrow">پیام جدید</span><h2 id="broadcast-user-modal-title">{modalItem.title || 'اعلان سامانه'}</h2></div>{modalItem.displayMode !== 'required_modal' ? <button type="button" onClick={() => void dismissModal()} aria-label="بستن پیام"><Icon name="x-close" size={20} aria-hidden="true" /></button> : null}</div>{modalItem.imageUrl ? <img className="broadcast-user-modal__image" src={modalItem.imageUrl} alt="" /> : null}<p className="broadcast-user-modal__message">{modalItem.message}</p><div className="broadcast-user-modal__actions">{modalItem.actionUrl ? <button type="button" className="broadcast-user-modal__primary" onClick={() => void openAction(modalItem)}>{modalItem.actionLabel || 'مشاهده بیشتر'}</button> : null}<button type="button" className="broadcast-user-modal__secondary" onClick={() => void acknowledgeModal()}>{modalItem.displayMode === 'required_modal' ? 'متوجه شدم' : 'بستن پیام'}</button></div></section></div> : null}
    </>
  );
}
