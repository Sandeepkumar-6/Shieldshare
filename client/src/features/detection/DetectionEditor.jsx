import { useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button.jsx';
import { Checkbox, Input } from '../../components/ui/Field.jsx';
import { Panel } from '../../components/ui/Layout.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { Notice } from '../../components/ui/States.jsx';
import { adminApi } from '../../services/admin.service.js';
import { FIELD_BY_PATH, RULES, diff, formatValue, toDraft, toPatch, validateDraft } from './configFields.js';

// Settings editor (Phase 6). Saving creates DetectionConfig version N+1 through
// PUT /api/admin/config/detection (validated server-side and audit-logged). Existing
// incidents keep the breakdown stored with their evaluations.

const APPLIES_NOTE = 'Applies to new evaluations only; existing incidents keep their stored breakdown.';

function NumberField({ path, draft, errors, onChange, label, hint, compact = false }) {
  const field = FIELD_BY_PATH[path];
  return (
    <Input
      label={compact ? undefined : (label ?? field.label)}
      aria-label={compact ? field.label : undefined}
      type="number"
      inputMode="decimal"
      step={field.kind === 'int' ? 1 : 'any'}
      min={field.min}
      max={field.max}
      value={draft[path]}
      error={errors[path]}
      hint={compact ? undefined : hint}
      onChange={(event) => onChange(path, event.target.value)}
      inputClassName="font-mono tabular"
    />
  );
}

export function ChangeList({ changes, limit }) {
  const shown = limit ? changes.slice(0, limit) : changes;
  return (
    <ul className="flex flex-col gap-1 text-body">
      {shown.map(({ field, before, after }) => (
        <li key={field.path} className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-fg-secondary">{field.label}</span>
          <span className="font-mono text-tech text-fg">{formatValue(field, before)} → {formatValue(field, after)}</span>
        </li>
      ))}
      {limit && changes.length > limit && <li className="text-meta text-fg-muted">and {changes.length - limit} more</li>}
    </ul>
  );
}

export function DetectionEditor({ active, onCancel, onSaved }) {
  const [draft, setDraft] = useState(() => toDraft(active));
  const [reviewing, setReviewing] = useState(false);
  const { errors, values } = useMemo(() => validateDraft(draft), [draft]);
  const changes = useMemo(() => diff(active, values, { afterIsFlat: true }), [active, values]);
  const invalid = Object.keys(errors).length > 0;
  const onChange = (path, value) => setDraft((previous) => ({ ...previous, [path]: value }));
  const fieldProps = { draft, errors, onChange };

  return (
    <>
      <Panel
        title={`Edit detection settings (saving creates version ${active.version + 1})`}
        description={APPLIES_NOTE}
      >
        <form
          className="flex flex-col gap-6 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!invalid && changes.length) setReviewing(true);
          }}
        >
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-heading font-semibold text-fg">Behavioral rules</legend>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] border-collapse text-body">
                <thead>
                  <tr className="text-left text-meta text-fg-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">Rule</th>
                    <th scope="col" className="py-2 pr-3 font-medium">Full at (threshold)</th>
                    <th scope="col" className="py-2 font-medium">Max points (weight)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-subtle">
                  {RULES.map((rule) => (
                    <tr key={rule.key}>
                      <th scope="row" className="py-2 pr-3 text-left font-normal">
                        <span className="text-fg">{rule.label}</span>
                        <span className="block text-meta text-fg-muted">{rule.unit}</span>
                      </th>
                      <td className="w-40 py-2 pr-3 align-top"><NumberField path={`thresholds.${rule.key}`} compact {...fieldProps} /></td>
                      <td className="w-40 py-2 align-top"><NumberField path={`weights.${rule.key}`} compact {...fieldProps} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField path="windowSeconds" hint="10 to 3600. Rules count operations inside this window." {...fieldProps} />
              <NumberField path="thresholds.sameExtension" hint="Extension changes also score in full at this many files renamed to one new extension." {...fieldProps} />
            </div>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-heading font-semibold text-fg">Integrity and deception</legend>
            <NumberField path="weights.hashChangeRatio" hint="Ratio of changed files × weight; only with mass modification at least partial." {...fieldProps} />
            <NumberField path="weights.canaryTrigger" hint="Full points for any canary touched; severity at least Suspicious." {...fieldProps} />
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-heading font-semibold text-fg">Entropy (content)</legend>
            <Checkbox
              className="sm:col-span-2"
              label="Score the entropy signal"
              hint="Off: entropy is still measured and stored, but adds no points."
              checked={draft['entropy.enabled']}
              onChange={(event) => onChange('entropy.enabled', event.target.checked)}
            />
            <NumberField path="weights.entropyChange" {...fieldProps} />
            <NumberField path="thresholds.entropyBaselineMax" hint="Files already above this (compressed formats) are weak evidence and not scored." {...fieldProps} />
            <NumberField path="thresholds.entropyDeltaMin" {...fieldProps} />
            <div className="grid grid-cols-2 gap-4">
              <NumberField path="entropy.partialRatio" label="Partial at" hint="0 to 1" {...fieldProps} />
              <NumberField path="entropy.fullRatio" label="Full at" hint="0 to 1" {...fieldProps} />
            </div>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-heading font-semibold text-fg">ML anomaly (auxiliary)</legend>
            <Checkbox
              className="sm:col-span-2"
              label="Ask the ML service after inline scoring"
              hint="Off, down or slow: detection is unchanged and the ML row shows its status. It can only raise a severity."
              checked={draft['ml.enabled']}
              onChange={(event) => onChange('ml.enabled', event.target.checked)}
            />
            <NumberField path="weights.mlAnomaly" {...fieldProps} />
            <NumberField path="ml.timeoutMs" hint="100 to 10000." {...fieldProps} />
            <NumberField path="ml.minOperations" hint="Windows that scored Safe are sent once they hold this many file operations." {...fieldProps} />
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-3">
            <legend className="mb-2 text-heading font-semibold text-fg">Scoring</legend>
            <NumberField path="severityBands.suspicious" {...fieldProps} />
            <NumberField path="severityBands.high" {...fieldProps} />
            <NumberField path="severityBands.critical" {...fieldProps} />
            <NumberField path="minCategoriesForCritical" hint="1 to 5. With fewer categories the score is capped below Critical." {...fieldProps} />
          </fieldset>

          <div className="flex flex-col gap-3 border-t border-line-subtle pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-meta text-fg-muted" aria-live="polite">
              {invalid
                ? `${Object.keys(errors).length} field${Object.keys(errors).length === 1 ? '' : 's'} to fix`
                : changes.length ? `${changes.length} change${changes.length === 1 ? '' : 's'} from version ${active.version}` : 'No changes yet'}
            </p>
            <div className="flex gap-2">
              <Button onClick={onCancel}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={invalid || changes.length === 0}>Review changes</Button>
            </div>
          </div>
        </form>
      </Panel>

      <ConfirmDialog
        open={reviewing}
        onClose={() => setReviewing(false)}
        title={`Save as version ${active.version + 1}?`}
        confirmLabel={`Save version ${active.version + 1}`}
        onConfirm={async () => {
          const saved = await adminApi.updateDetectionConfig(toPatch(changes));
          onSaved(saved);
        }}
      >
        <Notice tone="info">{APPLIES_NOTE} Version {active.version} is kept and stays readable.</Notice>
        <ChangeList changes={changes} />
      </ConfirmDialog>
    </>
  );
}
