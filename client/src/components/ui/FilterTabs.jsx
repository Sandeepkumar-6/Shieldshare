// A row of mutually exclusive filter buttons (not navigation tabs): each is a toggle button
// with aria-pressed, so assistive tech announces the active filter.
export function FilterTabs({ label, options, value, onChange }) {
  return (
    <div role="group" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-control border border-line-subtle bg-bg-secondary p-0.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`cursor-pointer rounded-[3px] px-2.5 py-1 text-meta font-medium transition-colors duration-150 ${
              active ? 'bg-surface-elevated text-fg' : 'text-fg-secondary hover:text-fg'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
