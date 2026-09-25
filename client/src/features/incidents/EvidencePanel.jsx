import { Panel } from '../../components/ui/Layout.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { adminApi } from '../../services/admin.service.js';
import { formatBytes, formatTime, pluralize, shortHash } from '../../utils/format.js';

const CANARY_VERB = { MODIFY: 'modified', RENAME: 'renamed', MOVE: 'moved', DELETE: 'deleted' };

function Section({ title, count, children }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-meta font-medium text-fg-secondary">
        {title} <span className="text-fg-muted tabular">({count})</span>
      </h3>
      {children}
    </section>
  );
}

const rowClass = 'grid grid-cols-[4.5rem_1fr] gap-x-3 py-1 text-body';

// What the user's activity in the incident window actually was (skill §23 Evidence):
// renames old → new, content changes with hashes, deletions, and canary events.
export function EvidencePanel({ incident }) {
  const to = new Date(new Date(incident.windowEnd ?? incident.windowStart).getTime() + 1000).toISOString();
  const activity = useAsync(
    () => adminApi.userActivity(incident.user.id, { from: incident.windowStart, to }),
    [incident.id, incident.windowStart, incident.windowEnd],
  );

  let body;
  if (activity.status === 'loading') body = <SkeletonRows rows={4} columns={2} label="Loading evidence" />;
  else if (activity.status === 'error') body = <ErrorState compact title="Evidence unavailable" error={activity.error} onRetry={activity.reload} />;
  else {
    const events = activity.data;
    const renames = events.filter((event) => event.action === 'RENAME' && !event.metadata?.canaryReset);
    const modifies = events.filter((event) => event.action === 'MODIFY');
    const deletes = events.filter((event) => event.action === 'DELETE');
    const canaries = events.filter((event) => event.action === 'CANARY_TRIGGER');
    if (!renames.length && !modifies.length && !deletes.length && !canaries.length) {
      body = <EmptyState compact title="No file changes recorded in the window" />;
    } else {
      body = (
        <div className="flex flex-col gap-5 px-4 py-4">
          {canaries.length > 0 && (
            <Section title="Canary events" count={canaries.length}>
              <ul>
                {canaries.map((event) => (
                  <li key={event.id} className={rowClass}>
                    <span className="font-mono text-tech text-fg-secondary">{formatTime(event.timestamp)}</span>
                    <span className="text-critical">
                      Canary <span className="font-medium">{event.metadata?.fileName}</span> {CANARY_VERB[event.metadata?.triggeringAction] ?? 'touched'}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {renames.length > 0 && (
            <Section title="Renames" count={renames.length}>
              <ul>
                {renames.map((event) => (
                  <li key={event.id} className={rowClass}>
                    <span className="font-mono text-tech text-fg-secondary">{formatTime(event.timestamp)}</span>
                    <span className="min-w-0 break-all">
                      {event.nameBefore} <span className="text-fg-muted">→</span> <span className="text-fg">{event.nameAfter}</span>
                      {event.isCanary && <span className="text-meta text-critical"> (canary)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {modifies.length > 0 && (
            <Section title="Content changes (SHA-256)" count={modifies.length}>
              <ul>
                {modifies.map((event) => (
                  <li key={event.id} className={rowClass}>
                    <span className="font-mono text-tech text-fg-secondary">{formatTime(event.timestamp)}</span>
                    <span className="min-w-0">
                      <span className="break-all text-fg">{event.metadata?.fileName}</span>
                      {event.isCanary && <span className="text-meta text-critical"> (canary)</span>}
                      <span className="block font-mono text-meta text-fg-muted">
                        {shortHash(event.hashBefore, 8, 4)} → {shortHash(event.hashAfter, 8, 4)} · {formatBytes(event.sizeBefore)} → {formatBytes(event.sizeAfter)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {deletes.length > 0 && (
            <Section title="Deletions" count={deletes.length}>
              <ul>
                {deletes.map((event) => (
                  <li key={event.id} className={rowClass}>
                    <span className="font-mono text-tech text-fg-secondary">{formatTime(event.timestamp)}</span>
                    <span className="break-all">{event.nameBefore ?? event.metadata?.fileName}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      );
    }
  }

  return (
    <Panel
      title="Evidence"
      description={activity.status === 'success' ? `${pluralize(activity.data.length, 'event')} recorded for this user in the incident window` : undefined}
    >
      {body}
    </Panel>
  );
}
