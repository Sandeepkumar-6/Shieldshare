import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { IncidentStatusBadge, SeverityBadge } from '../../components/security/SecurityBadges.jsx';
import { Select } from '../../components/ui/Field.jsx';
import { FilterTabs } from '../../components/ui/FilterTabs.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { Pagination } from '../../components/ui/Pagination.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useLiveRefresh } from '../../state/SocketContext.jsx';
import { adminApi } from '../../services/admin.service.js';
import { formatDateTime, formatRelative, pluralize } from '../../utils/format.js';

const PAGE_SIZE = 25;
const STATUS_FILTERS = [
  { value: 'ACTIVE', label: 'Open' },
  { value: 'RECOVERED', label: 'Recovered' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'FALSE_POSITIVE', label: 'False positive' },
  { value: '', label: 'All' },
];

function SortHeader({ field, label, sort, onSort }) {
  const active = sort.replace('-', '') === field;
  const descending = sort.startsWith('-');
  return (
    <th scope="col" aria-sort={active ? (descending ? 'descending' : 'ascending') : 'none'} className="px-4 py-2.5 font-medium whitespace-nowrap">
      <button type="button" onClick={() => onSort(active && descending ? field : `-${field}`)} className="inline-flex cursor-pointer items-center gap-1 hover:text-fg">
        {label}
        {active && <Icon name={descending ? 'chevronDown' : 'chevronUp'} className="size-3.5" />}
      </button>
    </th>
  );
}

export default function AdminIncidents() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('ACTIVE');
  const [severity, setSeverity] = useState('');
  const [sort, setSort] = useState('-createdAt');
  const viewKey = `${status}|${severity}|${sort}`;
  const [paging, setPaging] = useState({ key: viewKey, page: 1 });
  const page = paging.key === viewKey ? paging.page : 1;
  const incidents = useAsync(
    () => adminApi.incidents({ status: status || undefined, severity: severity || undefined, sort, page, limit: PAGE_SIZE }),
    [status, severity, sort, page],
  );
  useLiveRefresh(['incident.created', 'incident.updated', 'incident.resolved'], incidents.reload);

  let body;
  if (incidents.status === 'loading') body = <SkeletonRows rows={6} columns={5} label="Loading incidents" />;
  else if (incidents.status === 'error') body = <ErrorState title="Unable to load incidents" error={incidents.error} onRetry={incidents.reload} />;
  else if (incidents.data.data.length === 0) {
    body = status === 'ACTIVE' && !severity ? (
      <EmptyState
        icon="shieldCheck"
        title="No open incidents"
        description="An incident opens when a user's activity reaches HIGH risk. At CRITICAL, ShieldShare freezes the account and quarantines the affected files before responding."
      />
    ) : (
      <EmptyState compact icon="incident" title="No incidents match these filters" />
    );
  } else {
    body = (
      <>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] border-collapse text-body">
            <thead className="border-b border-line-subtle">
              <tr className="text-left text-meta text-fg-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">Severity</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Incident</th>
                <th scope="col" className="w-full px-4 py-2.5 font-medium">User</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Files</th>
                <SortHeader field="riskScore" label="Risk" sort={sort} onSort={setSort} />
                <SortHeader field="createdAt" label="Started" sort={sort} onSort={setSort} />
                <th scope="col" className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {incidents.data.data.map((incident) => (
                <tr
                  key={incident.id}
                  onClick={() => navigate(`/admin/incidents/${incident.id}`)}
                  className="cursor-pointer transition-colors hover:bg-surface-hover/60"
                >
                  <td className="px-4 py-3"><SeverityBadge severity={incident.severity} /></td>
                  <td className="px-4 py-3">
                    <Link to={`/admin/incidents/${incident.id}`} onClick={(event) => event.stopPropagation()} className="font-mono text-tech text-fg hover:text-accent">
                      {incident.incidentNumber}
                    </Link>
                  </td>
                  <td className="max-w-0 px-4 py-3">
                    <p className="truncate text-fg">{incident.user?.name ?? 'Unknown user'}</p>
                    <p className="truncate text-meta text-fg-muted">{incident.user?.email} · {incident.trigger}</p>
                  </td>
                  <td className="px-4 py-3 text-fg-secondary tabular">{incident.affectedFileCount}</td>
                  <td className="px-4 py-3 font-mono text-tech text-fg tabular">{incident.riskScore}</td>
                  <td className="px-4 py-3 whitespace-nowrap text-fg-secondary">
                    <time dateTime={incident.createdAt} title={formatDateTime(incident.createdAt)}>{formatRelative(incident.createdAt)}</time>
                  </td>
                  <td className="px-4 py-3"><IncidentStatusBadge status={incident.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination page={page} limit={PAGE_SIZE} total={incidents.data.meta.total} busy={incidents.refreshing} onPageChange={(next) => setPaging({ key: viewKey, page: next })} />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Incidents"
        description="One incident per user while it is open. Each records the risk evaluation behind it, the timeline, the containment and the recovery."
      />
      <Panel
        title="Security incidents"
        description={incidents.status === 'success' ? pluralize(incidents.data.meta.total, 'incident') : undefined}
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <FilterTabs label="Filter by status" options={STATUS_FILTERS} value={status} onChange={setStatus} />
            <Select aria-label="Filter by severity" value={severity} onChange={(event) => setSeverity(event.target.value)} className="w-36">
              <option value="">Any severity</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
            </Select>
          </div>
        )}
      >
        {body}
      </Panel>
    </>
  );
}
