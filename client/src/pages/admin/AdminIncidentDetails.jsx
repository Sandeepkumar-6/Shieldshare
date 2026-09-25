import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { IncidentTimeline } from '../../components/security/IncidentTimeline.jsx';
import { RiskBreakdown } from '../../components/security/RiskBreakdown.jsx';
import { RiskScore } from '../../components/security/RiskScore.jsx';
import {
  ACTIVE_INCIDENT_STATUSES,
  IncidentStatusBadge,
  SeverityBadge,
} from '../../components/security/SecurityBadges.jsx';
import { AccountStatusBadge, Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Checkbox, Textarea } from '../../components/ui/Field.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { DetailList, PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Skeleton, SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { FilterTabs } from '../../components/ui/FilterTabs.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { EvidencePanel } from '../../features/incidents/EvidencePanel.jsx';
import { RecoveryFileList, useRecoveryActions } from '../../features/incidents/recovery.jsx';
import { ShieldAIWorkspace } from '../../features/shieldai/ShieldAIWorkspace.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useWriteAccess } from '../../hooks/useWriteAccess.js';
import { adminApi } from '../../services/admin.service.js';
import { useLiveRefresh } from '../../state/SocketContext.jsx';
import { formatDateTime, formatTime, pluralize } from '../../utils/format.js';

// Events that change what this page shows, for this incident only (spec §19).
const INCIDENT_EVENTS = ['incident.updated', 'incident.resolved', 'recovery.completed', 'file.quarantined', 'risk.updated', 'canary.triggered'];

const FREEZE_TEXT = { NONE: 'Not frozen', FROZEN: 'Frozen', UNFROZEN: 'Unfrozen' };
const QUARANTINE_TEXT = {
  NONE: 'Nothing quarantined',
  PARTIAL: 'Partly quarantined',
  QUARANTINED: 'All affected files quarantined',
  RELEASED: 'Released without restore',
  RESTORED: 'Restored',
};

function RiskPanel({ incidentId, refreshKey }) {
  const [which, setWhich] = useState('peak');
  const risk = useAsync(() => adminApi.incidentRisk(incidentId), [incidentId, refreshKey]);
  const evaluation = risk.data?.[which] ?? risk.data?.peak;

  return (
    <Panel
      title="Risk"
      description="The stored evaluation behind the score. Nothing here is estimated after the fact."
      actions={risk.status === 'success' && risk.data.latest && risk.data.latest.id !== risk.data.peak?.id && (
        <FilterTabs label="Evaluation" options={[{ value: 'peak', label: 'Peak' }, { value: 'latest', label: 'Latest' }]} value={which} onChange={setWhich} />
      )}
    >
      <div className="flex flex-col gap-5 px-4 py-4">
        {risk.status === 'loading' && <SkeletonRows rows={4} columns={4} label="Loading risk" />}
        {risk.status === 'error' && <ErrorState compact title="Risk evaluation unavailable" error={risk.error} onRetry={risk.reload} />}
        {risk.status === 'success' && evaluation && (
          <>
            <RiskScore evaluation={evaluation} label={`${which === 'peak' ? 'Peak' : 'Latest'} risk score · ${formatDateTime(evaluation.createdAt)}`} />
            {evaluation.capApplied && (
              <p className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning/5 px-3 py-2 text-body text-fg-secondary">
                <Icon name="alert" className="mt-0.5 size-4 text-warning" />
                Single-category cap applied: one kind of evidence alone can&apos;t make an incident CRITICAL.
              </p>
            )}
            <RiskBreakdown evaluation={evaluation} />
          </>
        )}
      </div>
    </Panel>
  );
}

