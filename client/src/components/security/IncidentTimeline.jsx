import { formatDate, formatTime } from '../../utils/format.js';

const TYPE_LABEL = {
  ACTIVITY_BURST: 'Activity',
  RULE_FIRED: 'Rule',
  CANARY: 'Canary',
  ML: 'ML',
  RISK: 'Risk',
  FREEZE: 'Freeze',
  QUARANTINE: 'Quarantine',
  STATUS: 'Status',
  RESTORE: 'Restore',
  VERIFY: 'Verify',
};

const TYPE_DOT = {
  CANARY: 'bg-critical',
  RISK: 'bg-danger',
  FREEZE: 'bg-warning',
  QUARANTINE: 'bg-warning',
  RESTORE: 'bg-success',
  VERIFY: 'bg-success',
};

// The incident as it happened, from the stored timeline (skill §22). Oldest first.
export function IncidentTimeline({ entries }) {
  const ordered = [...entries].sort((a, b) => new Date(a.at) - new Date(b.at));
  return (
    <ol className="relative flex flex-col" aria-label="Incident timeline">
      {ordered.map((entry, index) => (
        <li key={`${entry.at}-${index}`} className="relative grid grid-cols-[4.5rem_1rem_1fr] gap-x-2 pb-4 last:pb-0">
          <time dateTime={entry.at} title={formatDate(entry.at)} className="pt-px text-right font-mono text-tech text-fg-secondary tabular">
            {formatTime(entry.at)}
          </time>
          <span className="relative flex justify-center">
            {index < ordered.length - 1 && <span aria-hidden="true" className="absolute top-3 bottom-[-1rem] w-px bg-line" />}
            <span aria-hidden="true" className={`relative mt-1.5 size-2 rounded-full ${TYPE_DOT[entry.type] ?? 'bg-fg-muted'}`} />
          </span>
          <div className="min-w-0">
            <p className="text-body break-words text-fg">{entry.text}</p>
            <p className="text-meta text-fg-muted">
              {TYPE_LABEL[entry.type] ?? entry.type} · {entry.actor === 'ADMIN' ? (entry.admin?.name ?? 'Administrator') : 'ShieldShare'}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
