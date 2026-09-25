import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { AdminFileStatusBadge, Badge } from '../../components/ui/Badge.jsx';
import { Input, Textarea } from '../../components/ui/Field.jsx';
import { FilterTabs } from '../../components/ui/FilterTabs.jsx';
import { Icon, fileIconName } from '../../components/ui/Icon.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { Menu } from '../../components/ui/Menu.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useWriteAccess } from '../../hooks/useWriteAccess.js';
import { useLiveRefresh } from '../../state/SocketContext.jsx';
import { adminApi } from '../../services/admin.service.js';
import { downloadWith } from '../../utils/download.js';
import { formatBytes, formatDateTime, formatRelative, pluralize } from '../../utils/format.js';

const PAGE_SIZE = 25;
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'QUARANTINED', label: 'Quarantined' },
  { value: 'DELETED', label: 'Deleted' },
];
const ACCESS_STATE = {
  PENDING: { tone: 'warning', label: 'Owner response pending' },
  APPROVED: { tone: 'success', label: 'One download approved' },
  DENIED: { tone: 'neutral', label: 'Access denied' },
  USED: { tone: 'neutral', label: 'Approval used' },
};

export default function AdminFiles() {
  const toast = useToast();
  const access = useWriteAccess();
  // ?q= prefills the name search (links from the live activity feed).
  const [searchParams] = useSearchParams();
  const [name, setName] = useState(() => searchParams.get('q') ?? '');
  const [owner, setOwner] = useState('');
  const q = useDebouncedValue(name.trim(), 300);
  const ownerQuery = useDebouncedValue(owner.trim(), 300);
  const [status, setStatus] = useState('');
  const viewKey = `${q}|${ownerQuery}|${status}`;
  const [paging, setPaging] = useState({ key: viewKey, page: 1 });
  const page = paging.key === viewKey ? paging.page : 1;
  const files = useAsync(
    () => adminApi.files({ q: q || undefined, owner: ownerQuery || undefined, status: status || undefined, page, limit: PAGE_SIZE }),
    [q, ownerQuery, status, page],
  );
  useLiveRefresh(['file.quarantined', 'recovery.completed', 'incident.resolved'], files.reload);

  const [dialog, setDialog] = useState(null); // { type: 'quarantine'|'request'|'download', file }
  const [reason, setReason] = useState('');
  const target = dialog?.file;

  let body;
  if (files.status === 'loading') body = <SkeletonRows rows={6} columns={5} label="Loading files" />;
  else if (files.status === 'error') body = <ErrorState title="Unable to load files" error={files.error} onRetry={files.reload} />;
  else if (files.data.data.length === 0) {
    body = <EmptyState compact icon="folder" title="No matching files" description="Try another name, owner or status." />;
  } else {
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-body">
            <thead className="border-b border-line-subtle">
              <tr className="text-left text-meta text-fg-muted">
                <th scope="col" className="w-full px-4 py-2.5 font-medium">File</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Owner</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Size</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Version</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Content access</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Modified</th>
                <th scope="col" className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {files.data.data.map((file) => (
                <tr key={file.id}>
                  <td className="max-w-0 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon name={fileIconName(file.name)} className="size-5 text-fg-muted" />
                      <span className="truncate font-medium text-fg" title={file.name}>{file.name}</span>
                      {file.isCanary && <Badge tone="info">Canary</Badge>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="max-w-48 truncate text-fg-secondary" title={file.owner?.email}>{file.owner?.name ?? '—'}</p>
                    <p className="max-w-48 truncate text-meta text-fg-muted">{file.owner?.email}</p>
                  </td>
                  <td className="px-4 py-2.5"><AdminFileStatusBadge status={file.status} /></td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-fg-secondary tabular">{formatBytes(file.size)}</td>
                  <td className="px-4 py-2.5 font-mono text-tech text-fg-secondary">v{file.currentVersion}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {file.isCanary ? (
                      <Badge tone="neutral">System file</Badge>
                    ) : file.accessRequest ? (
                      <Badge tone={ACCESS_STATE[file.accessRequest.status]?.tone ?? 'neutral'}>
                        {ACCESS_STATE[file.accessRequest.status]?.label ?? file.accessRequest.status}
                      </Badge>
                    ) : (
                      <span className="text-meta text-fg-muted">Not requested</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-fg-secondary">
                    <time dateTime={file.updatedAt} title={formatDateTime(file.updatedAt)}>{formatRelative(file.updatedAt)}</time>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <Menu
                      label={`Actions for ${file.name}`}
                      items={[
                        file.status === 'ACTIVE' && {
                          label: 'Quarantine…',
                          icon: 'lock',
                          tone: 'danger',
                          disabledReason: access.reason,
                          disabledHint: access.hint,
                          onSelect: () => {
                            setReason('');
                            setDialog({ type: 'quarantine', file });
                          },
                        },
                        !file.isCanary && file.accessRequest?.status === 'APPROVED' && {
                          label: `Download approved v${file.accessRequest.versionNumber}…`,
                          icon: 'download',
                          disabledReason: access.reason,
                          disabledHint: access.hint,
                          onSelect: () => setDialog({ type: 'download', file }),
                        },
                        !file.isCanary && file.accessRequest?.status === 'PENDING' && {
                          label: 'Waiting for owner',
                          icon: 'clock',
                          disabledReason: 'The owner has not responded yet.',
                          disabledHint: 'File contents remain private.',
                          onSelect: () => {},
                        },
                        !file.isCanary && !['PENDING', 'APPROVED'].includes(file.accessRequest?.status) && {
                          label: file.accessRequest ? 'Request access again…' : 'Request file access…',
                          icon: 'eye',
                          disabledReason: access.reason,
                          disabledHint: access.hint,
                          onSelect: () => {
                            setReason('');
                            setDialog({ type: 'request', file });
                          },
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={PAGE_SIZE} total={files.data.meta.total} busy={files.refreshing} onPageChange={(next) => setPaging({ key: viewKey, page: next })} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Files"
        description="Metadata-only file inventory: owners, sharing counts, versions and security condition. File contents require the owner's approval for one specific download."
      />
      <Panel
        title="All files"
        description={files.status === 'success' ? pluralize(files.data.meta.total, 'file') : undefined}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs label="Filter by status" options={FILTERS} value={status} onChange={setStatus} />
            <Input type="search" aria-label="Search by file name" placeholder="File name" value={name} onChange={(event) => setName(event.target.value)} className="w-full sm:w-44" />
            <Input type="search" aria-label="Search by owner name or email" placeholder="Owner" value={owner} onChange={(event) => setOwner(event.target.value)} className="w-full sm:w-44" />
          </div>
        )}
      >
        {body}
      </Panel>

      <ConfirmDialog
        open={dialog?.type === 'quarantine'}
        onClose={() => setDialog(null)}
        tone="danger"
        title={`Quarantine ${target?.name ?? 'file'}?`}
        confirmLabel="Quarantine file"
        confirmDisabled={!reason.trim()}
        onConfirm={async () => {
          const result = await adminApi.quarantine(target.id, reason.trim());
          toast.success('File quarantined', `${target.name} · ${pluralize(result.suspendedLinks, 'share link')} suspended`);
          files.reload();
        }}
      >
        <p className="text-body text-fg-secondary">
          The file becomes read-only for its owner (<span className="text-fg">{target?.owner?.email}</span>):
          downloading, changing, renaming, moving, deleting and sharing are blocked. The current version
          (<span className="font-mono text-tech">v{target?.currentVersion}</span>) is marked Quarantined
          {target?.shareCount ? <> and {pluralize(target.shareCount, 'active share link')} will be suspended</> : null}.
          Nothing is moved or deleted; release it from the Quarantine page. The owner sees only that the file is
          under review.
        </p>
        <Textarea
          data-autofocus
          label="Reason (required, recorded in the audit log)"
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'request'}
        onClose={() => setDialog(null)}
        title="Request file access"
        confirmLabel="Send request"
        confirmDisabled={!reason.trim()}
        onConfirm={async () => {
          await adminApi.requestFileAccess(target.id, { reason: reason.trim() });
          toast.success('Access requested', `${target.owner?.name} must approve access to ${target.name} v${target.currentVersion}.`);
          files.reload();
        }}
      >
        <p className="text-body text-fg-secondary">
          Ask <span className="text-fg">{target?.owner?.name}</span> for one-time access to{' '}
          <span className="text-fg">{target?.name}</span>{' '}
          (<span className="font-mono text-tech">v{target?.currentVersion}</span>). Until they approve, you can see
          only metadata, sharing state and security condition. The owner will see your reason.
        </p>
        <Textarea
          data-autofocus
          label="Reason for access (required, shown to the owner and audited)"
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'download'}
        onClose={() => setDialog(null)}
        title="Use one-time file access?"
        confirmLabel="Download once"
        onConfirm={async () => {
          await downloadWith(() => adminApi.forensicDownload(target.accessRequest.id), target.name);
          toast.info('Approved download started', `${target.name} (v${target.accessRequest.versionNumber}) · approval consumed`);
          files.reload();
        }}
      >
        <p className="text-body text-fg-secondary">
          The owner approved one download of <span className="text-fg">{target?.name}</span>{' '}
          (<span className="font-mono text-tech">v{target?.accessRequest?.versionNumber}</span>). Downloading consumes
          that approval. Any later access requires a new request, and this access is recorded for both parties.
        </p>
      </ConfirmDialog>
    </>
  );
}
