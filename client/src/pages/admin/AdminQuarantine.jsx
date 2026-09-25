import { useState } from 'react';
import { Badge, VersionStatusBadge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Textarea } from '../../components/ui/Field.jsx';
import { FilterTabs } from '../../components/ui/FilterTabs.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useWriteAccess } from '../../hooks/useWriteAccess.js';
import { useLiveRefresh } from '../../state/SocketContext.jsx';
import { adminApi } from '../../services/admin.service.js';
import { formatDateTime, formatRelative, pluralize } from '../../utils/format.js';

const PAGE_SIZE = 25;
const FILTERS = [
  { value: 'QUARANTINED', label: 'Quarantined' },
  { value: 'RELEASED', label: 'Released' },
  { value: '', label: 'All' },
];

const ITEM_STATUS = {
  QUARANTINED: { tone: 'critical', label: 'Quarantined' },
  RELEASED: { tone: 'success', label: 'Released' },
  RESTORED: { tone: 'info', label: 'Restored' },
};

export default function AdminQuarantine() {
  const toast = useToast();
  const access = useWriteAccess();
  const [status, setStatus] = useState('QUARANTINED');
  const [paging, setPaging] = useState({ key: status, page: 1 });
  const page = paging.key === status ? paging.page : 1;
  const items = useAsync(() => adminApi.quarantineList({ status: status || undefined, page, limit: PAGE_SIZE }), [status, page]);
  useLiveRefresh(['file.quarantined', 'recovery.completed', 'incident.resolved'], items.reload);
  const [target, setTarget] = useState(null);
  const [note, setNote] = useState('');

  let body;
  if (items.status === 'loading') body = <SkeletonRows rows={4} columns={5} label="Loading quarantine" />;
  else if (items.status === 'error') body = <ErrorState title="Unable to load quarantine" error={items.error} onRetry={items.reload} />;
  else if (items.data.data.length === 0) {
    body = status === 'QUARANTINED' ? (
      <EmptyState
        icon="lock"
        title="Nothing is quarantined"
        description="Files you quarantine from the Files page appear here until you release them."
      />
    ) : (
      <EmptyState compact icon="lock" title="No matching quarantine records" />
    );
  } else {
    body = (
      <>
        <ul className="divide-y divide-line-subtle">
          {items.data.data.map((item) => {
            const state = ITEM_STATUS[item.status] ?? { tone: 'neutral', label: item.status };
            return (
              <li key={item.id} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-medium text-fg" title={item.file?.name}>{item.file?.name ?? 'Unknown file'}</p>
                    <Badge tone={state.tone} dot>{state.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-meta text-fg-muted">
                    Owner {item.owner ? `${item.owner.name} · ${item.owner.email}` : 'unknown'}
                  </p>
                  <dl className="mt-3 grid gap-x-6 gap-y-2 text-body sm:grid-cols-[8rem_1fr]">
                    <dt className="text-meta text-fg-muted">Reason</dt>
                    <dd className="text-fg break-words">{item.reason}</dd>
                    <dt className="text-meta text-fg-muted">Quarantined</dt>
                    <dd className="text-fg-secondary">
                      <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>{formatRelative(item.createdAt)}</time>
                      {' by '}
                      {item.quarantinedBy === 'SYSTEM' ? 'ShieldShare (automatic)' : (item.admin?.name ?? 'an administrator')}
                    </dd>
                    <dt className="text-meta text-fg-muted">Versions</dt>
                    <dd className="flex flex-wrap items-center gap-2">
                      {item.versions.map((version) => (
                        <span key={version.id} className="inline-flex items-center gap-1.5">
                          <span className="font-mono text-tech text-fg-secondary">v{version.versionNumber}</span>
                          <VersionStatusBadge status={version.securityStatus} />
                        </span>
                      ))}
                    </dd>
                    {item.status === 'QUARANTINED' && (
                      <>
                        <dt className="text-meta text-fg-muted">Share links</dt>
                        <dd className="text-fg-secondary">{pluralize(item.suspendedLinks, 'link')} suspended by this quarantine</dd>
                      </>
                    )}
                    {item.releasedAt && (
                      <>
                        <dt className="text-meta text-fg-muted">Released</dt>
                        <dd className="text-fg-secondary">
                          <time dateTime={item.releasedAt} title={formatDateTime(item.releasedAt)}>{formatRelative(item.releasedAt)}</time>
                          {item.releasedBy && ` by ${item.releasedBy.name}`}
                          {item.releaseNote && <span className="block text-fg">“{item.releaseNote}”</span>}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {item.status === 'QUARANTINED' && (
                    <Button
                      size="sm"
                      variant="primary"
                      icon="unlock"
                      disabledReason={access.reason}
                      onClick={() => {
                        setNote('');
                        setTarget(item);
                      }}
                    >
                      Release
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <Pagination page={page} limit={PAGE_SIZE} total={items.data.meta.total} busy={items.refreshing} onPageChange={(next) => setPaging({ key: status, page: next })} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Quarantine"
        description="Quarantined files are read-only and their share links are paused. Content remains private unless the owner approves a one-time request from the Files page."
      />
      <Panel
        title="Quarantine records"
        description={items.status === 'success' ? pluralize(items.data.meta.total, 'record') : undefined}
        actions={<FilterTabs label="Filter by status" options={FILTERS} value={status} onChange={setStatus} />}
      >
        {body}
      </Panel>

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        title={`Release ${target?.file?.name ?? 'file'}?`}
        confirmLabel="Release file"
        confirmDisabled={!note.trim()}
        onConfirm={async () => {
          const result = await adminApi.release(target.id, note.trim());
          toast.success('File released', `${target.file?.name} · ${pluralize(result.reactivatedLinks, 'link')} reactivated`);
          items.reload();
        }}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-fg-secondary">
          <li>The file returns to Active at its current version (<span className="font-mono text-tech">v{target?.file?.currentVersion}</span>). Nothing is restored.</li>
          <li>Quarantined versions ({target?.versions.map((version) => `v${version.versionNumber}`).join(', ')}) return to Safe.</li>
          <li>{pluralize(target?.suspendedLinks ?? 0, 'share link')} suspended by this quarantine come back if they haven&apos;t expired.</li>
          <li>The owner can download, change and share the file again.</li>
        </ul>
        <Textarea
          data-autofocus
          label="Release note (required, recorded in the audit log)"
          value={note}
          maxLength={1000}
          onChange={(event) => setNote(event.target.value)}
        />
      </ConfirmDialog>
    </>
  );
}
