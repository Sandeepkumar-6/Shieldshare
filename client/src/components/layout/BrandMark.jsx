export function BrandMark({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden="true">
        <path
          d="M12 2.8l7.2 3v5c0 4.6-3 8.6-7.2 10.2C7.8 19.4 4.8 15.4 4.8 10.8v-5z"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="M9 11.8l2.1 2.1 4-4.3" fill="none" stroke="var(--color-fg)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-heading font-semibold tracking-tight text-fg">ShieldShare</span>
    </span>
  );
}
