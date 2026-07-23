type Variant = 'error' | 'success' | 'help';

type Props = {
  text: string;
  variant?: Variant;
  showIcon?: boolean;
  className?: string;
};

function InlineMessage({ text, variant = 'help', showIcon = true, className = '' }: Props) {
  const isError = variant === 'error';

  const iconSvg = {
    error: <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>,
    success: <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 12.5 3.2 3.2L18 7.3" /></svg>,
    help: <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><path d="M9.8 9.4a2.4 2.4 0 1 1 3.4 2.2c-.9.4-1.2.9-1.2 1.7" /><path d="M12 16.7h.1" /></svg>,
  };

  return (
    <div
      className={`ds-inline-message ds-inline-message--${variant} ${className}`.trim()}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      {showIcon && (
        <span className="ds-inline-message__icon" aria-hidden="true">
          {iconSvg[variant]}
        </span>
      )}
      <span className="ds-inline-message__text">{text}</span>
    </div>
  );
}

export default InlineMessage;
