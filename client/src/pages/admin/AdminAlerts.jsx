import { useState } from 'react';
import { Link } from 'react-router';
import { SeverityBadge } from '../../components/security/SecurityBadges.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { FilterTabs } from '../../components/ui/FilterTabs.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
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
  { value: 'UNREAD', label: 'Unread' },
  { value: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { value: '', label: 'All' },
];
const TYPE_LABEL = {
  INCIDENT_CREATED: 'Incident opened',
  INCIDENT_ESCALATED: 'Contained',
  CANARY_TRIGGERED: 'Canary touched',
  INCIDENT_RESOLVED: 'Incident closed',
};

// Alerts are notifications about incidents (spec §18 "Alert vs Incident"); the reasons and
// evidence live on the incident.
export default function AdminAlerts() {
  const toast = useToast();
  const access = useWriteAccess();
  const [status, setStatus] = useState('UNREAD');
  const [paging, setPaging] = useState({ key: status, page: 1 });
  const page = paging.key === status ? paging.page : 1;
  const alerts = useAsync(() => adminApi.alerts({ status: status || undefined, page, limit: PAGE_SIZE }), [status, page]);
  useLiveRefresh('security.alert', alerts.reload);
  const [busyId, setBusyId] = useState(null);

  async function acknowledge(alert) {
    setBusyId(alert.id);
    try {
      await adminApi.acknowledgeAlert(alert.id);
      toast.success('Alert acknowledged');
      alerts.reload();
    } catch (error) {
      toast.error('Could not acknowledge', error.message);
    } finally {
      setBusyId(null);
    }
  }

  let body;
  if (alerts.status === 'loading') body = <SkeletonRows rows={5} columns={3} label="Loading alerts" />;
  else if (alerts.status === 'error') body = <ErrorState title="Unable to load alerts" error={alerts.error} onRetry={alerts.reload} />;
  else if (alerts.data.data.length === 0) {
    body = status === 'UNREAD'
      ? <EmptyState icon="bell" title="No unread alerts" description="Alerts appear when an incident opens, is contained or closes, and when a canary file is touched." />
      : <EmptyState compact icon="bell" title="No alerts here" />;
  } else {
    body = (
      <>
        <ul className="divide-y divide-line-subtle">
          {alerts.data.data.map((alert) => (
            <li key={alert.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="flex shrink-0 items-center gap-2 sm:w-40">
                <SeverityBadge severity={alert.severity} />
                <span className="text-meta text-fg-muted">{TYPE_LABEL[alert.type] ?? alert.type}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className={`break-words ${alert.status === 'UNREAD' ? 'font-medium text-fg' : 'text-fg-secondary'}`}>{alert.title}</p>
                <p className="text-meta text-fg-muted">
                  <time dateTime={alert.createdAt} title={formatDateTime(alert.createdAt)}>{formatRelative(alert.createdAt)}</time>
                  {alert.incident
                    ? <> · <Link to={`/admin/incidents/${alert.incident.id}`} className="font-mono text-fg-secondary hover:text-accent">{alert.incident.incidentNumber}</Link></>
                    : ' · no incident'}
                  {alert.acknowledgedBy && ` · acknowledged by ${alert.acknowledgedBy.name}`}
                </p>
              </div>
              {alert.status === 'UNREAD' && (
                <Button size="sm" icon="check" loading={busyId === alert.id} disabledReason={access.reason} onClick={() => acknowledge(alert)}>
                  Acknowledge
                </Button>
              )}
            </li>
          ))}
        </ul>
        <Pagination page={page} limit={PAGE_SIZE} total={alerts.data.meta.total} busy={alerts.refreshing} onPageChange={(next) => setPaging({ key: status, page: next })} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Alerts" description="Notifications about incidents and canary files. Open the incident for the evidence." />
      <Panel
        title="Alerts"
        description={alerts.status === 'success' ? `${pluralize(alerts.data.meta.unread, 'unread alert')}` : undefined}
        actions={<FilterTabs label="Filter alerts" options={FILTERS} value={status} onChange={setStatus} />}
      >
        {body}
      </Panel>
    </>
  );
}
