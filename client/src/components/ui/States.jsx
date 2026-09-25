import { Button } from './Button.jsx';
import { Icon } from './Icon.jsx';

// Empty state: says what is (not) here and what happens next (skill §32).
// `titleAs="h1"` when the empty state is the whole page (e.g. 404), so the page has a heading.
export function EmptyState({ icon, title, description, action, compact = false, titleAs: Title = 'p' }) {
  return (
    <div className={`flex flex-col items-center text-center ${compact ? 'px-4 py-8' : 'px-6 py-14'}`}>
      {icon && (
        <div className="mb-3 flex size-10 items-center justify-center rounded-card border border-line-subtle bg-bg-secondary text-fg-muted">
          <Icon name={icon} className="size-5" />
        </div>
      )}
      <Title className="text-heading font-medium text-fg">{title}</Title>
      {description && <p className="mt-1 max-w-md text-body text-fg-secondary">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Error state: what failed, the server's safe message, and a retry (skill §33).
export function ErrorState({ title = 'Something went wrong', error, onRetry, compact = false }) {
  return (
    <div role="alert" className={`flex flex-col items-center text-center ${compact ? 'px-4 py-8' : 'px-6 py-14'}`}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-card border border-critical/25 bg-critical/10 text-critical">
        <Icon name="alertCircle" className="size-5" />
      </div>
      <p className="text-heading font-medium text-fg">{title}</p>
      <p className="mt-1 max-w-md text-body text-fg-secondary">
        {error?.message || 'The request could not be completed.'}
      </p>
      {onRetry && (
        <Button className="mt-4" icon="refresh" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// Inline notice inside forms and panels.
const NOTICE_TONES = {
  info: 'border-info/25 bg-info/10 text-info',
  success: 'border-success/25 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  critical: 'border-critical/30 bg-critical/10 text-critical',
};
const NOTICE_ICONS = { info: 'info', success: 'checkCircle', warning: 'alert', critical: 'alertCircle' };

export function Notice({ tone = 'info', title, children, className = '' }) {
  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      className={`flex gap-2.5 rounded-control border px-3 py-2.5 text-body ${NOTICE_TONES[tone]} ${className}`}
    >
      <Icon name={NOTICE_ICONS[tone]} className="mt-0.5 size-4" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="text-fg-secondary">{children}</div>}
      </div>
    </div>
  );
}
