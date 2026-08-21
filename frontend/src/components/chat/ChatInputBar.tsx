import React from 'react';
import Icon, { type IconName } from '../Icon';
import ImageAttachmentList from './ImageAttachmentList';
import { ImageAttachment } from '../../types/chat.types';

export const ATTACHMENT_MENU_ID = 'chat-attachment-menu';
export const ATTACHMENT_MENU_ITEMS: ReadonlyArray<{
  id: 'image';
  label: string;
  description: string;
  icon: IconName;
}> = [
  {
    id: 'image',
    label: 'ارسال عکس',
    description: 'JPG، PNG یا WebP',
    icon: 'attach-image'
  }
];

export const SUGGESTION_PROMPTS: Array<{ label: string; prompt: string; icon: IconName }> = [
  { label: 'به من در تحقیق یک ایده کمک کن', prompt: 'به من در تحقیق یک ایده کمک کن', icon: 'edit' },
  { label: 'خلاصه این مقاله را بنویس', prompt: 'خلاصه این مقاله را بنویس', icon: 'file-text' },
  { label: 'ایده‌هایی برای محتوا بده', prompt: 'ایده‌هایی برای محتوا بده', icon: 'lightbulb' }
];

interface ChatInputBarProps {
  attachments: ImageAttachment[];
  onRetryUpload: (id: string) => void;
  onRemoveAttachment: (id: string) => void;
  isRecording: boolean;
  isSending: boolean;
  shouldShowSendAction: boolean;
  canSendMessage: boolean;
  inputValue: string;
  onInputChange: (value: string) => void;
  onSendMessage: () => void;
  onStopResponse: () => void;
  onStartRecording: () => void;
  onConfirmRecording: () => void;
  onCancelRecording: () => void;
  attachmentMenuOpen: boolean;
  onToggleAttachmentMenu: () => void;
  onPickImage: () => void;
  imageInputRef: React.RefObject<HTMLInputElement>;
  imageAccept: string;
  onImageSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  messageInputRef: React.RefObject<HTMLTextAreaElement>;
  attachmentBoxRef: React.RefObject<HTMLDivElement>;
  inputAreaRef: React.RefObject<HTMLElement>;
  setIsMobileKeyboardOpen: (open: boolean) => void;
  keyboardDismissedWhileFocusedRef: React.MutableRefObject<boolean>;
  visibleMessagesCount: number;
  onSelectSuggestion: (prompt: string) => void;
}

