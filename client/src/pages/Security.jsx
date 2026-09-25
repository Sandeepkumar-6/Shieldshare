import { useState } from 'react';
import { Badge } from '../components/ui/Badge.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Icon } from '../components/ui/Icon.jsx';
import { PageHeader, Panel } from '../components/ui/Layout.jsx';
import { ConfirmDialog } from '../components/ui/Modal.jsx';
import { Skeleton, SkeletonRows } from '../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/ui/States.jsx';
import { useToast } from '../components/ui/Toast.jsx';
import { useAsync } from '../hooks/useAsync.js';
import { useAccountNoticeRefresh } from '../state/SocketContext.jsx';
import { accountApi } from '../services/account.service.js';
import { authApi } from '../services/auth.service.js';
import { useAuth } from '../state/AuthContext.jsx';
import { formatDateTime, formatRelative } from '../utils/format.js';
import { describeUserAgent } from '../utils/userAgent.js';

function AccountStatus({ security }) {
  const frozen = security.status === 'FROZEN';
  return (
    <Panel title="Account status">
      <div className="flex items-start gap-3 px-4 py-4">
        <div className={`flex size-9 shrink-0 items-center justify-center rounded-card border ${
          frozen ? 'border-warning/30 bg-warning/10 text-warning' : 'border-success/25 bg-success/10 text-success'
        }`}
        >
          <Icon name={frozen ? 'pause' : 'shieldCheck'} className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-heading font-semibold text-fg">{frozen ? 'File changes paused' : 'Account active'}</p>
            <Badge tone={frozen ? 'warning' : 'success'} dot mono>{security.status}</Badge>
          </div>
          <p className="mt-1 max-w-2xl text-body text-fg-secondary">
            {frozen
              ? security.notice
              : 'You can upload, change, rename, move and delete your files. Every change is recorded in your activity.'}
          </p>
        </div>
      </div>
    </Panel>
  );
}

