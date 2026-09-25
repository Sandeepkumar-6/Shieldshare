// Loading placeholders shaped like the content they stand in for (skill §31).
export function Skeleton({ className = 'h-4 w-full' }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-control bg-surface-hover ${className}`} />;
}

export function SkeletonText({ lines = 3, className = '' }) {
  return (
    <div aria-hidden="true" className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={`h-3.5 ${index === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}

// Rows for list/table regions. `label` is announced once for assistive tech.
export function SkeletonRows({ rows = 5, label = 'Loading', columns = 3 }) {
  return (
    <div role="status" aria-live="polite" className="divide-y divide-line-subtle">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="size-8 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={`h-3.5 ${row % 2 ? 'w-1/3' : 'w-1/2'}`} />
            <Skeleton className="h-3 w-1/4" />
          </div>
          {Array.from({ length: Math.max(columns - 2, 0) }, (_, column) => (
            <Skeleton key={column} className="hidden h-3.5 w-16 sm:block" />
          ))}
        </div>
      ))}
    </div>
  );
}
