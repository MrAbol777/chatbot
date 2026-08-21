import React from 'react';
import Icon from '../Icon';
import EmptyState from '../EmptyState';
import { Button } from '../../design-system/components';
import { Conversation, UserProfile } from '../../types';
import { PUBLIC_ASSETS } from '../../config/publicAssets';

type AppProfile = UserProfile & { id?: number | string; authProvider?: 'otp' | 'viana' };
type ConversationGroupItem = { conversation: Conversation; index: number } | Conversation;

interface ChatSidebarProps {
  sidebarOpen: boolean;
  isDesktopLayout: boolean;
  onToggleSidebar: () => void;
  onCreateConversation: () => void;
  visibleConversations: ConversationGroupItem[];
  orderedConversations: ConversationGroupItem[];
  pinnedConversations: ConversationGroupItem[];
  todayConversations: ConversationGroupItem[];
  olderConversations: ConversationGroupItem[];
  hasHydratedRemoteConversations: boolean;
  profile: AppProfile | null;
  onOpenStudio: () => void;
  onOpenNoaWallet: () => void;
  onOpenSettings: () => void;
  noaBalanceText?: string;
  conversationSearchOpen: boolean;
  conversationSearchTerm: string;
  onOpenSearch: () => void;
  conversationSearchToggleRef: React.RefObject<HTMLButtonElement>;
  renderSidebarConversation: (args: { conversation: Conversation; index: number }) => React.ReactNode;
}

const renderGroup = (
  items: ConversationGroupItem[],
  renderFn: (args: { conversation: Conversation; index: number }) => React.ReactNode
) => {
  return items.map((item, i) => {
    if ('conversation' in item) {
      return renderFn(item);
    }
    return renderFn({ conversation: item, index: i });
  });
};

