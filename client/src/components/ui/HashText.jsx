import { shortHash } from '../../utils/format.js';
import { Icon } from './Icon.jsx';
import { useToast } from './Toast.jsx';

// A SHA-256 fingerprint: monospace, shortened unless `full`, with a copy control.
export function HashText({ hash, full = false, label = 'SHA-256', className = '' }) {
  const toast = useToast();
  if (!hash) return <span className="text-fg-muted">—</span>;

  async function copy() {
    try {
      await navigator.clipboard.writeText(hash);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy', 'Your browser blocked clipboard access.');
    }
  }

  return (
    <span className={`inline-flex min-w-0 items-start gap-1.5 ${className}`}>
      <code
        title={full ? undefined : hash}
        className={`font-mono text-tech text-fg-secondary ${full ? 'break-all' : 'whitespace-nowrap'}`}
      >
        {full ? hash : shortHash(hash)}
      </code>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 cursor-pointer rounded-control p-0.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
        aria-label={`Copy full ${label}`}
      >
        <Icon name="copy" className="size-3.5" />
      </button>
    </span>
  );
}
