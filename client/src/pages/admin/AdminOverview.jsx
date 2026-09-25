import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { IncidentStatusBadge, SeverityBadge } from '../../components/security/SecurityBadges.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { Skeleton, SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { LiveFeed } from '../../features/activity/LiveFeed.jsx';
import { ChartState, RiskTimelineChart } from '../../features/analytics/charts.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { adminApi } from '../../services/admin.service.js';
import { useLiveRefresh } from '../../state/SocketContext.jsx';
import { formatDateTime, formatRelative, pluralize } from '../../utils/format.js';

// Admin dashboard, ordered by priority (skill §13–14, spec §20):
//   security state → summary cards → risk over time → live activity + active incidents.
// Every number comes from the API and is refetched when security events arrive or the
// socket reconnects.

const SECURITY_EVENTS = [
  'incident.created', 'incident.updated', 'incident.resolved', 'user.frozen', 'user.unfrozen',
  'file.quarantined', 'recovery.completed', 'security.alert', 'risk.updated',
];
const TIMELINE_MINUTES = 60;

function SecurityStatus({ summary }) {
  const active = summary.systemState === 'ACTIVE_INCIDENT';
  return (
    <section
      aria-label="Security status"
      className={`flex flex-col gap-4 rounded-card border px-5 py-4 sm:flex-row sm:items-center sm:justify-between ${
        active ? 'border-critical/30 bg-critical/5' : 'border-success/25 bg-success/5'
      }`}
    >
      <div className="flex items-start gap-3">
        <Icon name={active ? 'alert' : 'shieldCheck'} className={`mt-0.5 size-6 ${active ? 'text-critical' : 'text-success'}`} />
        <div>
          <p className={`text-heading font-semibold tracking-wide ${active ? 'text-critical' : 'text-success'}`}>
            {active ? 'ACTIVE SECURITY INCIDENT' : 'SYSTEM PROTECTED'}
          </p>
          {active ? (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-body text-fg-secondary">
              <li>{pluralize(summary.openIncidents, 'open incident')}{summary.criticalIncidents ? ` (${summary.criticalIncidents} critical)` : ''}</li>
              <li><span className="font-medium text-fg tabular">{summary.frozenUsers}</span> {summary.frozenUsers === 1 ? 'user' : 'users'} contained</li>
              <li><span className="font-medium text-fg tabular">{summary.quarantinedFiles}</span> {summary.quarantinedFiles === 1 ? 'file' : 'files'} quarantined</li>
              <li>Investigation required</li>
            </ul>
          ) : (
            <p className="mt-0.5 text-body text-fg-secondary">No open security incidents.</p>
          )}
        </div>
      </div>
      {active && <Button variant="primary" to="/admin/incidents">View incidents</Button>}
    </section>
  );
}

function Stat({ label, value, detail, to, tone }) {
  const body = (
    <>
      <dt className="text-meta text-fg-muted">{label}</dt>
      <dd className={`mt-1 text-title font-semibold tabular ${tone && value > 0 ? tone : 'text-fg'}`}>{value}</dd>
      {detail && <dd className="text-meta text-fg-muted">{detail}</dd>}
    </>
  );
  return to
    ? <Link to={to} className="block bg-surface px-4 py-3 transition-colors hover:bg-surface-hover">{body}</Link>
    : <div className="bg-surface px-4 py-3">{body}</div>;
}

// Spec §20 summary cards, in one strip (1px gaps over the border colour draw the dividers).
function SummaryCards({ summary }) {
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line-subtle bg-line-subtle sm:grid-cols-4 xl:grid-cols-8">
      <Stat label="Critical incidents" value={summary.criticalIncidents} to="/admin/incidents" tone="text-critical" />
      <Stat label="High-risk incidents" value={summary.highRiskIncidents} to="/admin/incidents" tone="text-danger" />
      <Stat label="Quarantined files" value={summary.quarantinedFiles} to="/admin/quarantine" tone="text-critical" />
      <Stat label="Suspicious users" value={summary.suspiciousUsers} detail="last 24 h or open incident" to="/admin/users" tone="text-warning" />
      <Stat label="Safe users" value={summary.safeUsers} to="/admin/users" />
      <Stat label="Total users" value={summary.totalUsers} detail={`${summary.frozenUsers} frozen`} to="/admin/users" />
      <Stat label="Total files" value={summary.totalFiles} to="/admin/files" />
      <Stat label="Active sessions" value={summary.activeSessions} />
    </dl>
  );
}

