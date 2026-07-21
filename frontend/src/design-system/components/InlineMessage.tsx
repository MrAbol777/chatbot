type Variant = 'error' | 'success' | 'help';

type Props = {
  text: string;
  variant?: Variant;
  showIcon?: boolean;
  className?: string;
};

const ICONS: Record<Variant, string> = {
  error: '✕',
  success: '✓',
  help: 'ℹ',
};

function InlineMessage({ text, variant = 'help', showIcon = true, className = '' }: Props) {
  const isError = variant === 'error';
  
  return (
    <div
      className={`ds-inline-message ds-inline-message--${variant} ${className}`.trim()}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
    >
      {showIcon && (
        <span className="ds-inline-message__icon" aria-hidden="true">
          {ICONS[variant]}
        </span>
      )}
      <span className="ds-inline-message__text">{text}</span>
    </div>
  );
}

export default InlineMessage;
