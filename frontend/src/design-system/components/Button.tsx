import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

type Props = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>;

function Button({ variant = 'primary', size = 'md', loading = false, startIcon, endIcon, className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`ds-button ds-button--${variant} ds-button--${size} ${className}`.trim()}
    >
      {startIcon ? <span aria-hidden="true">{startIcon}</span> : null}
      <span>{loading ? 'در حال انجام...' : children}</span>
      {endIcon ? <span aria-hidden="true">{endIcon}</span> : null}
    </button>
  );
}

export default Button;
