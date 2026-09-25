import { useState } from 'react';
import { Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { DetailList, PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { diff } from '../../features/detection/configFields.js';
import { ChangeList, DetectionEditor } from '../../features/detection/DetectionEditor.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useWriteAccess } from '../../hooks/useWriteAccess.js';
import { adminApi } from '../../services/admin.service.js';
import { formatDateTime } from '../../utils/format.js';

const RULES = [
  { key: 'rapidActivity', label: 'Rapid activity', unit: 'write operations', category: 'Behavior' },
  { key: 'massModification', label: 'Mass modification', unit: 'distinct files modified', category: 'Behavior' },
  { key: 'massRename', label: 'Mass rename', unit: 'distinct files renamed', category: 'Behavior' },
  { key: 'massDelete', label: 'Mass delete', unit: 'distinct files deleted', category: 'Behavior' },
  { key: 'directorySpread', label: 'Directory spread', unit: 'distinct folders written', category: 'Behavior' },
  { key: 'extensionChanges', label: 'Extension changes', unit: 'files changing extension', category: 'Behavior', extra: 'sameExtension' },
];

const half = (value) => (value * 0.5) % 1 === 0 ? value * 0.5 : Math.ceil(value * 0.5);

// The active detection configuration, explained, with an editor that saves a new version
// (PUT /api/admin/config/detection, validated and audited) and the version history.

function Overview({ c, ml }) {
  const mlService = ml.status === 'success' ? ml.data : null;
  return (
    <div className="flex flex-col gap-6">
      <Panel title="Behavioral rules" description={`Counted per user over a sliding ${c.windowSeconds}-second window.`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-body">
            <thead className="border-b border-line-subtle">
              <tr className="text-left text-meta text-fg-muted">
                <th scope="col" className="px-4 py-2.5 font-medium">Rule</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Partial (half points) at</th>
                <th scope="col" className="px-4 py-2.5 font-medium">Full at</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Max points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-subtle">
              {RULES.map((rule) => (
                <tr key={rule.key}>
                  <td className="px-4 py-2.5"><p className="text-fg">{rule.label}</p><p className="text-meta text-fg-muted">{rule.category}</p></td>
                  <td className="px-4 py-2.5 text-fg-secondary">≥ {half(c.thresholds[rule.key])} {rule.unit}</td>
                  <td className="px-4 py-2.5 text-fg-secondary">
                    ≥ {c.thresholds[rule.key]} {rule.unit}
                    {rule.extra && <span className="block text-meta text-fg-muted">or ≥ {c.thresholds.sameExtension} renamed to the same new extension</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-tech text-fg">{c.weights[rule.key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Other signals">
          <DetailList
            items={[
              { label: 'Hash-change ratio', value: <>up to <span className="font-mono">{c.weights.hashChangeRatio}</span> points (ratio × weight), only with mass modification at least partial</> },
              { label: 'Canary trigger', value: <><span className="font-mono">{c.weights.canaryTrigger}</span> points for any canary touched; severity at least Suspicious</> },
              { label: 'Entropy change', value: <><Badge tone={c.entropy.enabled ? 'success' : 'neutral'} dot>{c.entropy.enabled ? 'Enabled' : 'Disabled'}</Badge> <span className="text-fg-muted">up to {c.weights.entropyChange} points; partial at {Math.round(c.entropy.partialRatio * 100)}%, full at {Math.round(c.entropy.fullRatio * 100)}% of modified files with an entropy increase ≥ {c.thresholds.entropyDeltaMin} from a baseline below {c.thresholds.entropyBaselineMax}</span></> },
              {
                label: 'ML anomaly',
                value: (
                  <>
                    <Badge tone={c.ml.enabled ? 'success' : 'neutral'} dot>{c.ml.enabled ? 'Enabled' : 'Disabled'}</Badge>
                    {' '}
                    {c.ml.enabled && mlService && <Badge tone={mlService.available ? 'success' : 'warning'} dot>{mlService.available ? 'Service up' : 'Service unavailable'}</Badge>}
                    <span className="mt-1 block text-fg-muted">
                      Isolation Forest trained on synthetic normal activity; up to {c.weights.mlAnomaly} points, asked asynchronously after a Suspicious result or at {c.ml.minOperations} operations (timeout {c.ml.timeoutMs} ms). It can only raise a severity.
                    </span>
                  </>
                ),
              },
            ]}
          />
        </Panel>
        <Panel title="Scoring">
          <DetailList
            items={[
              { label: 'Severity bands', value: `Safe < ${c.severityBands.suspicious} ≤ Suspicious < ${c.severityBands.high} ≤ High < ${c.severityBands.critical} ≤ Critical` },
              { label: 'Multi-signal gate', value: `Critical needs at least ${c.minCategoriesForCritical} signal categories; otherwise capped at ${c.severityBands.critical - 1}` },
              { label: 'Response', value: 'High opens an incident. Critical also freezes the account (not admins) and quarantines the affected files.' },
              { label: 'Versions', value: 'Every change is a new version; each evaluation records the version it used, so stored incidents stay explainable.' },
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

function VersionHistory({ versions }) {
  if (versions.status === 'loading') return <div className="px-4"><SkeletonRows rows={3} columns={3} label="Loading version history" /></div>;
  if (versions.status === 'error') return <ErrorState compact title="Version history unavailable" error={versions.error} onRetry={versions.reload} />;
  const list = versions.data;
  if (list.length === 0) return <EmptyState compact title="No versions yet" />;
  return (
    <ol className="divide-y divide-line-subtle">
      {list.map((version, index) => {
        const previous = list[index + 1];
        const changes = previous ? diff(previous, version) : [];
        return (
          <li key={version.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:gap-6">
            <div className="flex shrink-0 flex-col gap-1 sm:w-56">
              <span className="flex items-center gap-2">
                <span className="font-mono text-tech text-fg">v{version.version}</span>
                {version.isActive && <Badge tone="accent" dot>Active</Badge>}
              </span>
              <time dateTime={version.createdAt} className="text-meta text-fg-muted">{formatDateTime(version.createdAt)}</time>
              <span className="text-meta text-fg-secondary">
                {version.createdBy ? (version.createdBy.name ?? version.createdBy.email ?? 'Administrator') : 'Spec defaults (created at first start)'}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              {previous
                ? (changes.length ? <ChangeList changes={changes} limit={6} /> : <p className="text-meta text-fg-muted">Same values as v{previous.version}</p>)
                : <p className="text-meta text-fg-muted">First version</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default function AdminDetection() {
  const toast = useToast();
  const access = useWriteAccess();
  const config = useAsync(() => adminApi.detectionConfig(), []);
  const versions = useAsync(() => adminApi.detectionConfigVersions(), []);
  const ml = useAsync(() => adminApi.mlStatus(), []);
  const [editing, setEditing] = useState(false);

  if (config.status === 'loading') return <><PageHeader title="Detection" /><Panel><SkeletonRows rows={6} columns={4} label="Loading configuration" /></Panel></>;
  if (config.status === 'error') return <><PageHeader title="Detection" /><Panel><ErrorState title="Unable to load the detection configuration" error={config.error} onRetry={config.reload} /></Panel></>;

  const c = config.data;
  return (
    <>
      <PageHeader
        title="Detection"
        description="The active thresholds and weights. Each weight is the most a signal can add; a rule scores half at 50% of its threshold and in full at the threshold."
        meta={<><Badge tone="accent">Version {c.version}</Badge><span>Active since {formatDateTime(c.createdAt)}</span></>}
        actions={!editing && <Button icon="sliders" disabledReason={access.reason} onClick={() => setEditing(true)}>Edit settings</Button>}
      />
      <div className="flex flex-col gap-6">
        {editing ? (
          <DetectionEditor
            key={c.version}
            active={c}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              setEditing(false);
              toast.success(`Detection settings saved as version ${saved.version}`, 'New evaluations use it; existing incidents keep their stored breakdown.');
              config.reload();
              versions.reload();
            }}
          />
        ) : <Overview c={c} ml={ml} />}

        <Panel title="Version history" description="Who changed what, and when. Versions are never edited or deleted.">
          <VersionHistory versions={versions} />
        </Panel>
      </div>
    </>
  );
}
