import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SeverityBadge } from '../../components/security/SecurityBadges.jsx';
import { AccountStatusBadge, Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Checkbox, Input, Textarea } from '../../components/ui/Field.jsx';
import { FilterTabs } from '../../components/ui/FilterTabs.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useDebouncedValue } from '../../hooks/useDebouncedValue.js';
import { useWriteAccess } from '../../hooks/useWriteAccess.js';
import { adminApi } from '../../services/admin.service.js';
import { useAuth } from '../../state/AuthContext.jsx';
import { useLiveRefresh } from '../../state/SocketContext.jsx';
import { formatDate, formatDateTime, formatRelative, pluralize } from '../../utils/format.js';

const PAGE_SIZE = 25;
const FILTERS = [
  { value: '', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'FROZEN', label: 'Frozen' },
];

export default function AdminUsers() {
  const toast = useToast();
  const access = useWriteAccess();
  const { user: me } = useAuth();
  // ?q= prefills the search (links from the live activity feed).
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '');
  const q = useDebouncedValue(query.trim(), 300);
  const [status, setStatus] = useState('');
  const viewKey = `${q}|${status}`;
  const [paging, setPaging] = useState({ key: viewKey, page: 1 });
  const page = paging.key === viewKey ? paging.page : 1;
  const users = useAsync(() => adminApi.users({ q: q || undefined, status: status || undefined, page, limit: PAGE_SIZE }), [q, status, page]);
  useLiveRefresh(['user.frozen', 'user.unfrozen', 'incident.created', 'incident.resolved'], users.reload);

  const [dialog, setDialog] = useState(null); // { type: 'freeze'|'unfreeze', user }
  const [reason, setReason] = useState('');
  const [signOut, setSignOut] = useState(false);

  const open = (type, user) => {
    setReason('');
    setSignOut(false);
    setDialog({ type, user });
  };
  const target = dialog?.user;

  let body;
  if (users.status === 'loading') body = <SkeletonRows rows={6} columns={5} label="Loading users" />;
  else if (users.status === 'error') body = <ErrorState title="Unable to load users" error={users.error} onRetry={users.reload} />;
  else if (users.data.data.length === 0) {
    body = <EmptyState compact icon="users" title="No matching accounts" description="Try another name, email or status." />;
  } else {
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] border-collapse text-body">
            <thead className="border-b border-line-subtle">
              <tr className="text-left text-meta text-fg-muted">
                <th scope="col" className="w-full px-4 py-2.5 font-medium">User</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Role</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Security</th>
                <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">Last activity</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Joined</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {users.data.data.map((user) => {
                const self = user.id === me?.id;
                return (
                  <tr key={user.id}>
                    <td className="max-w-0 px-4 py-3">
                      <p className="truncate font-medium text-fg">
                        {user.name}
                        {self && <span className="ml-2 text-meta font-normal text-fg-muted">(you)</span>}
                      </p>
                      <p className="truncate text-meta text-fg-muted">{user.email}</p>
                    </td>
                    <td className="px-4 py-3">{user.role === 'admin' ? <Badge tone="accent">Admin</Badge> : <span className="text-fg-secondary">User</span>}</td>
                    <td className="px-4 py-3">
                      <AccountStatusBadge status={user.status} />
                      {user.status === 'FROZEN' && (
                        <p className="mt-1 max-w-56 text-meta text-fg-muted" title={user.frozenReason ?? undefined}>
                          {formatRelative(user.frozenAt)}{user.frozenReason ? ` · ${user.frozenReason}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={user.securityStatus} />
                      {user.openIncidents > 0 && (
                        <Link to="/admin/incidents" className="mt-1 block text-meta whitespace-nowrap text-critical hover:underline">
                          {pluralize(user.openIncidents, 'open incident')}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-fg-secondary">
                      {user.lastActivityAt
                        ? <time dateTime={user.lastActivityAt} title={formatDateTime(user.lastActivityAt)}>{formatRelative(user.lastActivityAt)}</time>
                        : <span className="text-fg-muted">None yet</span>}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-fg-secondary">{formatDate(user.createdAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {user.status === 'ACTIVE' && (
                        <Button
                          size="sm"
                          variant="danger-ghost"
                          icon="pause"
                          disabledReason={self ? 'You can\'t freeze your own account.' : access.reason}
                          onClick={() => open('freeze', user)}
                        >
                          Freeze
                        </Button>
                      )}
                      {user.status === 'FROZEN' && (
                        <Button size="sm" icon="checkCircle" disabledReason={access.reason} onClick={() => open('unfreeze', user)}>
                          Unfreeze
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={PAGE_SIZE} total={users.data.meta.total} busy={users.refreshing} onPageChange={(next) => setPaging({ key: viewKey, page: next })} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Users"
        description="Accounts and their status. Freezing pauses file changes for an account; every freeze and unfreeze is recorded in the audit log."
      />
      <Panel
        title="Accounts"
        description={users.status === 'success' ? pluralize(users.data.meta.total, 'account') : undefined}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs label="Filter by status" options={FILTERS} value={status} onChange={setStatus} />
            <div className="relative w-full sm:w-56">
              <Icon name="search" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
              <Input type="search" aria-label="Search by name or email" placeholder="Name or email" value={query} onChange={(event) => setQuery(event.target.value)} inputClassName="pl-8" />
            </div>
          </div>
        )}
      >
        {body}
      </Panel>

      <ConfirmDialog
        open={dialog?.type === 'freeze'}
        onClose={() => setDialog(null)}
        tone="danger"
        title={`Freeze ${target?.name ?? 'account'}?`}
        confirmLabel="Freeze account"
        confirmDisabled={!reason.trim()}
        onConfirm={async () => {
          const result = await adminApi.freeze(target.id, { reason: reason.trim(), signOut });
          toast.success('Account frozen', signOut
            ? `${target.name} · ${pluralize(result.revokedSessions, 'session')} signed out`
            : target.name);
          users.reload();
        }}
      >
        <p className="text-body text-fg-secondary">
          <span className="text-fg">{target?.name}</span> keeps read-only access: they can sign in, view and download
          their files. Uploads, changes, renames, moves, deletions and sharing are blocked until you unfreeze the
          account. They see a notice that file changes are paused; your reason is not shown to them.
        </p>
        <Textarea
          data-autofocus
          label="Reason (required, recorded in the audit log)"
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
        <Checkbox
          label="Also sign out all of their sessions"
          hint="Every current session ends immediately. They can sign in again, still frozen."
          checked={signOut}
          onChange={(event) => setSignOut(event.target.checked)}
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.type === 'unfreeze'}
        onClose={() => setDialog(null)}
        title={`Unfreeze ${target?.name ?? 'account'}?`}
        confirmLabel="Unfreeze account"
        confirmDisabled={!reason.trim()}
        onConfirm={async () => {
          await adminApi.unfreeze(target.id, { reason: reason.trim() });
          toast.success('Account unfrozen', target.name);
          users.reload();
        }}
      >
        <p className="text-body text-fg-secondary">
          <span className="text-fg">{target?.name}</span> can upload, change and share files again. Their notice
          disappears. Share links and quarantined files are not affected.
        </p>
        <Textarea
          data-autofocus
          label="Reason (required, recorded in the audit log)"
          value={reason}
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmDialog>
    </>
  );
}