export const ChatInputBar: React.FC<ChatInputBarProps> = ({
  attachments,
  onRetryUpload,
  onRemoveAttachment,
  isRecording,
  isSending,
  shouldShowSendAction,
  canSendMessage,
  inputValue,
  onInputChange,
  onSendMessage,
  onStopResponse,
  onStartRecording,
  onConfirmRecording,
  onCancelRecording,
  attachmentMenuOpen,
  onToggleAttachmentMenu,
  onPickImage,
  imageInputRef,
  imageAccept,
  onImageSelect,
  messageInputRef,
  attachmentBoxRef,
  inputAreaRef,
  setIsMobileKeyboardOpen,
  keyboardDismissedWhileFocusedRef,
  visibleMessagesCount,
  onSelectSuggestion
}) => {
  return (
    <footer className="input-area danoa-input-area" ref={inputAreaRef}>
      <div className="input-shell danoa-input-shell">
        <ImageAttachmentList
          attachments={attachments}
          onRetryUpload={onRetryUpload}
          onRemoveAttachment={onRemoveAttachment}
        />

        <div className={`composer-row danoa-composer-capsule ${isRecording ? 'recording' : ''} ${shouldShowSendAction ? 'has-action' : 'voice-action'}`}>
          <div className="composer-actions danoa-composer-actions">
            {isRecording ? (
              <>
                <button className="confirm-btn" type="button" onClick={onConfirmRecording} aria-label="ارسال پیام ضبط شده">
                  تایید
                </button>
                <button className="cancel-btn" type="button" onClick={onCancelRecording} aria-label="لغو ضبط صدا">
                  لغو
                </button>
              </>
            ) : (
              <button
                className={`send-btn danoa-send-circle ${isSending ? 'show-stop' : shouldShowSendAction ? 'show-send' : 'show-mic'}`}
                type="button"
                onClick={isSending ? onStopResponse : shouldShowSendAction ? onSendMessage : onStartRecording}
                aria-label={isSending ? 'توقف پاسخ' : shouldShowSendAction ? 'ارسال پیام' : 'شروع ضبط صدا'}
                title={isSending ? 'توقف پاسخ' : shouldShowSendAction ? 'ارسال پیام' : 'شروع ضبط صدا'}
                disabled={!isSending && shouldShowSendAction && !canSendMessage}
              >
                <span
                  key={isSending ? 'stop' : shouldShowSendAction ? 'send' : 'mic'}
                  className={`action-icon ${isSending ? 'action-icon-stop' : shouldShowSendAction ? 'action-icon-send' : 'action-icon-mic'}`}
                  aria-hidden="true"
                >
                  {isSending ? (
                    <Icon name="stop" size={20} />
                  ) : shouldShowSendAction ? (
                    <Icon name="arrow-up" size={20} />
                  ) : (
                    <Icon name="mic" size={20} />
                  )}
                </span>
              </button>
            )}
          </div>

          <div className={`composer-card danoa-composer-inner ${isRecording ? 'recording' : ''} ${canSendMessage ? 'ready' : ''}`}>
            <div className="composer-main">
              <div className="message-field">
                <textarea
                  ref={messageInputRef}
                  dir="auto"
                  rows={1}
                  value={inputValue}
                  disabled={isRecording}
                  onChange={(event) => onInputChange(event.target.value)}
                  onFocus={() => {
                    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
                      keyboardDismissedWhileFocusedRef.current = false;
                      setIsMobileKeyboardOpen(true);
                    }
                  }}
                  onPointerDown={() => {
                    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches) {
                      keyboardDismissedWhileFocusedRef.current = false;
                      setIsMobileKeyboardOpen(true);
                    }
                  }}
                  onBlur={() => {
                    if (typeof window !== 'undefined') {
                      window.setTimeout(() => {
                        if (document.activeElement !== messageInputRef.current) {
                          setIsMobileKeyboardOpen(false);
                        }
                      }, 0);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      onSendMessage();
                    }
                  }}
                  placeholder={isRecording ? 'در حال ضبط صدا...' : 'پیام خود را بنویسید...'}
                  aria-label="نوشتن پیام"
                />
              </div>
            </div>
          </div>

          {!isRecording ? (
            <div className="attachment-rail">
              <div className="attachment-box attachment-tools" ref={attachmentBoxRef}>
                <button
                  className={`attach-btn danoa-attach-circle ${attachmentMenuOpen ? 'is-open' : ''}`}
                  type="button"
                  aria-label={attachmentMenuOpen ? 'بستن گزینه‌های پیوست' : 'باز کردن گزینه‌های پیوست'}
                  title="افزودن پیوست"
                  aria-haspopup="menu"
                  aria-expanded={attachmentMenuOpen}
                  aria-controls={ATTACHMENT_MENU_ID}
                  onClick={onToggleAttachmentMenu}
                >
                  <Icon name="plus" size={20} aria-hidden="true" />
                </button>
                {attachmentMenuOpen ? (
                  <div id={ATTACHMENT_MENU_ID} className="attachment-popup" role="menu" aria-label="گزینه‌های پیوست">
                    {ATTACHMENT_MENU_ITEMS.map((item) => (
                      <button key={item.id} type="button" role="menuitem" onClick={onPickImage}>
                        <span className="attachment-popup__icon" aria-hidden="true">
                          <Icon name={item.icon} size="1.2em" />
                        </span>
                        <span className="attachment-popup__copy">
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <input ref={imageInputRef} type="file" accept={imageAccept} multiple hidden onChange={onImageSelect} />
              </div>
            </div>
          ) : null}
        </div>

        {visibleMessagesCount === 0 ? (
          <div className="danoa-suggestions-row" role="region" aria-label="پیشنهادهای گفتگو">
            {SUGGESTION_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                className="danoa-suggestion-chip"
                onClick={() => onSelectSuggestion(item.prompt)}
              >
                <Icon name={item.icon} size={13} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ) : null}

        <p className="danoa-disclaimer">دانوآ ممکن است اشتباه کند. نتایج را بررسی کنید.</p>
      </div>
    </footer>
  );
};
