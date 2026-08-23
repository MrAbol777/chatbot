import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChatMessage } from '../../types';
import { ImagePreviewState } from '../../types/chat.types';
import { formatMessageTime } from '../../utils/chatMessages';
import MessageImage from './MessageImage';
import InsufficientBalanceNotice from '../InsufficientBalanceNotice';

interface ChatMessageItemProps {
  message: ChatMessage;
  index: number;
  isLastAssistant: boolean;
  isSending: boolean;
  renderBotAvatar: () => React.ReactNode;
  onRetryStreamMessage: (message: ChatMessage) => void;
  onOpenStudio: () => void;
  onOpenNoaWallet: () => void;
  onSendMessage: (text?: string) => void;
  onOpenImagePreview: (image: ImagePreviewState) => void;
  lastMessageRef?: React.Ref<HTMLDivElement>;
  botMessageRef?: React.Ref<HTMLDivElement>;
}

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
  message,
  isSending,
  renderBotAvatar,
  onRetryStreamMessage,
  onOpenStudio,
  onOpenNoaWallet,
  onSendMessage,
  onOpenImagePreview,
  lastMessageRef,
  botMessageRef
}) => {
  const isAssistant = message.role === 'assistant';

  return (
    <div
      className={`message-row ${message.role} ${message.streamStatus ? `stream-${message.streamStatus}` : ''} ${Array.isArray(message.images) && message.images.length > 0 ? 'has-images' : ''}`}
      data-clarity-mask="true"
      ref={(node) => {
        if (lastMessageRef && typeof lastMessageRef === 'function') {
          lastMessageRef(node);
        } else if (lastMessageRef && 'current' in lastMessageRef) {
          (lastMessageRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
        }
        if (isAssistant && botMessageRef) {
          if (typeof botMessageRef === 'function') {
            botMessageRef(node);
          } else if ('current' in botMessageRef) {
            (botMessageRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
          }
        }
      }}
    >
      {isAssistant ? renderBotAvatar() : null}
      {isAssistant ? (
        <div className={`bubble markdown-body ${message.streamStatus === 'streaming' ? 'streaming-bubble' : ''}`}>
          {message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : null}
          {message.streamStatus === 'streaming' ? <span className="stream-cursor" aria-label="در حال نوشتن" /> : null}
          {message.streamStatus === 'failed' ? (
            <div className="stream-state stream-state-error" role="alert">
              <span>{message.streamError || 'پاسخ کامل نشد. دوباره تلاش کنیم؟'}</span>
              <button
                type="button"
                className="stream-retry-btn"
                onClick={() => onRetryStreamMessage(message)}
                disabled={isSending}
                aria-label="تلاش مجدد برای دریافت پاسخ"
                title="تلاش مجدد"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M20 11a8 8 0 1 0-2.35 5.65M20 5v6h-6" />
                </svg>
              </button>
            </div>
          ) : null}
          {message.streamStatus === 'cancelled' ? (
            <div className="stream-state stream-state-cancelled">پاسخ با درخواست شما متوقف شد.</div>
          ) : null}
          {message.imageStudioRedirect ? (
            <button
              type="button"
              className="image-studio-redirect-btn"
              onClick={onOpenStudio}
            >
              رفتن به استودیوی تصویر
            </button>
          ) : null}
          {message.billingError?.kind === 'insufficient_balance' ? (
            <InsufficientBalanceNotice
              billingError={message.billingError}
              onOpenWallet={onOpenNoaWallet}
              onRetry={message.billingError.retryable && message.billingError.retryMessage
                ? () => onSendMessage(message.billingError?.retryMessage)
                : undefined}
            />
          ) : null}
          {Array.isArray(message.images) && message.images.length > 0 ? (
            <div className="message-image-grid">
              {message.images.map((image: { url: string; alt?: string }, imageIndex: number) => (
                <MessageImage
                  key={`${image.url}-${imageIndex}`}
                  src={image.url}
                  alt={image.alt || 'تصویر ارسال شده'}
                  index={imageIndex}
                  onOpenPreview={onOpenImagePreview}
                />
              ))}
            </div>
          ) : null}
          <span className="message-time">{formatMessageTime(message.timestamp)}</span>
        </div>
      ) : (
        <div className="bubble">
          {message.content ? <div>{message.content}</div> : null}
          {Array.isArray(message.images) && message.images.length > 0 ? (
            <div className="message-image-grid">
              {message.images.map((image: { url: string; alt?: string }, imageIndex: number) => (
                <MessageImage
                  key={`${image.url}-${imageIndex}`}
                  src={image.url}
                  alt={image.alt || 'تصویر ارسال شده'}
                  index={imageIndex}
                  onOpenPreview={onOpenImagePreview}
                />
              ))}
            </div>
          ) : null}
          <span className="message-time">{formatMessageTime(message.timestamp)}</span>
        </div>
      )}
    </div>
  );
};
