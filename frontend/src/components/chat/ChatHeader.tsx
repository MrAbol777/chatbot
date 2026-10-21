import React from 'react';
import Icon from '../Icon';
import { formatWalletBalanceCompactFa, formatWalletBalanceExactFa } from '../../noa/decimal';

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
  noaBalance?: string;
  onOpenNoaWallet: () => void;
  profileName?: string;
  onOpenSettings: () => void;
  onCreateConversation?: () => void;
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
  noaBalance,
  onOpenNoaWallet,
  profileName = 'ع',
  onOpenSettings,
  onCreateConversation
}) => {
  const showContextAction = sidebarOpen && isDesktopLayout && !conversationLoading;
  const exactBalance = formatWalletBalanceExactFa(noaBalance);
  const compactBalance = formatWalletBalanceCompactFa(noaBalance);
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
    <header className="top-bar danoa-top-bar chatgpt-header" role="banner">
      <h1 className="visually-hidden">گفتگو با دستیار هوش مصنوعی دانوآ</h1>

      {/* Start section: sidebar toggle and (desktop) brand label */}
      <div className="chatgpt-header__start">
        {!sidebarOpen ? (
          <button
            ref={chatSidebarToggleRef}
            className="header-action-btn chat-sidebar-toggle chatgpt-icon-btn"
            onClick={onOpenSidebar}
            type="button"
            aria-label="باز کردن پنل گفتگوها"
            title="باز کردن پنل گفتگوها"
          >
            <Icon name={isDesktopLayout ? 'sidebar-open' : 'menu-two-line'} size={isDesktopLayout ? 20 : 20} aria-hidden="true" />
          </button>
        ) : (
          <div className="danoa-header-spacer" aria-hidden="true" />
        )}

        {/* Desktop brand label (there is a single Danua model, so no selector) */}
        {isDesktopLayout ? (
          <span className="chatgpt-model-badge">دانوآ</span>
        ) : null}
      </div>

      {/* Center: Context Action or Title */}
      <div className="danoa-top-bar__title-wrap chatgpt-header__center">
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

      {/* Right section: New chat on mobile, Wallet & Profile on desktop */}
      <div className="danoa-top-bar__actions chatgpt-header__end">
        {/* Mobile New Chat Button */}
        <button
          type="button"
          className="header-action-btn chatgpt-icon-btn chatgpt-mobile-new-chat"
          onClick={onCreateConversation || onOpenStarterIdeas}
          aria-label="گفتگوی جدید"
          title="گفتگوی جدید"
        >
          <Icon name="speech-bubble" size={20} aria-hidden="true" />
        </button>

        {/* Wallet balance (the single entry point to credit and top-ups) and, on desktop, the profile */}
        <button
          type="button"
          className="danoa-noa-pill"
          onClick={onOpenNoaWallet}
          aria-label={noaBalance ? `کیف پول نوآ، موجودی ${exactBalance} نوآ` : 'باز کردن کیف پول نوآ'}
          title={noaBalance ? `موجودی ${exactBalance} نوآ — باز کردن کیف پول` : 'باز کردن کیف پول نوآ'}
        >
          <span className="danoa-noa-pill__add" aria-hidden="true">
            <Icon name="plus" size={13} aria-hidden="true" />
          </span>
          <span className="danoa-noa-pill__label" aria-live="polite">
            <bdi className="danoa-noa-pill__amount" dir="ltr">{compactBalance}</bdi>
            <span className="danoa-noa-pill__unit">نوآ</span>
          </span>
          <span className="danoa-noa-pill__icon" aria-hidden="true">
            <Icon name="sparkles" size={15} />
          </span>
        </button>

        <button
          type="button"
          className="danoa-avatar-badge chatgpt-desktop-only"
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
