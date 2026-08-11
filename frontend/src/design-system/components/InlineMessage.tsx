type Variant = 'error' | 'success' | 'warning' | 'info' | 'help';

type Props = {
  text: string;
  variant?: Variant;
  showIcon?: boolean;
  className?: string;
};

function InlineMessage({ text, variant = 'help', showIcon = true, className = '' }: Props) {
  const isError = variant === 'error';
  const resolved = variant === 'help' ? 'info' : variant;

  const iconSvg: Record<Variant, React.ReactNode> = {
    error: <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 3.6 21 19.2H3L12 3.6Z" /><path d="M12 10v4.2" /><path d="M12 17.4h.01" /></svg>,
    success: <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m6 12.5 3.2 3.2L18 7.3" /></svg>,
    warning: <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.2 21.6 19.8H2.4L12 3.2Z" /><path d="M12 9.4v4.2" /><path d="M12 16.6h.01" /></svg>,
    info: <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 7.8h.01" /></svg>,
    help: <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><path d="M9.8 9.4a2.4 2.4 0 1 1 3.4 2.2c-.9.4-1.2.9-1.2 1.7" /><path d="M12 16.7h.1" /></svg>
  };

  return (
    <div
      className={`ds-inline-message ds-inline-message--${variant} ${className}`.trim()}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      data-variant={resolved}
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