function SessionsTable({ sessions, onRevoke }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-body">
        <thead className="border-b border-line-subtle">
          <tr className="text-left text-meta font-medium text-fg-muted">
            <th scope="col" className="px-4 py-2.5 font-medium">Device</th>
            <th scope="col" className="px-4 py-2.5 font-medium">IP address</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Signed in</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Last active</th>
            <th scope="col" className="px-4 py-2.5 font-medium">Expires</th>
            <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {sessions.map((session) => (
            <tr key={session.id}>
              <td className="px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Icon name="monitor" className="size-4 text-fg-muted" />
                  <span className="text-fg">{describeUserAgent(session.userAgent)}</span>
                  {session.current && <Badge tone="accent">This session</Badge>}
                </div>
              </td>
              <td className="px-4 py-3 font-mono text-tech text-fg-secondary">{session.ip ?? '—'}</td>
              <td className="px-4 py-3 whitespace-nowrap text-fg-secondary">{formatDateTime(session.createdAt)}</td>
              <td className="px-4 py-3 whitespace-nowrap text-fg-secondary">
                <time dateTime={session.lastSeenAt} title={formatDateTime(session.lastSeenAt)}>{formatRelative(session.lastSeenAt)}</time>
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-fg-secondary">
                <time dateTime={session.expiresAt} title={formatDateTime(session.expiresAt)}>{formatRelative(session.expiresAt)}</time>
              </td>
              <td className="px-4 py-2 text-right">
                <Button size="sm" variant="danger-ghost" icon="logout" onClick={() => onRevoke(session)}>
                  Sign out
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Security() {
  const toast = useToast();
  const { endLocalSession } = useAuth();
  const security = useAsync(() => accountApi.security(), []);
  const sessions = useAsync(() => authApi.sessions(), []);
  const [revokeTarget, setRevokeTarget] = useState(null);
  useAccountNoticeRefresh(security.reload);

  return (
    <>
      <PageHeader title="Security" description="Your account status, where you are signed in, and security notices." />

      <div className="flex flex-col gap-6">
        {security.status === 'loading' && <Skeleton className="h-28 w-full" />}
        {security.status === 'error' && (
          <Panel><ErrorState title="Unable to load your account status" error={security.error} onRetry={security.reload} /></Panel>
        )}
        {security.status === 'success' && <AccountStatus security={security.data} />}

        <Panel
          title="Active sessions"
          description="Each sign-in creates a session. Signing one out ends access from that device immediately."
        >
          {sessions.status === 'loading' && <SkeletonRows rows={2} columns={5} label="Loading sessions" />}
          {sessions.status === 'error' && (
            <ErrorState title="Unable to load sessions" error={sessions.error} onRetry={sessions.reload} />
          )}
          {sessions.status === 'success' && (sessions.data.length === 0 ? (
            <EmptyState compact icon="monitor" title="No active sessions" />
          ) : (
            <SessionsTable sessions={sessions.data} onRevoke={setRevokeTarget} />
          ))}
        </Panel>

        <Panel title="Security notices">
          {security.status === 'loading' && <SkeletonRows rows={2} columns={2} label="Loading notices" />}
          {security.status === 'error' && <ErrorState compact title="Notices unavailable" error={security.error} onRetry={security.reload} />}
          {security.status === 'success' && (security.data.recentNotifications.length === 0 ? (
            <EmptyState
              compact
              icon="bell"
              title="No security notices"
              description="Account restrictions and completed administrator file access appear here."
            />
          ) : (
            <ul className="divide-y divide-line-subtle">
              {security.data.recentNotifications.map((notice) => (
                <li key={notice.id} className="flex items-start gap-3 px-4 py-3">
                  <Icon
                    name={notice.type === 'ACCOUNT_PAUSED' ? 'pause' : notice.type === 'ADMIN_FILE_ACCESS' ? 'eye' : 'checkCircle'}
                    className={`mt-0.5 size-4 ${notice.type === 'ACCOUNT_PAUSED' ? 'text-warning' : notice.type === 'ADMIN_FILE_ACCESS' ? 'text-info' : 'text-success'}`}
                  />
                  <div className="min-w-0">
                    <p className="text-body text-fg">{notice.message}</p>
                    <time dateTime={notice.at} className="text-meta text-fg-muted">{formatDateTime(notice.at)}</time>
                  </div>
                </li>
              ))}
            </ul>
          ))}
        </Panel>
      </div>

      <ConfirmDialog
        open={Boolean(revokeTarget)}
        onClose={() => setRevokeTarget(null)}
        tone="danger"
        title={revokeTarget?.current ? 'Sign out of this session?' : 'Sign out this session?'}
        confirmLabel="Sign out"
        onConfirm={async () => {
          const target = revokeTarget;
          await authApi.revokeSession(target.id);
          if (target.current) {
            endLocalSession('You signed out of this session.');
            return;
          }
          toast.success('Session signed out', describeUserAgent(target.userAgent));
          sessions.reload();
          security.reload();
        }}
      >
        {revokeTarget && (
          <>
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 rounded-control border border-line-subtle bg-bg-secondary px-3.5 py-3">
              <dt className="text-meta text-fg-muted">Device</dt>
              <dd className="text-body text-fg">{describeUserAgent(revokeTarget.userAgent)}</dd>
              <dt className="text-meta text-fg-muted">IP address</dt>
              <dd className="font-mono text-tech text-fg-secondary">{revokeTarget.ip ?? '—'}</dd>
              <dt className="text-meta text-fg-muted">Last active</dt>
              <dd className="text-body text-fg-secondary">{formatDateTime(revokeTarget.lastSeenAt)}</dd>
            </dl>
            <p className="text-body text-fg-secondary">
              {revokeTarget.current
                ? 'You will be signed out here and returned to the sign-in page.'
                : 'That device loses access immediately and will need to sign in again.'}
            </p>
          </>
        )}
      </ConfirmDialog>
    </>
  );
}
