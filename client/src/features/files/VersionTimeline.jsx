import { Badge, VersionStatusBadge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { HashText } from '../../components/ui/HashText.jsx';
import { formatBytes, formatDateTime } from '../../utils/format.js';

const RESTORABLE = ['SAFE', 'RESTORED'];

export function versionSourceLabel(version) {
  if (version.source === 'UPLOAD') return 'Uploaded';
  if (version.source === 'MODIFY') return 'New content uploaded';
  if (version.source === 'RESTORE') return `Restored from v${version.restoredFromVersion}`;
  return version.source;
}

// Newest first. Every version stays in history, including restored ones (skill §19).
export function VersionTimeline({ file, versions, access, onDownload, onRestore }) {
  const underReview = file.status === 'QUARANTINED';

  return (
    <ol aria-label="Version history" className="flex flex-col">
      {versions.map((version, index) => {
        const last = index === versions.length - 1;
        const renamed = version.nameAtVersion !== file.name;
        const restorable = !version.isCurrent && RESTORABLE.includes(version.securityStatus);
        return (
          <li key={version.id} className="relative grid grid-cols-[2.75rem_1fr] gap-3 pb-4 last:pb-0">
            {!last && <span aria-hidden="true" className="absolute bottom-0 left-[1.375rem] top-11 w-px bg-line" />}
            <div
              className={`flex size-11 items-center justify-center rounded-full border font-mono text-tech ${
                version.isCurrent ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-bg-secondary text-fg-secondary'
              }`}
            >
              v{version.versionNumber}
            </div>
            <div className="min-w-0 rounded-card border border-line-subtle bg-surface px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-body font-medium text-fg">{versionSourceLabel(version)}</p>
                    {version.isCurrent && <Badge tone="accent">Current</Badge>}
                    <VersionStatusBadge status={version.securityStatus} />
                  </div>
                  <p className="mt-1 text-meta text-fg-muted">
                    <time dateTime={version.createdAt}>{formatDateTime(version.createdAt)}</time>
                    {' · '}
                    {formatBytes(version.size)}
                    {Number.isFinite(version.entropy) && <> {' · '}entropy <span className="font-mono">{version.entropy.toFixed(2)}</span> bits/byte</>}
                  </p>
                  {renamed && (
                    <p className="mt-1 text-meta break-all text-fg-secondary">
                      Named <span className="font-medium text-fg">{version.nameAtVersion}</span> at this version
                    </p>
                  )}
                  <div className="mt-2">
                    <HashText hash={version.sha256} />
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="download"
                    disabledReason={underReview ? 'This file is under review.' : null}
                    onClick={() => onDownload(version)}
                  >
                    Download
                  </Button>
                  {restorable && (
                    <Button
                      size="sm"
                      icon="restore"
                      disabledReason={access.reason ?? (underReview ? 'This file is under review.' : null)}
                      onClick={() => onRestore(version)}
                    >
                      Restore
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