export const ChatSidebar: React.FC<ChatSidebarProps> = ({
  sidebarOpen,
  isDesktopLayout,
  onToggleSidebar,
  onCreateConversation,
  visibleConversations,
  orderedConversations,
  pinnedConversations,
  todayConversations,
  olderConversations,
  hasHydratedRemoteConversations,
  profile,
  onOpenStudio,
  onOpenNoaWallet,
  onOpenSettings,
  noaBalanceText,
  conversationSearchOpen,
  conversationSearchTerm,
  onOpenSearch,
  conversationSearchToggleRef,
  renderSidebarConversation
}) => {
  return (
    <aside
      id="chat-history-sidebar"
      className={`sidebar conversation-home chat-history-sidebar ${sidebarOpen ? 'open is-expanded' : 'is-collapsed'}`}
      aria-label="تاریخچه و ناوبری دانوآ"
      aria-expanded={sidebarOpen}
      ref={(node) => {
        if (node) {
          (node as any).inert = !isDesktopLayout && !sidebarOpen;
        }
      }}
    >
      <header className="conversation-home-header">
        <div className="conversation-home-brand">
          {sidebarOpen ? (
            <span className="conversation-home-brand__mark" aria-hidden="true">
              <img src={PUBLIC_ASSETS.brandMark} alt="" />
            </span>
          ) : (
            <button
              type="button"
              className="conversation-home-brand__mark"
              onClick={onToggleSidebar}
              aria-label="باز کردن سایدبار"
              title="باز کردن سایدبار"
              aria-expanded={sidebarOpen}
            >
              <img src={PUBLIC_ASSETS.brandMark} alt="" />
              <span className="conversation-home-brand__reopen-icon" aria-hidden="true">
                <Icon name="chevron-left" size={20} />
              </span>
            </button>
          )}
          <div className="conversation-home-brand__text">
            <strong>دانوآ</strong>
            <small>همراه هوشمند تو</small>
          </div>
        </div>
        {sidebarOpen ? (
          <div className="conversation-home-header-actions">
            <button
              ref={conversationSearchToggleRef}
              type="button"
              className={`conversation-home-search-toggle ${conversationSearchOpen ? 'is-active' : ''}`}
              onClick={onOpenSearch}
              aria-label="جستجوی گفتگوها"
              title="جستجوی گفتگوها"
              aria-pressed={conversationSearchOpen}
            >
              <Icon name="search" size={20} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="conversation-sidebar-toggle-btn"
              onClick={onToggleSidebar}
              aria-label="بستن سایدبار"
              title="بستن سایدبار"
              aria-expanded={sidebarOpen}
            >
              <Icon name={isDesktopLayout ? 'chevron-right' : 'x-close'} size={18} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </header>

      <div className="conversation-home-primary-actions">
        <button
          type="button"
          className="conversation-new-chat-btn"
          onClick={onCreateConversation}
          aria-label="گفتگوی جدید"
          title={!sidebarOpen ? 'گفتگوی جدید' : undefined}
        >
          <Icon name="new-chat" size={20} aria-hidden="true" />
          <span className="conversation-new-chat-btn__label">گفتگوی جدید</span>
        </button>
      </div>

      {conversationSearchTerm ? (
        <div className="conversation-history-heading">
          <h2>نتایج جستجو</h2>
          <span>{new Intl.NumberFormat('fa-IR').format(visibleConversations.length)}</span>
        </div>
      ) : null}

      <div className="conversation-list conversation-home-list">
        {!hasHydratedRemoteConversations && profile?.id ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={`skeleton-${i}`} className="conversation-row conversation-card conversation-skeleton" aria-hidden="true">
              <div className="conversation-card-icon skeleton-shimmer" />
              <div className="conversation-main">
                <div className="skeleton-line skeleton-line--title" />
                <div className="skeleton-line skeleton-line--text" />
              </div>
              <div className="conversation-card-meta">
                <div className="skeleton-line skeleton-line--short" />
              </div>
            </div>
          ))
        ) : null}

        {pinnedConversations.length > 0 ? (
          <section className="conversation-sidebar-section" aria-labelledby="pinned-conversations-title">
            <div className="conversation-sidebar-section__heading">
              <h2 id="pinned-conversations-title">سنجاق‌شده</h2>
              <Icon name="pin" size={16} aria-hidden="true" />
            </div>
            <div className="conversation-group-card">
              {renderGroup(pinnedConversations, renderSidebarConversation)}
            </div>
          </section>
        ) : null}

        {todayConversations.length > 0 ? (
          <section className="conversation-sidebar-section" aria-labelledby="today-conversations-title">
            <div className="conversation-sidebar-section__heading">
              <h2 id="today-conversations-title">امروز</h2>
            </div>
            <div className="conversation-group-card">
              {renderGroup(todayConversations, renderSidebarConversation)}
            </div>
          </section>
        ) : null}

        {olderConversations.length > 0 ? (
          <section className="conversation-sidebar-section" aria-labelledby="older-conversations-title">
            <div className="conversation-sidebar-section__heading">
              <h2 id="older-conversations-title">هفته گذشته</h2>
            </div>
            <div className="conversation-group-card">
              {renderGroup(olderConversations, renderSidebarConversation)}
            </div>
          </section>
        ) : null}

        {visibleConversations.length === 0 ? (
          <div className="conversation-search-empty" role="status">
            {orderedConversations.length === 0 ? (
              <EmptyState
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6.5 17.5 4 20V7.7C4 5.7 5.7 4 7.7 4h8.6C18.3 4 20 5.7 20 7.7v6.1c0 2-1.7 3.7-3.7 3.7H6.5Z" />
                    <path d="M8 9h8M8 12.3h5.6" />
                  </svg>
                }
                title="هنوز گفتگویی نداری"
                description="اولین گفتگو رو شروع کن!"
                action={
                  <Button type="button" onClick={onCreateConversation}>
                    شروع گفتگوی جدید
                  </Button>
                }
              />
            ) : (
              <span>گفتگویی با این عبارت پیدا نشد.</span>
            )}
          </div>
        ) : null}
      </div>

      <nav className="conversation-bottom-nav conversation-sidebar-nav" aria-label="بخش‌های دانوآ">
        <button
          type="button"
          className="conversation-nav-item"
          onClick={onOpenStudio}
          title={!sidebarOpen ? 'ابزارها' : undefined}
          aria-label="ابزارها"
        >
          <Icon name="grid" size={21} aria-hidden="true" />
          <span>
            <strong>ابزارها</strong>
            <small>ساخت تصویر و ویدیو</small>
          </span>
          <Icon name="chevron-left" size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="conversation-nav-item"
          onClick={onOpenNoaWallet}
          title={!sidebarOpen ? 'کیف پول نوآ' : undefined}
          aria-label="کیف پول نوآ"
        >
          <Icon name="credit-card" size={21} aria-hidden="true" />
          <span>
            <strong>کیف پول نوآ</strong>
            <small>{noaBalanceText || 'مدیریت اعتبار'}</small>
          </span>
          <Icon name="chevron-left" size={18} aria-hidden="true" />
        </button>

        <button
          type="button"
          className="conversation-nav-item conversation-nav-profile"
          onClick={onOpenSettings}
          title={!sidebarOpen ? (profile?.name || 'تنظیمات حساب کاربری') : undefined}
          aria-label="تنظیمات حساب کاربری"
        >
          <span className="conversation-nav-profile__avatar" aria-hidden="true">
            {String(profile?.name || 'د').trim().charAt(0)}
          </span>
          <span>
            <strong>{profile?.name || 'پروفایل من'}</strong>
            <small>تنظیمات حساب کاربری</small>
          </span>
          <Icon name="chevron-left" size={18} aria-hidden="true" />
        </button>
      </nav>
    </aside>
  );
};
