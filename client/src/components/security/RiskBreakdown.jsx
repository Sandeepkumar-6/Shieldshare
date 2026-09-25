import { Badge } from '../ui/Badge.jsx';
import { Icon } from '../ui/Icon.jsx';
import { formatScore } from './RiskScore.jsx';

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// Observed value and threshold per signal, in words.
function describe(signal) {
  const o = signal.observed ?? {};
  const t = signal.threshold ?? {};
  switch (signal.key) {
    case 'rapidActivity':
      return [plural(o.operations, 'operation'), `${t.operations} operations`];
    case 'massModification':
    case 'massRename':
    case 'massDelete':
      return [plural(o.files, 'file'), `${t.files} files`];
    case 'directorySpread':
      return [plural(o.folders, 'folder'), `${t.folders} folders`];
    case 'extensionChanges':
      return [
        `${plural(o.files, 'file')} changed${o.sameExtension ? `, ${o.sameExtension} to ${o.extension}` : ''}`,
        `${t.files} files, or ${t.sameExtension} to one extension`,
      ];
    case 'hashChangeRatio':
      return [
        `${o.changedFiles} of ${plural(o.touchedFiles, 'touched file')} (${Math.round((o.ratio ?? 0) * 100)}%)`,
        `scored only with mass modification (${t.gateMet ? 'met' : 'not met'})`,
      ];
    case 'entropyChange':
      if (!o.enabled) return ['Not enabled', `Previous entropy < ${t.baselineMax}; increase ≥ ${t.deltaMin}`];
      return [
        `${o.qualifyingFiles} of ${plural(o.modifiedFiles, 'modified file')} (${Math.round((o.ratio ?? 0) * 100)}%)`,
        `Previous entropy < ${t.baselineMax}; increase ≥ ${t.deltaMin}`,
      ];
    case 'canaryTrigger':
      return [o.canaryFiles ? plural(o.canaryFiles, 'canary file') : 'none', 'any canary'];
    default:
      return ['—', '—'];
  }
}

const LEVEL = {
  full: <Badge tone="neutral">Full</Badge>,
  partial: <Badge tone="neutral">Partial</Badge>,
  none: <span className="text-meta text-fg-muted">Not met</span>,
};

const CATEGORY = {
  BEHAVIOR: 'Behavior', INTEGRITY: 'Integrity', CONTENT: 'Content', DECEPTION: 'Deception', ANOMALY: 'Anomaly',
};

