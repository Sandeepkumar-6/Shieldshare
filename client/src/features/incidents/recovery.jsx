import { useState } from 'react';
import { AdminFileStatusBadge, Badge, VersionStatusBadge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { adminApi } from '../../services/admin.service.js';
import { formatDateTime, pluralize } from '../../utils/format.js';

const STATE = {
  AWAITING: { tone: 'warning', label: 'Awaiting recovery' },
  RESTORED: { tone: 'success', label: 'Restored' },
  NO_SAFE_VERSION: { tone: 'neutral', label: 'No safe version' },
  RELEASED: { tone: 'neutral', label: 'Released' },
};

export function RecoveryStateBadge({ state }) {
  const entry = STATE[state] ?? { tone: 'neutral', label: state };
  return <Badge tone={entry.tone} dot>{entry.label}</Badge>;
}

// One row per affected file: what happened in the window, the proposed safe version, and
// where recovery stands.
export function RecoveryFileList({ files, canRestore, restoreReason, onRestore }) {
  return (
    <ul className="divide-y divide-line-subtle">
      {files.map((entry) => (
        <li key={entry.file.id} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-medium text-fg" title={entry.file.name}>{entry.file.name}</p>
              <AdminFileStatusBadge status={entry.file.status} />
              <RecoveryStateBadge state={entry.state} />
            </div>
            <dl className="mt-2 grid gap-x-4 gap-y-1 text-meta sm:grid-cols-[8.5rem_1fr]">
              <dt className="text-fg-muted">Written in window</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {entry.windowVersions.length === 0
                  ? <span className="text-fg-secondary">No new content (renamed, moved or deleted only)</span>
                  : entry.windowVersions.map((version) => (
                    <span key={version.id} className="inline-flex items-center gap-1.5">
                      <span className="font-mono text-tech text-fg-secondary">v{version.versionNumber}</span>
                      <VersionStatusBadge status={version.securityStatus} />
                    </span>
                  ))}
              </dd>
              <dt className="text-fg-muted">{entry.state === 'RESTORED' ? 'Restored to' : 'Proposed safe version'}</dt>
              <dd className="text-fg-secondary">
                {entry.state === 'RESTORED' && entry.restoredVersion ? (
                  <>
                    <span className="font-mono text-tech">v{entry.restoredVersion.versionNumber}</span> · {entry.restoredVersion.nameAtVersion}
                    {' '}(copy of v{entry.restoredVersion.restoredFromVersion}, SHA-256 verified)
                  </>
                ) : entry.proposedSafeVersion ? (
                  <>
                    <span className="font-mono text-tech">v{entry.proposedSafeVersion.versionNumber}</span> · {entry.proposedSafeVersion.nameAtVersion}
                    {' '}· {formatDateTime(entry.proposedSafeVersion.createdAt)}
                  </>
                ) : (
                  'None: every version was created during the incident. The file stays quarantined as evidence.'
                )}
              </dd>
            </dl>
          </div>
          {entry.state === 'AWAITING' && canRestore && (
            <Button size="sm" icon="restore" disabledReason={restoreReason} onClick={() => onRestore(entry)}>
              Restore
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Restore one file, or every awaiting file of an incident, with confirmations that state the
// consequence (spec §17: the dialog shows current version → target version, including names).
export function useRecoveryActions({ onDone }) {
  const toast = useToast();
  const [single, setSingle] = useState(null);   // file entry
  const [all, setAll] = useState(null);         // { incident, files }

  const dialogs = (
    <>
      <ConfirmDialog
        open={Boolean(single)}
        onClose={() => setSingle(null)}
        title={single ? `Restore ${single.file.name}?` : 'Restore file'}
        confirmLabel="Restore version"
        onConfirm={async () => {
          const result = await adminApi.restoreFile(single.file.id, single.proposedSafeVersion.id);
          toast.success(
            `${result.file.name} restored as v${result.newVersion.versionNumber}`,
            `SHA-256 verified${result.reactivatedLinks ? ` · ${pluralize(result.reactivatedLinks, 'share link')} reactivated` : ''}`
              + `${result.incidentStatus === 'RECOVERED' ? ' · incident recovered' : ''}`,
          );
          onDone?.();
        }}
      >
        {single && (
          <>
            <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 rounded-control border border-line-subtle bg-bg-secondary px-3.5 py-3">
              <dt className="text-meta text-fg-muted">Current</dt>
              <dd className="min-w-0 text-body break-all text-fg">
                <span className="font-mono text-tech text-fg-secondary">v{single.file.currentVersion}</span> · {single.file.name}
              </dd>
              <dt className="text-meta text-fg-muted">Restore to</dt>
              <dd className="min-w-0 text-body break-all text-fg">
                <span className="font-mono text-tech text-accent">v{single.proposedSafeVersion.versionNumber}</span> · {single.proposedSafeVersion.nameAtVersion}
              </dd>
            </dl>
            <p className="text-body text-fg-secondary">
              ShieldShare copies v{single.proposedSafeVersion.versionNumber}, the last version from before the incident, into a
              new v{single.file.currentVersion + 1}
              {single.proposedSafeVersion.nameAtVersion !== single.file.name && <>, renames the file back to <span className="text-fg">{single.proposedSafeVersion.nameAtVersion}</span></>}
              {single.quarantine?.previousFileStatus === 'DELETED' && ', undeletes it'}
              {' '}and recomputes its SHA-256. Only if it matches does the file become active again and its paused share
              links come back. The suspicious versions stay in history as quarantined.
            </p>
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(all)}
        onClose={() => setAll(null)}
        title={all ? `Restore all files for ${all.incident.incidentNumber}?` : 'Restore all'}
        confirmLabel="Restore all"
        onConfirm={async () => {
          const { results, incidentStatus } = await adminApi.restoreAll(all.incident.id);
          const restored = results.filter((result) => result.result === 'RESTORED').length;
          const failed = results.filter((result) => result.result === 'FAILED');
          if (failed.length) {
            toast.error(`${pluralize(failed.length, 'file')} not restored`, failed.map((result) => `${result.name}: ${result.message}`).join(' · '));
          }
          toast.success(`${pluralize(restored, 'file')} restored and verified`, incidentStatus === 'RECOVERED' ? 'Incident recovered' : `Incident is ${incidentStatus.toLowerCase()}`);
          onDone?.();
        }}
      >
        {all && (() => {
          const awaiting = all.files.filter((entry) => entry.state === 'AWAITING').length;
          const noSafe = all.files.filter((entry) => entry.state === 'NO_SAFE_VERSION').length;
          return (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-fg-secondary">
              <li>{pluralize(awaiting, 'file')} restored to the last version from before the incident, each as a new version, with the original name.</li>
              <li>Each copy's SHA-256 is checked; a file that fails stays quarantined and is reported.</li>
              <li>Paused share links of restored files come back if they haven&apos;t expired.</li>
              <li>Canary decoys touched in the incident are reset from their templates.</li>
              {noSafe > 0 && <li>{pluralize(noSafe, 'file')} without a safe version stay quarantined.</li>}
              <li>When nothing is left to restore, the incident becomes Recovered.</li>
            </ul>
          );
        })()}
      </ConfirmDialog>
    </>
  );

  return {
    openRestore: setSingle,
    openRestoreAll: (incident, files) => setAll({ incident, files }),
    dialogs,
  };
}
