import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { SeverityBadge } from '../../components/security/SecurityBadges.jsx';
import { AccountStatusBadge, Badge } from '../../components/ui/Badge.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Input, Select } from '../../components/ui/Field.jsx';
import { DetailList, PageHeader, Panel } from '../../components/ui/Layout.jsx';
import { ConfirmDialog } from '../../components/ui/Modal.jsx';
import { ProgressBar } from '../../components/ui/ProgressBar.jsx';
import { Skeleton } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState, Notice } from '../../components/ui/States.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { useWriteAccess } from '../../hooks/useWriteAccess.js';
import { adminApi } from '../../services/admin.service.js';
import { useLiveRefresh, useSocketEvent } from '../../state/SocketContext.jsx';
import { formatDateTime, formatTime, pluralize } from '../../utils/format.js';

// /admin/simulator (spec §30, api-contract §2.10). Drives the controlled simulator, which
// acts only as the demo account, only through the public API, and only on demo-data. The
// page shows the server's status and the live simulator.progress events; it never computes
// scores itself.

const SCENARIO_TEXT = {
  'ransomware-like': 'Ransomware-like: enumerate every file, replace each file\'s content with a reversible transform and rename it to .locked, folders interleaved; one hidden (canary) file touched halfway. Stops at the first 423 Locked.',
  'normal-use': 'Normal use: two uploads and two small edits at human pace. Expected to stay Safe.',
};
const BUSY_TEXT = { seed: 'Seeding the demo workspace', run: 'Running a scenario', reset: 'Resetting the demo workspace' };
const RUN_STATE = {
  running: { tone: 'info', label: 'Running' },
  completed: { tone: 'success', label: 'Completed' },
  stopped: { tone: 'critical', label: 'Stopped by ShieldShare' },
  failed: { tone: 'warning', label: 'Failed' },
};
const MAX_LOG = 200;

function useNow(active) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function LastRun({ run }) {
  if (!run) return <span className="text-fg-muted">No run since the server started</span>;
  const state = RUN_STATE[run.state] ?? { tone: 'neutral', label: run.state };
  return (
    <span className="flex flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <Badge tone={state.tone} dot>{state.label}</Badge>
        <span className="font-mono text-tech">{run.scenario}</span>
        <span className="text-fg-secondary">{run.step}/{run.total ?? '?'} operations · pace {run.paceMs} ms</span>
      </span>
      <span className="text-meta text-fg-muted">Started {formatDateTime(run.startedAt)}{run.finishedAt ? `, finished ${formatTime(run.finishedAt)}` : ''}</span>
      {run.stoppedReason && run.state !== 'stopped' && <span className="text-meta text-warning">{run.stoppedReason}</span>}
    </span>
  );
}

function FreezeOutcome({ run }) {
  if (run?.state !== 'stopped') return null;
  return (
    <Notice tone="critical" title={`Stopped: account frozen after ${pluralize(run.step, 'operation')}`}>
      <p>
        ShieldShare froze the demo account and the simulator stopped at its first 423 Locked response
        {run.msFirstWriteToFreeze != null ? `, ${(run.msFirstWriteToFreeze / 1000).toFixed(1)} s after its first write` : ''}.
        {run.total ? ` ${run.total - run.step} planned operations never ran.` : ''}
      </p>
      {run.incident && (
        <p className="mt-1.5 flex flex-wrap items-center gap-2">
          <SeverityBadge severity={run.incident.severity} />
          <Link to={`/admin/incidents/${run.incident.id}`} className="font-mono text-accent hover:text-accent-hover">{run.incident.incidentNumber}</Link>
          <span>risk {run.incident.riskScore}/100</span>
        </p>
      )}
    </Notice>
  );
}

