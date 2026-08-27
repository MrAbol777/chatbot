import React from 'react';
import Icon from '../Icon';

interface ChatHeaderProps {
  sidebarOpen: boolean;
  isDesktopLayout: boolean;
  onOpenSidebar: () => void;
  chatSidebarToggleRef?: React.RefObject<HTMLButtonElement>;
  activeConversationTitle?: string;
  hasUserMessages: boolean;
  conversationLoading?: boolean;
  starterIdeasOpen?: boolean;
  onOpenStarterIdeas: () => void;
  onOpenStudio: () => void;
  noaBalanceText?: string;
  onOpenNoaWallet: () => void;
  profileName?: string;
  onOpenSettings: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  sidebarOpen,
  isDesktopLayout,
  onOpenSidebar,
  chatSidebarToggleRef,
  activeConversationTitle = 'گفتگوی جدید',
  hasUserMessages,
  conversationLoading = false,
  starterIdeasOpen = false,
  onOpenStarterIdeas,
  onOpenStudio,
  noaBalanceText,
  onOpenNoaWallet,
  profileName = 'ع',
  onOpenSettings
}) => {
  const showContextAction = sidebarOpen && isDesktopLayout && !conversationLoading;
  const contextAction = hasUserMessages
    ? {
        label: 'رفتن به استودیو',
        description: 'باز کردن استودیوی دانوآ',
        icon: 'sparkles' as const,
        variant: 'studio',
        onClick: onOpenStudio
      }
    : {
        label: 'ایده برای شروع',
        description: 'نمایش پیشنهادهای آماده برای شروع گفتگو',
        icon: 'lightbulb' as const,
        variant: 'ideas',
        onClick: onOpenStarterIdeas
      };

  return (
    <header className="top-bar danoa-top-bar" role="banner">
      <h1 className="visually-hidden">گفتگو با دستیار هوش مصنوعی دانوآ</h1>

      {!sidebarOpen ? (
        <button
          ref={chatSidebarToggleRef}
          className="header-action-btn chat-sidebar-toggle danoa-mobile-sidebar-btn"
          onClick={onOpenSidebar}
          type="button"
          aria-label="باز کردن پنل گفتگوها"
          title="باز کردن پنل گفتگوها"
        >
          <Icon name="sidebar-open" size={21} aria-hidden="true" />
        </button>
      ) : (
        <div className="danoa-header-spacer" aria-hidden="true" />
      )}

      <div className="danoa-top-bar__title-wrap">
        {showContextAction ? (
          <button
            key={contextAction.variant}
            type="button"
            className={`danoa-header-context-action danoa-header-context-action--${contextAction.variant}${contextAction.variant === 'ideas' && starterIdeasOpen ? ' is-expanded' : ''}`}
            onClick={contextAction.onClick}
            aria-label={contextAction.description}
            aria-haspopup={contextAction.variant === 'ideas' ? 'dialog' : undefined}
            aria-expanded={contextAction.variant === 'ideas' ? starterIdeasOpen : undefined}
            title={contextAction.description}
          >
            <span className="danoa-header-context-action__icon" aria-hidden="true">
              <Icon name={contextAction.icon} size={18} />
            </span>
            <span className="danoa-header-context-action__label">{contextAction.label}</span>
            <Icon
              name="chevron-left"
              size={15}
              className="danoa-header-context-action__arrow"
              aria-hidden="true"
            />
          </button>
        ) : (
          <div className="danoa-top-bar__title">
            <span className="danoa-top-bar__title-text">{activeConversationTitle}</span>
          </div>
        )}
      </div>

      <div className="danoa-top-bar__actions">
        <div className="danoa-noa-pill" role="status" aria-label="اعتبار نوآ">
          <button
            type="button"
            className="danoa-noa-pill__add"
            onClick={onOpenNoaWallet}
            aria-label="افزایش اعتبار نوآ"
            title="افزایش اعتبار نوآ"
          >
            <Icon name="plus" size={13} aria-hidden="true" />
          </button>
          <span className="danoa-noa-pill__label" onClick={onOpenNoaWallet} style={{ cursor: 'pointer' }}>
            {noaBalanceText || '— نوآ'}
          </span>
          <span className="danoa-noa-pill__icon" aria-hidden="true" onClick={onOpenNoaWallet} style={{ cursor: 'pointer' }}>
            <Icon name="sparkles" size={15} />
          </span>
        </div>

        <button
          type="button"
          className="danoa-avatar-badge"
          onClick={onOpenSettings}
          aria-label="تنظیمات حساب کاربری"
          title="تنظیمات حساب کاربری"
        >
          <span>{String(profileName).trim().charAt(0) || 'ع'}</span>
        </button>
      </div>
    </header>
  );
};