// The stored breakdown behind a score (spec §16 "Explainability"): every signal with what was
// observed, the threshold and the points it added. Entropy and ML are shown as "not enabled",
// not hidden.
export function RiskBreakdown({ evaluation }) {
  const rows = evaluation.signals.filter((signal) => signal.key !== 'mlAnomaly').sort((a, b) => b.points - a.points);
  const entropy = evaluation.signals.find((signal) => signal.key === 'entropyChange');
  const mlSignal = evaluation.signals.find((signal) => signal.key === 'mlAnomaly');

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-body">
          <caption className="sr-only">Contributing signals</caption>
          <thead className="border-b border-line-subtle">
            <tr className="text-left text-meta text-fg-muted">
              <th scope="col" className="py-2 pr-4 font-medium">Signal</th>
              <th scope="col" className="py-2 pr-4 font-medium">Observed</th>
              <th scope="col" className="py-2 pr-4 font-medium">Threshold</th>
              <th scope="col" className="py-2 pr-4 font-medium">Level</th>
              <th scope="col" className="py-2 text-right font-medium">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((signal) => {
              const [observed, threshold] = describe(signal);
              const contributes = signal.points > 0;
              return (
                <tr key={signal.key} className={contributes ? '' : 'text-fg-muted'}>
                  <td className="py-2 pr-4">
                    <p className={contributes ? 'font-medium text-fg' : ''}>{signal.label}</p>
                    <p className="text-meta text-fg-muted">{CATEGORY[signal.category]}</p>
                  </td>
                  <td className="py-2 pr-4">{observed}</td>
                  <td className="py-2 pr-4 text-fg-secondary">{threshold}</td>
                  <td className="py-2 pr-4">{LEVEL[signal.level]}</td>
                  <td className="py-2 text-right font-mono text-tech tabular">
                    {contributes ? <span className="text-fg">+{formatScore(signal.points)}</span> : '0'}
                    <span className="text-fg-muted"> / {signal.maxPoints}</span>
                  </td>
                </tr>
              );
            })}
            <tr className="text-fg-muted">
              <td className="py-2 pr-4">
                <p>ML anomaly</p>
                <p className="text-meta">Anomaly</p>
              </td>
              <td className="py-2 pr-4" colSpan={3}>
                {evaluation.ml?.status === 'OK'
                  ? `Anomaly score ${evaluation.ml.anomalyScore} · model ${evaluation.ml.modelVersion}. Trained on simulated (synthetic) normal activity.`
                  : evaluation.ml?.status === 'UNAVAILABLE'
                    ? 'ML service unavailable — deterministic detection unaffected.'
                    : 'ML anomaly scoring is disabled.'}
              </td>
              <td className="py-2 text-right font-mono text-tech">
                {mlSignal?.points > 0 ? `+${formatScore(mlSignal.points)}` : '0'}
                {mlSignal?.maxPoints != null && <span className="text-fg-muted"> / {mlSignal.maxPoints}</span>}
              </td>
            </tr>
          </tbody>
          <tfoot className="border-t border-line">
            <tr>
              <th scope="row" colSpan={4} className="py-2 pr-4 text-left text-meta font-medium text-fg-secondary">
                Sum of signals · {evaluation.categories.length} categor{evaluation.categories.length === 1 ? 'y' : 'ies'} contributed
                {evaluation.categories.length ? ` (${evaluation.categories.map((category) => CATEGORY[category]).join(', ')})` : ''}
              </th>
              <td className="py-2 text-right font-mono text-tech text-fg tabular">{formatScore(evaluation.rawScore)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {entropy?.observed?.files?.length > 0 && (
        <div className="overflow-x-auto rounded-control border border-line-subtle">
          <table className="w-full min-w-[36rem] border-collapse text-body">
            <caption className="px-3 py-2 text-left text-meta font-medium text-fg-secondary">Entropy evidence by modified file</caption>
            <thead className="border-y border-line-subtle text-left text-meta text-fg-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">File</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Before</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">After</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
                <th scope="col" className="px-3 py-2 font-medium">Evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {entropy.observed.files.map((file) => (
                <tr key={file.fileId}>
                  <td className="max-w-64 break-all px-3 py-2 text-fg">{file.name ?? file.fileId}</td>
                  <td className="px-3 py-2 text-right font-mono text-tech">{file.before.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-tech">{file.after.toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-tech">{file.delta > 0 ? '+' : ''}{file.delta.toFixed(1)}</td>
                  <td className="px-3 py-2">
                    {file.qualifies
                      ? <Badge tone="warning">Qualifies</Badge>
                      : file.highBaseline
                        ? <span className="text-meta text-fg-muted">High baseline (compressed) · low evidence</span>
                        : <span className="text-meta text-fg-muted">Below change threshold</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {evaluation.reasons?.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {evaluation.reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-2 text-meta text-fg-secondary">
              <Icon name="info" className="mt-0.5 size-3.5 text-info" />
              {reason}
            </li>
          ))}
        </ul>
      )}
      <p className="text-meta text-fg-muted">
        Evaluation from config v{evaluation.configVersion}, {evaluation.phase === 'INLINE' ? 'scored inline with the request' : 'rescored with ML'}.
        Score = min(100, sum), then the multi-signal gate. No single signal is proof of ransomware.
      </p>
    </div>
  );
}
