import { useId } from 'react';

const CONTROL = 'w-full rounded-control border bg-bg-secondary px-3 text-body text-fg placeholder:text-fg-muted transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-60';

// Label + control + hint/error, wired for screen readers.
function useFieldIds(id) {
  const generated = useId();
  const controlId = id || generated;
  return { controlId, hintId: `${controlId}-hint`, errorId: `${controlId}-error` };
}

function FieldFrame({ label, hint, error, controlId, hintId, errorId, children, className = '' }) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={controlId} className="text-meta font-medium text-fg-secondary">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={errorId} className="text-meta text-critical">{error}</p>
      ) : hint ? (
        <p id={hintId} className="text-meta text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ ref, id, label, hint, error, className, inputClassName = '', ...props }) {
  const ids = useFieldIds(id);
  return (
    <FieldFrame label={label} hint={hint} error={error} className={className} {...ids}>
      <input
        ref={ref}
        id={ids.controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
        className={`${CONTROL} h-9 ${error ? 'border-critical/70' : 'border-line'} ${inputClassName}`}
        {...props}
      />
    </FieldFrame>
  );
}

export function Textarea({ ref, id, label, hint, error, className, rows = 3, ...props }) {
  const ids = useFieldIds(id);
  return (
    <FieldFrame label={label} hint={hint} error={error} className={className} {...ids}>
      <textarea
        ref={ref}
        id={ids.controlId}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
        className={`${CONTROL} resize-y py-2 ${error ? 'border-critical/70' : 'border-line'}`}
        {...props}
      />
    </FieldFrame>
  );
}

export function Checkbox({ id, label, hint, className = '', ...props }) {
  const generated = useId();
  const controlId = id || generated;
  return (
    <div className={`flex items-start gap-2.5 ${className}`}>
      <input
        id={controlId}
        type="checkbox"
        aria-describedby={hint ? `${controlId}-hint` : undefined}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--color-accent)]"
        {...props}
      />
      <div className="min-w-0">
        <label htmlFor={controlId} className="cursor-pointer text-body text-fg">{label}</label>
        {hint && <p id={`${controlId}-hint`} className="text-meta text-fg-muted">{hint}</p>}
      </div>
    </div>
  );
}

export function Select({ ref, id, label, hint, error, className, children, ...props }) {
  const ids = useFieldIds(id);
  return (
    <FieldFrame label={label} hint={hint} error={error} className={className} {...ids}>
      <select
        ref={ref}
        id={ids.controlId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? ids.errorId : hint ? ids.hintId : undefined}
        className={`${CONTROL} h-9 cursor-pointer ${error ? 'border-critical/70' : 'border-line'}`}
        {...props}
      >
        {children}
      </select>
    </FieldFrame>
  );
}
