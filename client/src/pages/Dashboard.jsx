import { Link } from 'react-router';
import { Button } from '../components/ui/Button.jsx';
import { FileStatusBadge, ShareStatusBadge } from '../components/ui/Badge.jsx';
import { Icon, fileIconName } from '../components/ui/Icon.jsx';
import { PageHeader, Panel } from '../components/ui/Layout.jsx';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/ui/States.jsx';
import { ActivityList } from '../features/activity/ActivityList.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAccountNoticeRefresh } from '../state/SocketContext.jsx';
import { accountApi } from '../services/account.service.js';
import { folderApi } from '../services/folder.service.js';
import { useAuth } from '../state/AuthContext.jsx';
import { folderLookup } from '../utils/folders.js';
import { formatBytes, formatDateTime, formatRelative, pluralize } from '../utils/format.js';

function Stat({ label, value, to }) {
  const body = (
    <>
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className="mt-1 text-title font-semibold text-fg tabular">{value}</dd>
    </>
  );
  return to ? (
    <Link to={to} className="block rounded-control px-4 py-3 transition-colors hover:bg-surface-hover">{body}</Link>
  ) : (
    <div className="px-4 py-3">{body}</div>
  );
}

// Account state first (spec §25 priorities), then the numbers, then recent work.
function AccountSummary({ data }) {
  const frozen = data.security.status === 'FROZEN';
  return (
    <section aria-label="Account summary" className="grid overflow-hidden rounded-card border border-line-subtle bg-surface lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)]">
      <div className={`flex items-start gap-3 border-b border-line-subtle px-4 py-4 lg:border-b-0 lg:border-r ${frozen ? 'bg-warning/5' : ''}`}>
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-card border ${
          frozen ? 'border-warning/30 bg-warning/10 text-warning' : 'border-success/25 bg-success/10 text-success'
        }`}
        >
          <Icon name={frozen ? 'pause' : 'shieldCheck'} className="size-5" />
        </div>
        <div className="min-w-0">
          <p className="text-heading font-semibold text-fg">{frozen ? 'File changes paused' : 'Account active'}</p>
          <p className="mt-0.5 text-body text-fg-secondary">
            {frozen ? 'You can still view and download your files.' : 'You can upload, change and organize your files.'}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-line-subtle">
        <Stat label="Files" value={data.fileCount} to="/app/files" />
        <Stat label="Storage used" value={formatBytes(data.storageBytes)} />
        <Stat label="Active sessions" value={data.security.activeSessions} to="/app/security" />
      </dl>
    </section>
  );
}

function RecentFiles({ files }) {
  if (files.length === 0) {
    return (
      <EmptyState
        compact
        icon="upload"
        title="No files yet"
        description="Upload a file and ShieldShare records its SHA-256 fingerprint and keeps every version you create."
        action={<Button variant="primary" icon="upload" to="/app/files">Upload files</Button>}
      />
    );
  }
  return (
    <ul className="divide-y divide-line-subtle">
      {files.map((file) => (
        <li key={file.id} className="flex items-center gap-3 px-4 py-2.5">
          <Icon name={fileIconName(file.name)} className="size-5 text-fg-muted" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Link to={`/app/files/${file.id}`} className="truncate font-medium text-fg hover:text-accent" title={file.name}>
                {file.name}
              </Link>
              {file.status !== 'ACTIVE' && <FileStatusBadge status={file.status} />}
            </div>
            <p className="text-meta text-fg-muted">
              v{file.currentVersion} · {formatBytes(file.size)} ·{' '}
              <time dateTime={file.updatedAt} title={formatDateTime(file.updatedAt)}>modified {formatRelative(file.updatedAt)}</time>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function RecentShares({ links }) {
  if (links.length === 0) {
    return (
      <EmptyState
        compact
        icon="link"
        title="No share links yet"
        description="Open a file and create a link on its Sharing tab. Links always expire."
      />
    );
  }
  return (
    <ul className="divide-y divide-line-subtle">
      {links.map((link) => (
        <li key={link.id} className="flex items-center gap-3 px-4 py-2.5">
          <Icon name="link" className="size-4 text-fg-muted" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-body text-fg">
              {link.fileName ?? 'Unknown file'}
              {link.recipientLabel && <span className="text-fg-muted"> · {link.recipientLabel}</span>}
            </p>
            <p className="text-meta text-fg-muted">
              {link.permission === 'DOWNLOAD' ? 'View & download' : 'View only'} · opened {pluralize(link.accessCount, 'time')} ·{' '}
              <time dateTime={link.expiresAt} title={formatDateTime(link.expiresAt)}>
                {link.status === 'EXPIRED' ? 'expired' : `expires ${formatRelative(link.expiresAt, { maxDays: 31 })}`}
              </time>
            </p>
          </div>
          <ShareStatusBadge status={link.status} />
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const dashboard = useAsync(() => accountApi.dashboard(), []);
  const folders = useAsync(() => folderApi.list(), []);
  useAccountNoticeRefresh(dashboard.reload);

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Signed in as ${user?.name}. Your files, storage and recent activity.`}
      />

      {dashboard.status === 'loading' && (
        <div role="status" aria-live="polite" className="flex flex-col gap-6">
          <span className="sr-only">Loading overview</span>
          <Skeleton className="h-[5.5rem] w-full" />
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="rounded-card border border-line-subtle bg-surface lg:col-span-3"><SkeletonRows rows={5} /></div>
            <div className="rounded-card border border-line-subtle bg-surface lg:col-span-2"><SkeletonRows rows={5} columns={2} /></div>
          </div>
        </div>
      )}

      {dashboard.status === 'error' && (
        <Panel>
          <ErrorState title="Unable to load your overview" error={dashboard.error} onRetry={dashboard.reload} />
        </Panel>
      )}

      {dashboard.status === 'success' && (
        <div className="flex flex-col gap-6">
          <AccountSummary data={dashboard.data} />
          <div className="grid items-start gap-6 lg:grid-cols-5">
            <div className="flex min-w-0 flex-col gap-6 lg:col-span-3">
              <Panel
                title="Recent files"
                description={dashboard.data.fileCount > 0 ? pluralize(dashboard.data.fileCount, 'file') : undefined}
                actions={dashboard.data.fileCount > 0 && <Button size="sm" variant="ghost" to="/app/files">All files</Button>}
              >
                <RecentFiles files={dashboard.data.recentFiles} />
              </Panel>
              <Panel
                title="Recent share links"
                actions={dashboard.data.recentShares.length > 0 && <Button size="sm" variant="ghost" to="/app/shares">All links</Button>}
              >
                <RecentShares links={dashboard.data.recentShares} />
              </Panel>
            </div>
            <Panel
              className="lg:col-span-2"
              title="Recent activity"
              actions={<Button size="sm" variant="ghost" to="/app/activity">All activity</Button>}
            >
              {dashboard.data.recentActivity.length === 0 ? (
                <EmptyState compact icon="activity" title="No activity yet" description="Uploads, changes and sign-ins appear here as they happen." />
              ) : (
                <ActivityList items={dashboard.data.recentActivity} folderName={folderLookup(folders)} showIp={false} dense />
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
