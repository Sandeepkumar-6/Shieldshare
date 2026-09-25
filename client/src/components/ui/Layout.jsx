import { useId } from 'react';

// Content surface with an optional header row. Borders and tonal contrast do the work,
// not shadows (skill §10).
export function Panel({ title, description, actions, children, className = '', bodyClassName = '' }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={title ? headingId : undefined}
      className={`min-w-0 rounded-card border border-line-subtle bg-surface shadow-card ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-subtle px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title && <h2 id={headingId} className="text-heading font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-0.5 text-meta text-fg-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, description, actions, breadcrumb, meta }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        {breadcrumb && <nav aria-label="Breadcrumb" className="mb-2 text-meta text-fg-muted">{breadcrumb}</nav>}
        <h1 className="font-display text-title font-semibold tracking-tight break-words text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-body text-fg-secondary">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-meta text-fg-muted">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// Definition list for metadata ("Size", "Current version", ...).
export function DetailList({ items }) {
  return (
    <dl className="divide-y divide-line-subtle">
      {items.filter(Boolean).map(({ label, value }) => (
        <div key={label} className="grid grid-cols-[minmax(7rem,35%)_1fr] gap-3 px-4 py-2.5">
          <dt className="text-meta text-fg-muted">{label}</dt>
          <dd className="min-w-0 text-body break-words text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
