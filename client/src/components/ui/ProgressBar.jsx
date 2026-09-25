// Determinate progress (bytes sent) or indeterminate (server working, duration unknown).
export function ProgressBar({ value, indeterminate = false, label, tone = 'accent' }) {
  const color = tone === 'critical' ? 'bg-critical' : tone === 'success' ? 'bg-success' : 'bg-accent';
  const percent = Math.round(Math.min(Math.max(value ?? 0, 0), 1) * 100);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={indeterminate ? undefined : 0}
      aria-valuemax={indeterminate ? undefined : 100}
      aria-valuenow={indeterminate ? undefined : percent}
      className="h-1 w-full overflow-hidden rounded-full bg-surface-hover"
    >
      <div
        className={`h-full rounded-full ${color} ${indeterminate ? 'w-full animate-pulse opacity-70' : 'transition-[width] duration-200'}`}
        style={indeterminate ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}
