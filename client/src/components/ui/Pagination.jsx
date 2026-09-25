import { Button } from './Button.jsx';

export function Pagination({ page, limit, total, onPageChange, busy = false }) {
  if (!total || total <= limit) return null;
  const pages = Math.ceil(total / limit);
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between gap-3 border-t border-line-subtle px-4 py-2.5">
      <p className="text-meta text-fg-muted tabular">
        {from}–{to} of {total}
      </p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="ghost" icon="chevronLeft" disabled={page <= 1 || busy} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="text-meta text-fg-muted tabular">
          {page} / {pages}
        </span>
        <Button size="sm" variant="ghost" disabled={page >= pages || busy} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </nav>
  );
}
