import { useId } from 'react';

// Hover/focus tooltip. The child receives aria-describedby so screen readers announce the
// text too. Used for disabled-control explanations (e.g. frozen account).
export function Tooltip({ content, children, side = 'top', className = '' }) {
  const id = useId();
  if (!content) return children;

  const position = side === 'bottom'
    ? 'top-full mt-2'
    : 'bottom-full mb-2';

  return (
    <span className={`group/tooltip relative inline-flex ${className}`}>
      {typeof children === 'function' ? children({ 'aria-describedby': id }) : children}
      <span
        role="tooltip"
        id={id}
        className={`pointer-events-none absolute left-1/2 z-50 w-max max-w-64 -translate-x-1/2 rounded-control border border-line bg-surface-elevated px-2.5 py-1.5 text-meta text-fg-secondary opacity-0 shadow-raised transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${position}`}
      >
        {content}
      </span>
    </span>
  );
}
