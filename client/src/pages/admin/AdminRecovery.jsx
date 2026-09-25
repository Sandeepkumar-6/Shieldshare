import { Link } from 'react-router';
import { IncidentStatusBadge, SeverityBadge } from '../../components/security/SecurityBadges.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { RecoveryFileList, useRecoveryActions } from '../../features/incidents/recovery.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useWriteAccess } from '../../hooks/useWriteAccess.js';
import { useLiveRefresh } from '../../state/SocketContext.jsx';
import { adminApi } from '../../services/admin.service.js';
import { pluralize } from '../../utils/format.js';

// Cross-file restore queue, grouped by incident (spec §28 Recovery).
export default function AdminRecovery() {
  const access = useWriteAccess();
  const groups = useAsync(() => adminApi.recovery(), []);
  useLiveRefresh(['incident.created', 'incident.updated', 'incident.resolved', 'file.quarantined', 'recovery.completed'], groups.reload);
  const recovery = useRecoveryActions({ onDone: groups.reload });

  let body;
  if (groups.status === 'loading') body = <Panel><SkeletonRows rows={4} columns={3} label="Loading recovery queue" /></Panel>;
  else if (groups.status === 'error') body = <Panel><ErrorState title="Unable to load the recovery queue" error={groups.error} onRetry={groups.reload} /></Panel>;
  else if (groups.data.length === 0) {
    body = (
      <Panel>
        <EmptyState
          icon="restore"
          title="Nothing to recover"
          description="Files from open incidents appear here with their last safe version, ready to restore."
        />
      </Panel>
    );
  } else {
    body = groups.data.map(({ incident, files }) => {
      const awaiting = files.filter((entry) => entry.state === 'AWAITING').length;
      return (
        <Panel
          key={incident.id}
          title={(
            <span className="flex flex-wrap items-center gap-2">
              <Link to={`/admin/incidents/${incident.id}`} className="font-mono hover:text-accent">{incident.incidentNumber}</Link>
              <SeverityBadge severity={incident.severity} />
              <IncidentStatusBadge status={incident.status} />
            </span>
          )}
          description={`${incident.user?.email ?? 'Unknown user'} · ${pluralize(awaiting, 'file')} awaiting recovery of ${files.length}`}
          actions={awaiting > 0 && (
            <Button size="sm" variant="primary" icon="restore" disabledReason={access.reason} onClick={() => recovery.openRestoreAll(incident, files)}>
              Restore all
            </Button>
          )}
        >
          <div className="px-4">
            <RecoveryFileList files={files} canRestore restoreReason={access.reason} onRestore={recovery.openRestore} />
          </div>
        </Panel>
      );
    });
  }

  return (
    <>
      <PageHeader
        title="Recovery"
        description="Restore affected files to their last known safe version: the newest version created before the incident started. Every restore is a new, verified version."
      />
      <div className="flex flex-col gap-6">{body}</div>
      {recovery.dialogs}
    </>
  );
}