export default function AdminSimulator() {
  const toast = useToast();
  const access = useWriteAccess();
  const status = useAsync(() => adminApi.simulatorStatus(), []);
  const [scenario, setScenario] = useState('ransomware-like');
  const [pace, setPace] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const [pending, setPending] = useState(null); // 'seed' | 'run'
  const [log, setLog] = useState([]);
  const [progress, setProgress] = useState(null);
  const logEnd = useRef(null);

  useSocketEvent('simulator.progress', (data, envelope) => {
    setProgress(data);
    setLog((lines) => [...lines, { id: envelope.eventId, at: envelope.at, text: data.lastAction, stopped: data.stoppedReason }].slice(-MAX_LOG));
    if (data.stoppedReason || (data.total && data.step >= data.total)) setTimeout(status.reload, 400);
  });
  useLiveRefresh(['user.frozen', 'user.unfrozen', 'incident.created', 'incident.resolved'], status.reload, { delay: 800 });

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'nearest' });
  }, [log.length]);

  const data = status.data;
  const readyAt = data?.readyAt ? new Date(data.readyAt).getTime() : null;
  const now = useNow(Boolean(readyAt) || data?.busy);
  const waitSeconds = readyAt ? Math.max(0, Math.ceil((readyAt - now) / 1000)) : 0;
  useEffect(() => {
    if (readyAt && waitSeconds === 0) status.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyAt, waitSeconds === 0]);

  if (status.status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="flex flex-col gap-4">
        <span className="sr-only">Loading simulator</span>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (status.status === 'error') {
    return status.error?.status === 404 ? (
      <EmptyState
        icon="activity"
        title="The simulator is disabled on this server"
        description="It only exists when SIMULATOR_ENABLED=true in server/.env (never in production). Restart the API after changing it."
      />
    ) : <ErrorState title="Unable to load the simulator" error={status.error} onRetry={status.reload} />;
  }

  const busy = data.busy;
  const blockedReason = access.reason
    ?? (data.problem ? 'The demo account is not available.' : null)
    ?? (busy ? `${BUSY_TEXT[busy]}…` : null);
  const runBlocked = blockedReason
    ?? (data.demoUser?.status === 'FROZEN' ? 'The demo account is frozen. Reset it first.' : null)
    ?? (scenario === 'ransomware-like' && waitSeconds > 0 ? `Available in ${waitSeconds} s` : null);
  const paceMs = pace === '' ? undefined : Number(pace);
  const paceInvalid = paceMs !== undefined && (!Number.isInteger(paceMs) || paceMs < 20 || paceMs > 5000);
  const runningNow = busy === 'run' || data.lastRun?.state === 'running';
  const shown = progress ?? (data.lastRun ? { step: data.lastRun.step, total: data.lastRun.total } : null);

  async function act(kind, request, success) {
    setPending(kind);
    try {
      const result = await request();
      success?.(result);
    } catch (error) {
      toast.error(error.message);
    } finally {
      setPending(null);
      status.reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Controlled simulator"
        description="Replays a ransomware-like burst through the real API so detection, containment and recovery can be shown end to end."
        meta={<Badge tone="success" dot>Enabled on this server</Badge>}
      />

      <div className="flex flex-col gap-6">
        <Notice tone="info" title="Controlled simulation: demo account only. No real ransomware.">
          The simulator signs in as the demo account and calls the same endpoints as the web app. Its
          &quot;encryption&quot; is a reversible XOR transform on files seeded from server/demo-data; no key is withheld and
          nothing outside the demo account is read or changed.
        </Notice>

        {data.problem && <Notice tone="warning" title="The demo account is not available">{data.problem}</Notice>}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Panel title="Status" actions={<Button size="sm" variant="ghost" icon="refresh" onClick={status.reload}>Refresh</Button>}>
              <DetailList
                items={[
                  {
                    label: 'Demo account',
                    value: data.demoUser
                      ? <span className="flex flex-wrap items-center gap-2">{data.demoUser.name} <span className="text-fg-muted">· {data.demoUser.email}</span> <AccountStatusBadge status={data.demoUser.status} /></span>
                      : <span className="text-fg-muted">Not available</span>,
                  },
                  data.workspace && {
                    label: 'Workspace',
                    value: `${pluralize(data.workspace.files, 'file')} · ${data.workspace.quarantined} quarantined · ${pluralize(data.workspace.openIncidents, 'open incident')}`,
                  },
                  { label: 'Simulator', value: busy ? <Badge tone="info" dot>{BUSY_TEXT[busy]}</Badge> : <Badge tone="neutral" dot>Idle</Badge> },
                  { label: 'Last run', value: <LastRun run={data.lastRun} /> },
                  readyAt && waitSeconds > 0 && {
                    label: 'Ready in',
                    value: `${waitSeconds} s: the seeded files must be older than the detection window, so recovery has a version from before the burst.`,
                  },
                ]}
              />
            </Panel>

            <Panel
              title="Progress"
              description="Each write the simulator makes, as reported by simulator.progress."
              actions={log.length > 0 && <Button size="sm" variant="ghost" onClick={() => { setLog([]); setProgress(null); }}>Clear log</Button>}
            >
              <div className="flex flex-col gap-3 px-4 py-4">
                {shown?.total ? (
                  <div className="flex items-center gap-3">
                    <ProgressBar value={shown.step / shown.total} tone={data.lastRun?.state === 'stopped' || progress?.stoppedReason === 'frozen by ShieldShare' ? 'critical' : 'accent'} label="Simulator progress" />
                    <span className="shrink-0 font-mono text-tech text-fg-secondary tabular">{shown.step}/{shown.total}</span>
                  </div>
                ) : null}
                {!runningNow && <FreezeOutcome run={data.lastRun} />}
                {log.length === 0 ? (
                  <p className="text-body text-fg-muted">Nothing yet. Seed, run or reset to see each operation here as it happens.</p>
                ) : (
                  <ol aria-label="Simulator log" className="max-h-80 overflow-y-auto rounded-control border border-line-subtle bg-bg-secondary px-3 py-2 font-mono text-tech">
                    {log.map((line) => (
                      <li key={line.id} className={`flex gap-3 py-0.5 ${line.stopped ? 'text-critical' : 'text-fg-secondary'}`}>
                        <time dateTime={line.at} className="shrink-0 text-fg-muted">{formatTime(line.at)}</time>
                        <span className="break-all">{line.text}{line.stopped ? ` (stopped: ${line.stopped})` : ''}</span>
                      </li>
                    ))}
                    <li ref={logEnd} aria-hidden="true" />
                  </ol>
                )}
              </div>
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-6">
            <Panel title="Seed" description="Uploads the 15 demo-data files into documents, finance and projects. Files already there are skipped.">
              <div className="px-4 py-4">
                <Button icon="upload" loading={pending === 'seed'} disabledReason={blockedReason} onClick={() => act('seed', adminApi.simulatorSeed, (result) => toast.success('Demo workspace seeded', `${result.uploaded} uploaded, ${result.skipped} already there`))}>
                  Seed demo workspace
                </Button>
              </div>
            </Panel>

            <Panel title="Run scenario">
              <form
                className="flex flex-col gap-4 px-4 py-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (runBlocked || paceInvalid) return;
                  setLog([]);
                  setProgress(null);
                  act('run', () => adminApi.simulatorRun({ scenario, paceMs }), () => toast.info('Scenario started', 'Progress appears below and on the dashboard.'));
                }}
              >
                <Select label="Scenario" value={scenario} onChange={(event) => setScenario(event.target.value)}>
                  <option value="ransomware-like">Ransomware-like burst</option>
                  <option value="normal-use">Normal use (contrast)</option>
                </Select>
                <p className="text-meta text-fg-secondary">{SCENARIO_TEXT[scenario]}</p>
                <Input
                  label="Pace between operations (ms)"
                  type="number"
                  inputMode="numeric"
                  min={20}
                  max={5000}
                  placeholder={String(data.defaultPaceMs?.[scenario] ?? '')}
                  value={pace}
                  onChange={(event) => setPace(event.target.value)}
                  hint={`Default ${data.defaultPaceMs?.[scenario]} ms. 20 to 5000.`}
                  error={paceInvalid ? 'Use a whole number from 20 to 5000.' : undefined}
                />
                <Button type="submit" variant="primary" icon="activity" loading={pending === 'run'} disabledReason={runBlocked}>
                  Run scenario
                </Button>
              </form>
            </Panel>

            <Panel title="Reset" description="Returns the demo account to its seed state before a demo (spec §30).">
              <div className="px-4 py-4">
                <Button variant="danger-ghost" icon="restore" disabledReason={blockedReason} onClick={() => setConfirmReset(true)}>
                  Reset demo workspace
                </Button>
              </div>
            </Panel>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        tone="danger"
        title="Reset the demo workspace?"
        confirmLabel="Reset demo workspace"
        onConfirm={async () => {
          setLog([]);
          setProgress(null);
          const result = await adminApi.simulatorReset();
          toast.success('Demo workspace reset', `${result.closedIncidents.length ? `${result.closedIncidents.join(', ')} closed · ` : ''}${result.seeded.uploaded} files seeded`);
          status.reload();
        }}
      >
        <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-fg-secondary">
          <li>{data.demoUser?.email ?? 'The demo account'} is unfrozen.</li>
          <li>Its open incidents are closed as Resolved with the note &quot;demo reset&quot; (recorded in the audit log).</li>
          <li>Its files, versions, share links and quarantine items are deleted, then canaries and the demo-data files are seeded again.</li>
          <li>Activity, evaluations, incidents and the audit log are kept as history. Nothing outside the demo account is touched.</li>
        </ul>
      </ConfirmDialog>
    </>
  );
}
