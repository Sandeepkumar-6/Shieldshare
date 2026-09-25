import { useState } from 'react';
import { Badge, FileStatusBadge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { FilterTabs } from '../components/ui/FilterTabs.jsx';
import { PageHeader, Panel } from '../components/ui/Layout.jsx';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { Pagination } from '../components/ui/Pagination.jsx';
import { SkeletonRows } from '../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/ui/States.jsx';
import { ShareLinkTable } from '../features/shares/ShareLinkTable.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useWriteAccess } from '../hooks/useWriteAccess.js';
import { accountApi } from '../services/account.service.js';
import { shareApi } from '../services/share.service.js';
import { formatDateTime, pluralize } from '../utils/format.js';

const PAGE_SIZE = 25;
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'EXPIRED', label: 'Expired' },
  { value: 'REVOKED', label: 'Revoked' },
];
const REQUEST_STATUS = {
  PENDING: { tone: 'warning', label: 'Your decision' },
  APPROVED: { tone: 'success', label: 'Approved once' },
  DENIED: { tone: 'neutral', label: 'Denied' },
  USED: { tone: 'neutral', label: 'Accessed once' },
};

export default function Shares() {
  const access = useWriteAccess();
  const [status, setStatus] = useState('');
  const [paging, setPaging] = useState({ key: status, page: 1 });
  const page = paging.key === status ? paging.page : 1;
  const links = useAsync(() => shareApi.list({ status: status || undefined, page, limit: PAGE_SIZE }), [status, page]);
  const requests = useAsync(() => accountApi.fileAccessRequests({ page: 1, limit: 25 }), []);
  const [decision, setDecision] = useState(null); // { request, value: 'APPROVE'|'DENY' }
  const filterLabel = FILTERS.find((filter) => filter.value === status)?.label.toLowerCase();

  return (
    <>
      <PageHeader
        title="File sharing"
        description="Control public share links and decide whether an administrator may access one specific file version."
      />
      <Panel
        title="File access requests"
        description="Your files stay private by default. An approval permits one download of the named version only."
      >
        {requests.status === 'loading' && <SkeletonRows rows={2} columns={3} label="Loading file access requests" />}
        {requests.status === 'error' && <ErrorState compact title="Unable to load access requests" error={requests.error} onRetry={requests.reload} />}
        {requests.status === 'success' && (requests.data.data.length === 0 ? (
          <EmptyState compact icon="shield" title="No file access requests" description="Administrator requests will appear here with a reason before any file content can be accessed." />
        ) : (
          <ul className="divide-y divide-line-subtle">
            {requests.data.data.map((request) => {
              const state = REQUEST_STATUS[request.status] ?? { tone: 'neutral', label: request.status };
              return (
                <li key={request.id} className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-fg">{request.file?.name ?? 'Unavailable file'}</p>
                      <span className="font-mono text-tech text-fg-secondary">v{request.versionNumber}</span>
                      {request.file && <FileStatusBadge status={request.file.status} />}
                      <Badge tone={state.tone}>{state.label}</Badge>
                    </div>
                    <p className="mt-1 text-body text-fg-secondary">
                      {request.administrator?.name ?? 'An administrator'} requested one-time access: “{request.reason}”
                    </p>
                    <p className="mt-1 text-meta text-fg-muted">Requested {formatDateTime(request.requestedAt)}</p>
                  </div>
                  {request.status === 'PENDING' && (
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setDecision({ request, value: 'DENY' })}>Deny</Button>
                      <Button size="sm" variant="primary" onClick={() => setDecision({ request, value: 'APPROVE' })}>Approve once</Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ))}
      </Panel>
      <Panel
        title="Share links"
        description={links.status === 'success' ? pluralize(links.data.meta.total, 'link') : undefined}
        actions={<FilterTabs label="Filter by status" options={FILTERS} value={status} onChange={setStatus} />}
      >
        {links.status === 'loading' && <SkeletonRows rows={5} columns={5} label="Loading share links" />}
        {links.status === 'error' && <ErrorState title="Unable to load your share links" error={links.error} onRetry={links.reload} />}
        {links.status === 'success' && (links.data.data.length === 0 ? (
          status ? (
            <EmptyState compact icon="link" title={`No ${filterLabel} links`} description="Choose another filter to see the rest of your links." />
          ) : (
            <EmptyState
              icon="link"
              title="You haven't shared anything yet"
              description="Open a file and create a link on its Sharing tab. Links always expire, and you can revoke them at any time."
              action={<Button to="/app/files" icon="folder">Go to files</Button>}
            />
          )
        ) : (
          <>
            <ShareLinkTable links={links.data.data} showFile access={access} onChanged={links.reload} />
            <Pagination
              page={page}
              limit={PAGE_SIZE}
              total={links.data.meta.total}
              busy={links.refreshing}
              onPageChange={(next) => setPaging({ key: status, page: next })}
            />
          </>
        ))}
      </Panel>

      <ConfirmDialog
        open={Boolean(decision)}
        onClose={() => setDecision(null)}
        tone={decision?.value === 'DENY' ? 'danger' : 'primary'}
        title={decision?.value === 'APPROVE' ? 'Approve one download?' : 'Deny file access?'}
        confirmLabel={decision?.value === 'APPROVE' ? 'Approve once' : 'Deny access'}
        onConfirm={async () => {
          await accountApi.respondToFileAccessRequest(decision.request.id, decision.value);
          requests.reload();
        }}
      >
        <p className="text-body text-fg-secondary">
          {decision?.value === 'APPROVE' ? (
            <>
              This lets {decision?.request.administrator?.name ?? 'the administrator'} download{' '}
              <span className="text-fg">{decision?.request.file?.name}</span>{' '}
              (<span className="font-mono text-tech">v{decision?.request.versionNumber}</span>) exactly once.
              It does not grant access to other files or versions. The download will be recorded.
            </>
          ) : (
            <>The administrator will not be able to download this file version. They may send a new request with another explanation.</>
          )}
        </p>
      </ConfirmDialog>
    </>
  );
}
