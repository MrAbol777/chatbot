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
  { label: 'یه داستان بساز', prompt: 'یه داستان کوتاه و هیجان‌انگیز برام بساز', icon: 'book' },
  { label: 'کمک در تکلیف', prompt: 'می‌خوام توی تکلیفم کمکم کنی', icon: 'edit' },
  { label: 'یه چیز جالب بگو', prompt: 'یه چیز جالب و عجیب درباره‌ی دنیا بهم بگو', icon: 'sparkles' },
  { label: 'ایده برای پروژه', prompt: 'برای پروژه‌ی مدرسه‌م چند تا ایده‌ی باحال بده', icon: 'lightbulb' }
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

        <div className={`composer-row danoa-composer-capsule chatgpt-composer-capsule ${isRecording ? 'recording' : ''} ${shouldShowSendAction ? 'has-action' : 'voice-action'}`}>
          {/* Start (Left): Plus Attachment Button */}
          {!isRecording ? (
            <div className="attachment-rail chatgpt-attachment-rail">
              <div className="attachment-box attachment-tools" ref={attachmentBoxRef}>
                <button
                  className={`attach-btn danoa-attach-circle chatgpt-plus-circle ${attachmentMenuOpen ? 'is-open' : ''}`}
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
                  <div id={ATTACHMENT_MENU_ID} className="attachment-popup chatgpt-attachment-popup" role="menu" aria-label="گزینه‌های پیوست">
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

          {/* Center: Textarea Message Field */}
          <div className={`composer-card danoa-composer-inner chatgpt-composer-inner ${isRecording ? 'recording' : ''} ${canSendMessage ? 'ready' : ''}`}>
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
                  placeholder={isRecording ? 'در حال ضبط صدا...' : 'از دانوآ بپرسید...'}
                  aria-label="نوشتن پیام"
                />
              </div>
            </div>
          </div>

          {/* End (Right): Actions (Recording / Stop / Send / Mic + Coral Voice Wave) */}
          <div className="composer-actions danoa-composer-actions chatgpt-composer-actions">
            {isRecording ? (
              <div className="chatgpt-recording-actions">
                <button className="confirm-btn chatgpt-confirm-btn" type="button" onClick={onConfirmRecording} aria-label="ارسال پیام ضبط شده">
                  تایید
                </button>
                <button className="cancel-btn chatgpt-cancel-btn" type="button" onClick={onCancelRecording} aria-label="لغو ضبط صدا">
                  لغو
                </button>
              </div>
            ) : isSending ? (
              <button
                className="send-btn danoa-send-circle chatgpt-send-circle show-stop"
                type="button"
                onClick={onStopResponse}
                aria-label="توقف پاسخ"
                title="توقف پاسخ"
              >
                <span className="action-icon action-icon-stop" aria-hidden="true">
                  <Icon name="stop" size={18} />
                </span>
              </button>
            ) : shouldShowSendAction ? (
              <button
                className="send-btn danoa-send-circle chatgpt-send-circle show-send"
                type="button"
                onClick={onSendMessage}
                aria-label="ارسال پیام"
                title="ارسال پیام"
                disabled={!canSendMessage}
              >
                <span className="action-icon action-icon-send" aria-hidden="true">
                  <Icon name="arrow-up" size={18} />
                </span>
              </button>
            ) : (
              <div className="chatgpt-idle-actions">
                <button
                  type="button"
                  className="chatgpt-action-mic-btn"
                  onClick={onStartRecording}
                  aria-label="ورودی صوتی"
                  title="شروع ضبط صدا"
                >
                  <Icon name="mic" size={20} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="chatgpt-coral-voice-btn"
                  onClick={onStartRecording}
                  aria-label="مکالمه صوتی دانوآ"
                  title="شروع مکالمه صوتی"
                >
                  <Icon name="voice-wave" size={20} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>

        {visibleMessagesCount === 0 ? (
          <div id="chat-starter-ideas" className="danoa-suggestions-row" role="region" aria-label="پیشنهادهای گفتگو">
            {SUGGESTION_PROMPTS.map((item) => (
              <button
                key={item.label}
                type="button"
                className="danoa-suggestion-chip"
                onClick={() => onSelectSuggestion(item.prompt)}
              >
                <Icon name={item.icon} size={13} aria-hidden="true" />
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