function RiskOverTime() {
  // A fixed window ending now; recomputed on every refetch.
  const timeline = useAsync(() => {
    const to = new Date();
    const from = new Date(to.getTime() - TIMELINE_MINUTES * 60_000);
    return adminApi.riskTimeline({ from: from.toISOString(), to: to.toISOString(), bucket: '1m' });
  }, []);
  useLiveRefresh('risk.updated', timeline.reload, { delay: 800 });

  const state = useMemo(() => ({ ...timeline, empty: timeline.data?.data?.length === 0 }), [timeline]);
  return (
    <Panel
      title="Risk over time"
      description={`Highest stored risk score per minute, last ${TIMELINE_MINUTES} minutes. Dashed lines are the configured severity bands.`}
      actions={<Button size="sm" variant="ghost" to="/admin/analytics">Analytics</Button>}
    >
      <ChartState
        state={state}
        height={240}
        emptyTitle="No elevated risk in the last hour"
        emptyDescription="Evaluations are stored from Suspicious upwards. Everything in this window scored Safe, or nothing happened."
      >
        {timeline.data && <RiskTimelineChart points={timeline.data.data} meta={timeline.data.meta} />}
      </ChartState>
    </Panel>
  );
}

function ActiveIncidents() {
  const navigate = useNavigate();
  const incidents = useAsync(() => adminApi.incidents({ status: 'ACTIVE', limit: 8 }), []);
  useLiveRefresh(['incident.created', 'incident.updated', 'incident.resolved'], incidents.reload);

  return (
    <Panel title="Active incidents" actions={<Button size="sm" variant="ghost" to="/admin/incidents">All incidents</Button>}>
      {incidents.status === 'loading' && <div className="px-4"><SkeletonRows rows={3} columns={3} label="Loading incidents" /></div>}
      {incidents.status === 'error' && <ErrorState compact title="Unable to load incidents" error={incidents.error} onRetry={incidents.reload} />}
      {incidents.status === 'success' && (incidents.data.data.length === 0 ? (
        <EmptyState
          compact
          icon="shieldCheck"
          title="No active incidents"
          description="When a user's file activity reaches HIGH risk, an incident opens here. At CRITICAL the account is frozen and the affected files are quarantined automatically."
        />
      ) : (
        <ul className="divide-y divide-line-subtle">
          {incidents.data.data.map((incident) => (
            <li key={incident.id}>
              <button
                type="button"
                onClick={() => navigate(`/admin/incidents/${incident.id}`)}
                className="flex w-full cursor-pointer flex-col gap-1.5 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={incident.severity} />
                  <span className="font-mono text-tech text-fg">{incident.incidentNumber}</span>
                  <IncidentStatusBadge status={incident.status} />
                  <span className="ml-auto font-mono text-tech text-fg tabular">{incident.riskScore}<span className="text-fg-muted">/100</span></span>
                </span>
                <span className="truncate text-meta text-fg-secondary">
                  {incident.user?.email} · {incident.trigger} · {pluralize(incident.affectedFileCount, 'file')}
                </span>
                <time dateTime={incident.createdAt} title={formatDateTime(incident.createdAt)} className="text-meta text-fg-muted">
                  Opened {formatRelative(incident.createdAt)}
                </time>
              </button>
            </li>
          ))}
        </ul>
      ))}
    </Panel>
  );
}

export default function AdminOverview() {
  const summary = useAsync(() => adminApi.summary(), []);
  const ml = useAsync(() => adminApi.mlStatus(), []);
  useLiveRefresh(SECURITY_EVENTS, summary.reload, { delay: 600 });

  return (
    <>
      <PageHeader title="Admin overview" description="Current security state, the numbers behind it, and what is happening now." />

      <div className="flex flex-col gap-6">
        {summary.status === 'loading' && (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}
        {summary.status === 'error' && <Panel><ErrorState title="Unable to load the security summary" error={summary.error} onRetry={summary.reload} /></Panel>}
        {summary.status === 'success' && (
          <>
            <SecurityStatus summary={summary.data} />
            <SummaryCards summary={summary.data} />
          </>
        )}

        <RiskOverTime />

        <Panel title="Auxiliary anomaly service" description="Deterministic detection and containment continue unchanged if this service is unavailable.">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-body">
            {ml.status === 'loading' && <Skeleton className="h-6 w-40" />}
            {ml.status === 'error' && <span className="text-fg-muted">Status unavailable</span>}
            {ml.status === 'success' && (
              <>
                <Badge tone={ml.data.available ? 'success' : 'neutral'}>{ml.data.status}</Badge>
                <span className="text-fg-secondary">
                  {ml.data.available
                    ? `Isolation Forest ${ml.data.modelVersion} · trained on simulated (synthetic) normal activity`
                    : ml.data.status === 'DISABLED' ? 'ML integration is disabled.' : 'ML service unavailable — deterministic detection unaffected.'}
                </span>
              </>
            )}
          </div>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Panel title="Live activity" actions={<Button size="sm" variant="ghost" to="/admin/users">Users</Button>}>
            <LiveFeed limit={25} />
          </Panel>
          <ActiveIncidents />
        </div>

        <Panel title="Shield AI" description="Investigate incidents and explain stored evidence through controlled server-side tools.">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="flex items-center gap-2 text-body text-fg-secondary"><Icon name="message" className="size-4" />Actions require administrator confirmation.</p>
            <Button to="/admin/shield-ai" variant="primary" icon="message">Open Shield AI</Button>
          </div>
        </Panel>
      </div>
    </>
  );
}
