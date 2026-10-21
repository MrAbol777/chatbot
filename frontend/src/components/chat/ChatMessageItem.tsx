import React, { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Icon from '../Icon';
import { ChatMessage } from '../../types';
import { ImagePreviewState } from '../../types/chat.types';
import { formatMessageTime, getDisplayContent } from '../../utils/chatMessages';
import MessageImage from './MessageImage';
import InsufficientBalanceNotice from '../InsufficientBalanceNotice';

interface ChatMessageItemProps {
  message: ChatMessage;
  index: number;
  isLastAssistant: boolean;
  isSending: boolean;
  renderBotAvatar: () => React.ReactNode;
  onRetryStreamMessage: (message: ChatMessage) => void;
  onFeedback: (message: ChatMessage, rating: 'up' | 'down' | null) => void;
  onOpenStudio: () => void;
  onOpenNoaWallet: () => void;
  onSendMessage: (text?: string) => void;
  onOpenImagePreview: (image: ImagePreviewState) => void;
  lastMessageRef?: React.Ref<HTMLDivElement>;
  botMessageRef?: React.Ref<HTMLDivElement>;
}

const CodeBlockComponent: React.FC<{
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}> = ({ inline, className, children, ...props }) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const lang = match ? match[1] : '';
  const codeString = String(children).replace(/\n$/, '');

  const handleCopy = useCallback(() => {
    // `navigator.clipboard` is undefined on plain-HTTP pages (e.g. phone testing on the LAN).
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(codeString);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [codeString]);

  if (inline) {
    return (
      <code className={`chatgpt-inline-code ${className || ''}`} {...props}>
        {children}
      </code>
    );
  }

  return (
    <div className="chatgpt-codeblock" dir="ltr">
      <div className="chatgpt-codeblock__header">
        <span className="chatgpt-codeblock__lang">{lang || 'code'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="chatgpt-codeblock__copy-btn"
          aria-label={copied ? 'کپی شد' : 'کپی کد'}
        >
          <Icon name={copied ? 'check' : 'copy'} size={13} aria-hidden="true" />
          <span>{copied ? 'کپی شد' : 'کپی کد'}</span>
        </button>
      </div>
      <pre className="chatgpt-codeblock__pre">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
};

export const ChatMessageItem: React.FC<ChatMessageItemProps> = ({
  message,
  index: _index,
  isLastAssistant,
  isSending,
  renderBotAvatar,
  onRetryStreamMessage,
  onFeedback,
  onOpenStudio,
  onOpenNoaWallet,
  onSendMessage,
  onOpenImagePreview,
  lastMessageRef,
  botMessageRef
}) => {
  const isAssistant = message.role === 'assistant';
  const displayContent = getDisplayContent(message);
  const [copied, setCopied] = useState(false);
  const feedback = message.feedback ?? null;
  const [isSpeaking, setIsSpeaking] = useState(false);

  const handleCopyContent = useCallback(() => {
    if (typeof navigator !== 'undefined' && navigator.clipboard && displayContent) {
      void navigator.clipboard.writeText(displayContent);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    }
  }, [displayContent]);

  const handleSpeak = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(displayContent);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, [isSpeaking, displayContent]);

  return (
    <div
      className={`message-row chatgpt-message-row ${message.role} ${message.streamStatus ? `stream-${message.streamStatus}` : ''} ${Array.isArray(message.images) && message.images.length > 0 ? 'has-images' : ''}`}
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
        <div className={`bubble markdown-body chatgpt-assistant-body ${message.streamStatus === 'streaming' ? 'streaming-bubble' : ''}`}>
          {displayContent ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code: CodeBlockComponent as any
              }}
            >
              {displayContent}
            </ReactMarkdown>
          ) : null}
          {message.streamStatus === 'streaming' ? <span className="stream-cursor chatgpt-cursor" aria-label="در حال نوشتن" /> : null}
          {message.streamStatus === 'failed' ? (
            <div className="stream-state stream-state-error chatgpt-error-box" role="alert">
              <span>{message.streamError || 'پاسخ کامل نشد. دوباره تلاش کنیم؟'}</span>
              <button
                type="button"
                className="stream-retry-btn"
                onClick={() => onRetryStreamMessage(message)}
                disabled={isSending}
                aria-label="تلاش مجدد برای دریافت پاسخ"
                title="تلاش مجدد"
              >
                <Icon name="retry" size={16} />
              </button>
            </div>
          ) : null}
          {message.streamStatus === 'cancelled' ? (
            <div className="stream-state stream-state-cancelled chatgpt-cancelled-box">پاسخ متوقف شد.</div>
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

          {/* ChatGPT Assistant Action Bar */}
          {!message.streamStatus || message.streamStatus === 'completed' ? (
            <div className="chatgpt-message-actions" role="toolbar" aria-label="عملیات پیام">
              <button
                type="button"
                className={`chatgpt-action-btn ${copied ? 'is-active' : ''}`}
                onClick={handleCopyContent}
                title={copied ? 'کپی شد' : 'کپی متن'}
                aria-label={copied ? 'کپی شد' : 'کپی متن'}
              >
                <Icon name={copied ? 'check' : 'copy'} size={15} />
              </button>
              <button
                type="button"
                className={`chatgpt-action-btn ${feedback === 'up' ? 'is-active' : ''}`}
                onClick={() => onFeedback(message, feedback === 'up' ? null : 'up')}
                aria-pressed={feedback === 'up'}
                title="پاسخ مفید بود"
                aria-label="پسندیدن پاسخ"
              >
                <Icon name="thumbs-up" size={15} />
              </button>
              <button
                type="button"
                className={`chatgpt-action-btn ${feedback === 'down' ? 'is-active' : ''}`}
                onClick={() => onFeedback(message, feedback === 'down' ? null : 'down')}
                aria-pressed={feedback === 'down'}
                title="پاسخ مناسب نبود"
                aria-label="نپسندیدن پاسخ"
              >
                <Icon name="thumbs-down" size={15} />
              </button>
              <button
                type="button"
                className={`chatgpt-action-btn ${isSpeaking ? 'is-speaking is-active' : ''}`}
                onClick={handleSpeak}
                title={isSpeaking ? 'توقف خواندن' : 'خواندن با صدا'}
                aria-label={isSpeaking ? 'توقف خواندن' : 'خواندن با صدا'}
              >
                <Icon name="volume" size={15} />
              </button>
              {isLastAssistant ? (
                <button
                  type="button"
                  className="chatgpt-action-btn"
                  onClick={() => onRetryStreamMessage(message)}
                  disabled={isSending}
                  title="تولید مجدد پاسخ"
                  aria-label="تولید مجدد پاسخ"
                >
                  <Icon name="retry" size={15} />
                </button>
              ) : null}
            </div>
          ) : null}

          {isLastAssistant && !isSending && message.streamStatus === 'completed' && message.followups?.length ? (
            <div className="chat-followups" role="group" aria-label="ادامه‌ی گفتگو">
              {message.followups.map((text) => (
                <button
                  key={text}
                  type="button"
                  className="chat-followup-chip"
                  onClick={() => onSendMessage(text)}
                >
                  {text}
                </button>
              ))}
            </div>
          ) : null}

          <span className="message-time">{formatMessageTime(message.timestamp)}</span>
        </div>
      ) : (
        <div className="bubble chatgpt-user-bubble">
          {message.content ? <div className="chatgpt-user-text">{message.content}</div> : null}
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
