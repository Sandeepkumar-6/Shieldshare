import { SEVERITY_TONE, SeverityBadge } from './SecurityBadges.jsx';

const BAR = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', critical: 'bg-critical', info: 'bg-info' };

const formatScore = (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

// A risk score from a stored RiskEvaluation. Always rendered next to its breakdown: a number
// is never shown without the evidence behind it (skill §15–16).
export function RiskScore({ evaluation, label = 'Risk score' }) {
  const tone = SEVERITY_TONE[evaluation.severity] ?? 'info';
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <p className="text-meta text-fg-muted">{label}</p>
          <p className="font-semibold text-fg tabular">
            <span className="text-display">{formatScore(evaluation.score)}</span>
            <span className="text-body text-fg-muted"> / 100</span>
          </p>
        </div>
        <SeverityBadge severity={evaluation.severity} />
        {evaluation.rawScore !== evaluation.score && (
          <p className="text-meta text-fg-muted">sum of signals {formatScore(evaluation.rawScore)}</p>
        )}
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={evaluation.score}
        aria-valuetext={`${formatScore(evaluation.score)} of 100, ${evaluation.severity}`}
        className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover"
      >
        <div className={`h-full rounded-full ${BAR[tone]}`} style={{ width: `${Math.min(100, evaluation.score)}%` }} />
      </div>
    </div>
  );
}

export { formatScore };
