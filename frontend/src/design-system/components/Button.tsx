import { ButtonHTMLAttributes, ReactNode } from 'react';
import Icon from '../../components/Icon';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

type Props = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  iconOnly?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  startIcon,
  endIcon,
  iconOnly = false,
  className = '',
  children,
  disabled,
  ...rest
}: Props) {
  const isIconOnly = iconOnly || (!children && (Boolean(startIcon) || Boolean(endIcon)));
  if (import.meta.env.DEV && isIconOnly) {
    const hasAriaLabel = typeof rest['aria-label'] === 'string' && rest['aria-label'].trim().length > 0;
    const hasAriaLabelledBy = typeof rest['aria-labelledby'] === 'string' && rest['aria-labelledby'].trim().length > 0;
    if (!hasAriaLabel && !hasAriaLabelledBy) {
      console.warn('Button(iconOnly): missing accessible name. Provide aria-label or aria-labelledby.');
    }
  }
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`ds-button ds-button--${variant} ds-button--${size} ${isIconOnly ? 'ds-button--icon-only' : ''} ${className}`.trim()}
    >
      {loading ? <Icon name="spinner" size="1em" className="ds-button__spinner" aria-hidden="true" /> : null}
      {startIcon ? <span aria-hidden="true">{startIcon}</span> : null}
      {isIconOnly ? null : <span>{loading ? 'در حال انجام...' : children}</span>}
      {endIcon ? <span aria-hidden="true">{endIcon}</span> : null}
    </button>
  );
}

export default Button;
