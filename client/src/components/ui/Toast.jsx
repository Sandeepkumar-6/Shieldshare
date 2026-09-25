import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Icon } from './Icon.jsx';

const ToastContext = createContext(null);

// Security tones follow the severity colours (skill §5) and always come with a text label
// in the title or description, never colour alone.
const TONES = {
  success: { icon: 'checkCircle', color: 'text-success', border: 'border-line' },
  error: { icon: 'alertCircle', color: 'text-critical', border: 'border-line' },
  info: { icon: 'info', color: 'text-info', border: 'border-line' },
  warning: { icon: 'alert', color: 'text-warning', border: 'border-warning/40' },
  danger: { icon: 'alert', color: 'text-danger', border: 'border-danger/40' },
  critical: { icon: 'alertCircle', color: 'text-critical', border: 'border-critical/50' },
};
const LONG_LIVED = new Set(['error', 'danger', 'critical']);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const counter = useRef(0);

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((toast) => toast.id !== id));
  }, []);

  // action: { label, to } renders a link (e.g. to the incident a security alert belongs to).
  const show = useCallback(({ tone = 'info', title, description, action }) => {
    counter.current += 1;
    const id = counter.current;
    setToasts((list) => [...list.slice(-3), { id, tone, title, description, action }]);
    setTimeout(() => dismiss(id), LONG_LIVED.has(tone) ? 9000 : 5000);
  }, [dismiss]);

  const api = useMemo(() => ({
    show,
    success: (title, description) => show({ tone: 'success', title, description }),
    error: (title, description) => show({ tone: 'error', title, description }),
    info: (title, description) => show({ tone: 'info', title, description }),
  }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:w-96"
      >
        {toasts.map((toast) => {
          const tone = TONES[toast.tone] ?? TONES.info;
          return (
            <div
              key={toast.id}
              role={LONG_LIVED.has(toast.tone) ? 'alert' : 'status'}
              className={`pointer-events-auto flex w-full items-start gap-3 rounded-card border bg-surface-elevated px-3.5 py-3 shadow-raised animate-pop-in ${tone.border}`}
            >
              <Icon name={tone.icon} className={`mt-0.5 size-4 ${tone.color}`} />
              <div className="min-w-0 flex-1">
                <p className="text-body font-medium text-fg">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-meta break-words text-fg-secondary">{toast.description}</p>
                )}
                {toast.action && (
                  <Link
                    to={toast.action.to}
                    onClick={() => dismiss(toast.id)}
                    className="mt-1.5 inline-flex items-center gap-1 text-meta font-medium text-accent hover:text-accent-hover"
                  >
                    {toast.action.label}
                    <Icon name="chevronRight" className="size-3" />
                  </Link>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-mr-1 -mt-0.5 cursor-pointer rounded-control p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
                aria-label="Dismiss notification"
              >
                <Icon name="close" className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