export default function AdminIncidentDetails() {
  const { id } = useParams();
  const toast = useToast();
  const access = useWriteAccess();
  const incident = useAsync(() => adminApi.incident(id), [id]);
  const files = useAsync(() => adminApi.incidentFiles(id), [id]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [dialog, setDialog] = useState(null); // 'investigate' | 'resolve' | 'falsePositive' | 'unfreeze'
  const [note, setNote] = useState('');
  const [unfreezeToo, setUnfreezeToo] = useState(true);

  const refresh = () => {
    incident.reload();
    files.reload();
    setRefreshKey((key) => key + 1);
  };
  // Live: status, risk, quarantine and recovery changes of this incident, and freeze changes of
  // its user; also a full refetch after a reconnect.
  const subjectId = incident.data?.user?.id;
  useLiveRefresh(INCIDENT_EVENTS, refresh, { filter: (data) => data?.incidentId === id });
  useLiveRefresh(['user.frozen', 'user.unfrozen'], refresh, { filter: (data) => Boolean(subjectId) && data?.userId === subjectId });
  const recovery = useRecoveryActions({ onDone: refresh });
  const open = (name) => {
    setNote('');
    setUnfreezeToo(true);
    setDialog(name);
  };

  if (incident.status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <span className="sr-only">Loading incident</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (incident.status === 'error') {
    return incident.error?.status === 404
      ? <EmptyState icon="incident" title="Incident not found" action={<Button to="/admin/incidents" icon="arrowLeft">Back to incidents</Button>} />
      : <ErrorState title="Unable to load this incident" error={incident.error} onRetry={incident.reload} />;
  }

  const current = incident.data;
  const active = ACTIVE_INCIDENT_STATUSES.includes(current.status);
  const fileList = files.data ?? [];
  const awaiting = fileList.filter((entry) => entry.state === 'AWAITING').length;
  const userFrozen = current.user && current.freezeStatus === 'FROZEN';
  const reason = access.reason;

  return (
    <>
      <PageHeader
        breadcrumb={(
          <span className="flex items-center gap-1">
            <Link to="/admin/incidents" className="hover:text-fg">Incidents</Link>
            <Icon name="chevronRight" className="size-3" />
            <span className="font-mono">{current.incidentNumber}</span>
          </span>
        )}
        title={<span className="font-mono">{current.incidentNumber}</span>}
        meta={(
          <>
            <SeverityBadge severity={current.severity} />
            <IncidentStatusBadge status={current.status} />
            <span>Risk <span className="font-mono text-fg tabular">{current.riskScore}</span> / 100</span>
            <span>{current.user?.email}</span>
            <span>Started {formatDateTime(current.windowStart)}</span>
          </>
        )}
        actions={(
          <>
            {['OPEN', 'CONTAINED'].includes(current.status) && (
              <Button icon="eye" disabledReason={reason} onClick={() => open('investigate')}>Start investigation</Button>
            )}
            {active && awaiting > 0 && (
              <Button variant="primary" icon="restore" disabledReason={reason} onClick={() => recovery.openRestoreAll(current, fileList)}>
                Restore all ({awaiting})
              </Button>
            )}
            {userFrozen && current.status !== 'RECOVERED' && (
              <Button icon="unlock" disabledReason={reason} onClick={() => open('unfreeze')}>Unfreeze user</Button>
            )}
            {current.status === 'RECOVERED' && (
              <Button variant="primary" icon="checkCircle" disabledReason={reason} onClick={() => open('resolve')}>Resolve</Button>
            )}
            {active && (
              <Button variant="danger-ghost" disabledReason={reason} onClick={() => open('falsePositive')}>Mark false positive</Button>
            )}
          </>
        )}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Summary">
            <DetailList
              items={[
                { label: 'User', value: current.user ? <>{current.user.name} <span className="text-fg-muted">· {current.user.email}</span></> : 'Unknown' },
                { label: 'Trigger', value: current.trigger ?? '—' },
                { label: 'Window', value: `${formatDateTime(current.windowStart)} → ${current.windowEnd ? formatTime(current.windowEnd) : '—'}` },
                { label: 'Affected files', value: `${pluralize(current.affectedFileCount, 'file')} in ${pluralize(current.affectedDirectories.length, 'folder')} (${current.affectedDirectories.map((folder) => folder.name).join(', ') || '—'})` },
                { label: 'Canary', value: current.canaryTriggered ? <Badge tone="critical" dot>Triggered</Badge> : 'Not triggered' },
                { label: 'Investigating', value: current.assignedTo?.name ?? '—' },
                current.resolution && { label: 'Resolution', value: <>{current.resolution === 'FALSE_POSITIVE' ? 'False positive' : 'Resolved'} by {current.resolvedBy?.name ?? 'an administrator'}: “{current.resolutionNote}”</> },
              ]}
            />
          </Panel>

          <RiskPanel incidentId={current.id} refreshKey={refreshKey} />

          <EvidencePanel incident={current} />

          <Panel
            title="Recovery"
            description="Each affected file goes back to its last version from before the incident window (spec §8), as a new, verified version."
            actions={active && awaiting > 0 && (
              <Button size="sm" variant="primary" icon="restore" disabledReason={reason} onClick={() => recovery.openRestoreAll(current, fileList)}>
                Restore all
              </Button>
            )}
          >
            <div className="px-4">
              {files.status === 'loading' && <SkeletonRows rows={3} columns={3} label="Loading affected files" />}
              {files.status === 'error' && <ErrorState compact title="Affected files unavailable" error={files.error} onRetry={files.reload} />}
              {files.status === 'success' && (fileList.length === 0
                ? <EmptyState compact title="No affected files" />
                : <RecoveryFileList files={fileList} canRestore={active} restoreReason={reason} onRestore={recovery.openRestore} />)}
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Response">
            <DetailList
              items={[
                { label: 'Account', value: <>{FREEZE_TEXT[current.freezeStatus]}{current.user?.status && <span className="ml-2"><AccountStatusBadge status={current.user.status} /></span>}</> },
                { label: 'Files', value: QUARANTINE_TEXT[current.quarantineStatus] },
                { label: 'Status', value: <IncidentStatusBadge status={current.status} /> },
              ]}
            />
          </Panel>
          <Panel title="Timeline">
            <div className="px-4 py-4">
              <IncidentTimeline entries={current.timeline} />
            </div>
          </Panel>
          <Panel title="Ask Shield AI" description={`Context: ${current.incidentNumber}. Facts are retrieved through server-side tools.`}>
            <div className="p-4"><ShieldAIWorkspace compact context={{ incidentId: current.id }} /></div>
          </Panel>
        </div>
      </div>

      {recovery.dialogs}

      <ConfirmDialog
        open={dialog === 'investigate'}
        onClose={() => setDialog(null)}
        title={`Start investigating ${current.incidentNumber}?`}
        confirmLabel="Start investigation"
        onConfirm={async () => {
          await adminApi.investigate(current.id);
          toast.success('Investigation started', `${current.incidentNumber} is assigned to you`);
          refresh();
        }}
      >
        <p className="text-body text-fg-secondary">
          The incident moves to Investigating and is assigned to you. Containment stays in place: the account stays
          frozen and the files stay quarantined until you restore, resolve or mark it as a false positive.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'unfreeze'}
        onClose={() => setDialog(null)}
        title={`Unfreeze ${current.user?.name ?? 'this user'}?`}
        confirmLabel="Unfreeze account"
        confirmDisabled={!note.trim()}
        onConfirm={async () => {
          await adminApi.unfreeze(current.user.id, { reason: note.trim() });
          toast.success('Account unfrozen', current.user.email);
          refresh();
        }}
      >
        <p className="text-body text-fg-secondary">
          {current.user?.name} can upload, change and share files again. Quarantined files stay quarantined and the
          incident stays {current.status.toLowerCase()}. New activity keeps being scored.
        </p>
        <Textarea data-autofocus label="Reason (required, recorded in the audit log and the timeline)" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'resolve'}
        onClose={() => setDialog(null)}
        title={`Resolve ${current.incidentNumber}?`}
        confirmLabel="Resolve incident"
        confirmDisabled={!note.trim()}
        onConfirm={async () => {
          await adminApi.resolve(current.id, { resolution: 'RESOLVED', note: note.trim(), unfreezeUser: userFrozen && unfreezeToo });
          toast.success(`${current.incidentNumber} resolved`);
          refresh();
        }}
      >
        <p className="text-body text-fg-secondary">
          The incident is closed as Resolved. Restored files stay as they are; files without a safe version stay
          quarantined. The user&apos;s next writes start a fresh detection window.
        </p>
        <Textarea data-autofocus label="Resolution note (required)" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
        {userFrozen && (
          <Checkbox
            label={`Also unfreeze ${current.user?.name}`}
            hint="Leave unticked to keep the account read-only after closing the incident."
            checked={unfreezeToo}
            onChange={(event) => setUnfreezeToo(event.target.checked)}
          />
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === 'falsePositive'}
        onClose={() => setDialog(null)}
        tone="danger"
        title={`Mark ${current.incidentNumber} as a false positive?`}
        confirmLabel="Mark false positive"
        confirmDisabled={!note.trim()}
        onConfirm={async () => {
          await adminApi.resolve(current.id, { resolution: 'FALSE_POSITIVE', note: note.trim() });
          toast.success(`${current.incidentNumber} closed as a false positive`);
          refresh();
        }}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-fg-secondary">
          <li>{current.user?.name ?? 'The user'} is unfrozen.</li>
          <li>Quarantined files are released as they are now, without restoring; files deleted during the window stay deleted.</li>
          <li>Versions from the window return to Safe; share links paused by the incident come back if they haven&apos;t expired.</li>
          <li>The incident closes as False positive. This can&apos;t be undone.</li>
        </ul>
        <Textarea data-autofocus label="Why is this legitimate? (required)" value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} />
      </ConfirmDialog>
    </>
  );
}
