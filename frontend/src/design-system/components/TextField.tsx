import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId } from 'react';

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
  const generatedId = useId();
  const fieldId = id || rest.name || `field-${generatedId}`;
  const messageId = `${fieldId}-message`;
  return (
    <label className={`ds-field ${className}`.trim()} data-invalid={Boolean(errorText)} style={fullWidth ? { width: '100%' } : undefined}>
      {label ? <span className="ds-field__label">{label}</span> : null}
      <input id={fieldId} className="ds-field__input" {...rest} ref={ref} aria-invalid={Boolean(errorText)} aria-describedby={errorText || helperText ? messageId : undefined} />
      {errorText ? <span id={messageId} className="ds-field__error" role="alert">{errorText}</span> : helperText ? <span id={messageId} className="ds-field__helper">{helperText}</span> : null}
    </label>
  );
});

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextareaProps>(function TextAreaField(
  { label, helperText, errorText, fullWidth = true, id, className = '', ...rest },
  ref
) {
  const generatedId = useId();
  const fieldId = id || rest.name || `field-${generatedId}`;
  const messageId = `${fieldId}-message`;
  return (
    <label className={`ds-field ${className}`.trim()} data-invalid={Boolean(errorText)} style={fullWidth ? { width: '100%' } : undefined}>
      {label ? <span className="ds-field__label">{label}</span> : null}
      <textarea id={fieldId} className="ds-field__textarea" {...rest} ref={ref} aria-invalid={Boolean(errorText)} aria-describedby={errorText || helperText ? messageId : undefined} />
      {errorText ? <span id={messageId} className="ds-field__error" role="alert">{errorText}</span> : helperText ? <span id={messageId} className="ds-field__helper">{helperText}</span> : null}
    </label>
  );
});
