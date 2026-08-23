import React from 'react';
import Icon from '../Icon';

interface ChatHeaderProps {
  sidebarOpen: boolean;
  onOpenSidebar: () => void;
  chatSidebarToggleRef?: React.RefObject<HTMLButtonElement>;
  activeConversationTitle?: string;
  noaBalanceText?: string;
  onOpenNoaWallet: () => void;
  profileName?: string;
  onOpenSettings: () => void;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  sidebarOpen,
  onOpenSidebar,
  chatSidebarToggleRef,
  activeConversationTitle = 'گفتگوی جدید',
  noaBalanceText,
  onOpenNoaWallet,
  profileName = 'ع',
  onOpenSettings
}) => {
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
        <div className="danoa-top-bar__title">
          <span className="danoa-top-bar__title-text">{activeConversationTitle}</span>
        </div>
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
