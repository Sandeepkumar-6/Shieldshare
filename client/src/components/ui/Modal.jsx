import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.jsx';
import { Notice } from './States.jsx';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

const SIZES = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg' };

// Accessible dialog: focus moves in and is trapped, Escape closes (unless busy), focus
// returns to the trigger on close, page scroll is locked while open.
export function Modal({ open, onClose, title, description, children, footer, size = 'md', dismissible = true, initialFocusRef }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const latest = useRef({ onClose, dismissible });
  latest.current = { onClose, dismissible };

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus order: an explicit target, a field marked data-autofocus, the first control in
    // the body or footer (Cancel for confirmations), then the dialog itself.
    const panel = panelRef.current;
    const target = initialFocusRef?.current
      ?? panel?.querySelector('[data-autofocus]')
      ?? panel?.querySelector(`[data-modal-body] :is(${FOCUSABLE})`)
      ?? panel?.querySelector(`[data-modal-footer] :is(${FOCUSABLE})`)
      ?? panel;
    target?.focus();

    function onKeyDown(event) {
      if (event.key === 'Escape' && latest.current.dismissible) {
        event.stopPropagation();
        latest.current.onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-overlay animate-fade-in"
        aria-hidden="true"
        onClick={() => dismissible && onClose?.()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`relative flex max-h-[90dvh] w-full flex-col rounded-t-dialog border border-line bg-surface-elevated shadow-overlay animate-pop-in sm:rounded-dialog ${SIZES[size]}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-heading font-semibold text-fg">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 text-body text-fg-secondary">{description}</p>}
          </div>
          {dismissible && (
            <Button variant="ghost" size="icon" icon="close" aria-label="Close dialog" onClick={onClose} />
          )}
        </header>
        <div data-modal-body className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer data-modal-footer className="flex flex-col-reverse gap-2 border-t border-line-subtle px-5 py-3 sm:flex-row sm:justify-end">
            {footer}
          </footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

// Confirmation for consequential actions (skill §28): states the consequence, shows a
// progress state while the request runs, and keeps the dialog open with the server's
// message if it fails. The dialog closes itself when onConfirm resolves.
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  confirmDisabled = false,
  tone = 'primary',
  onConfirm,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setBusy(false);
      setError(null);
    }
  }, [open]);

  async function handleConfirm(event) {
    event?.preventDefault();
    if (confirmDisabled || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (failure) {
      setError(failure);
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      dismissible={!busy}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            disabled={confirmDisabled}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {/* A form so Enter in a field confirms, like any other dialog form */}
      <form onSubmit={handleConfirm} className="flex flex-col gap-3" noValidate>
        {children}
        {error && <Notice tone="critical" title="That didn't work">{error.message}</Notice>}
      </form>
    </Modal>
  );
}
