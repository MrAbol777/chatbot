import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react';

type BaseProps = {
  label?: string;
  helperText?: string;
  errorText?: string;
  fullWidth?: boolean;
};

type InputProps = BaseProps & InputHTMLAttributes<HTMLInputElement>;
type TextareaProps = BaseProps & TextareaHTMLAttributes<HTMLTextAreaElement>;

export const TextField = forwardRef<HTMLInputElement, InputProps>(function TextField(
  { label, helperText, errorText, fullWidth = true, id, className = '', ...rest },
  ref
) {
  const fieldId = id || rest.name;
  return (
    <label className={`ds-field ${className}`.trim()} data-invalid={Boolean(errorText)} style={fullWidth ? { width: '100%' } : undefined}>
      {label ? <span className="ds-field__label">{label}</span> : null}
      <input id={fieldId} className="ds-field__input" {...rest} ref={ref} aria-invalid={Boolean(errorText)} />
      {errorText ? <span className="ds-field__error">{errorText}</span> : helperText ? <span className="ds-field__helper">{helperText}</span> : null}
    </label>
  );
});

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextareaProps>(function TextAreaField(
  { label, helperText, errorText, fullWidth = true, id, className = '', ...rest },
  ref
) {
  const fieldId = id || rest.name;
  return (
    <label className={`ds-field ${className}`.trim()} data-invalid={Boolean(errorText)} style={fullWidth ? { width: '100%' } : undefined}>
      {label ? <span className="ds-field__label">{label}</span> : null}
      <textarea id={fieldId} className="ds-field__textarea" {...rest} ref={ref} aria-invalid={Boolean(errorText)} />
      {errorText ? <span className="ds-field__error">{errorText}</span> : helperText ? <span className="ds-field__helper">{helperText}</span> : null}
    </label>
  );
});
