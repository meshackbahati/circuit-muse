import { forwardRef, useId, type InputHTMLAttributes } from 'react';
import './Input.css';

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helper?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, helper, error, id: providedId, className, ...rest },
  ref,
) {
  const generatedId = useId();
  const id = providedId ?? generatedId;
  const helperId = helper ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div className={['ui-field', className ?? ''].filter(Boolean).join(' ')}>
      {label ? (
        <label htmlFor={id} className="ui-field__label">
          {label}
        </label>
      ) : null}
      <input
        ref={ref}
        id={id}
        className={['ui-input', error ? 'ui-input--error' : ''].filter(Boolean).join(' ')}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={errorId ?? helperId}
        {...rest}
      />
      {helper && !error ? (
        <p id={helperId} className="ui-field__helper">
          {helper}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="ui-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
});
