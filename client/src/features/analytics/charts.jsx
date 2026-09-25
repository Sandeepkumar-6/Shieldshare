import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Skeleton } from '../../components/ui/Skeleton.jsx';
import { useTheme as useColorTheme } from '../../state/ThemeContext.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { pluralize } from '../../utils/format.js';

// Charts for the admin dashboard and /admin/analytics (spec §20, skill §37). Each answers one
// question and renders only what the API returned: a time bucket without a stored evaluation
// stays empty (never drawn as zero risk), and a range without data shows an empty state.

// Colours come from the design tokens (styles/index.css), read once.
function token(name, fallback) {
  if (typeof window === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function useTheme() {
  // Re-read the tokens when the colour theme changes.
  const { theme } = useColorTheme();
  return useMemo(() => ({
    grid: token('--color-line-subtle', '#1d242d'),
    axis: token('--color-fg-muted', '#737e8b'),
    text: token('--color-fg-secondary', '#a8b1bd'),
    accent: token('--color-accent', '#5aa3c8'),
    SAFE: token('--color-success', '#4cb782'),
    SUSPICIOUS: token('--color-warning', '#d6b04a'),
    HIGH: token('--color-danger', '#e08a45'),
    CRITICAL: token('--color-critical', '#e5554f'),
    surface: token('--color-surface-elevated', '#192029'),
    border: token('--color-line', '#29323d'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [theme]);
}

const SEVERITY_LABEL = { SAFE: 'Safe', SUSPICIOUS: 'Suspicious', HIGH: 'High', CRITICAL: 'Critical' };
const SEVERITIES = ['SAFE', 'SUSPICIOUS', 'HIGH', 'CRITICAL'];

// Loading / error / empty frame shared by the charts, sized like the chart it replaces.
export function ChartState({ state, height = 220, emptyTitle, emptyDescription, onRetry, children }) {
  if (state.status === 'loading') {
    return (
      <div role="status" aria-live="polite" className="px-4 py-4" style={{ height }}>
        <span className="sr-only">Loading chart</span>
        <Skeleton className="h-full w-full" />
      </div>
    );
  }
  if (state.status === 'error') return <ErrorState compact title="Unable to load this chart" error={state.error} onRetry={onRetry ?? state.reload} />;
  if (state.empty) return <EmptyState compact icon="chart" title={emptyTitle} description={emptyDescription} />;
  return children;
}

function ChartTooltip({ active, payload, render }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-control border border-line bg-surface-elevated px-3 py-2 text-meta text-fg shadow-lg shadow-black/40">
      {render(payload[0].payload)}
    </div>
  );
}

const BUCKET_MS = { '1m': 60_000, '5m': 300_000, '15m': 900_000, '1h': 3_600_000, '6h': 21_600_000, '1d': 86_400_000 };

// Every bucket of the range, with the API's point where one exists and null otherwise.
export function fillBuckets(points, { from, to, bucket }) {
  const size = BUCKET_MS[bucket];
  const byTime = new Map(points.map((point) => [new Date(point.t).getTime(), point]));
  const start = Math.floor(new Date(from).getTime() / size) * size;
  const end = new Date(to).getTime();
  const rows = [];
  for (let t = start; t < end; t += size) {
    rows.push(byTime.get(t) ?? { t: new Date(t).toISOString(), maxRisk: null, maxSeverity: null, evaluations: 0, users: 0 });
  }
  return rows;
}

function tickTime(value, bucket) {
  const date = new Date(value);
  if (bucket === '1d' || bucket === '6h') return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(bucket === '6h' ? { hour: '2-digit' } : {}) });
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/**
 * Risk over time: the highest stored risk score per bucket, coloured by its severity, with
 * the configured severity bands as reference lines.
 * @param {{ points, meta: { from, to, bucket, bands } }} props
 */
export function RiskTimelineChart({ points, meta, height = 240 }) {
  const theme = useTheme();
  const rows = useMemo(() => fillBuckets(points, meta), [points, meta]);
  const bands = meta.bands ?? {};
  const summary = `${pluralize(points.length, 'interval')} with stored evaluations; highest risk ${Math.max(...points.map((point) => point.maxRisk))}.`;

  return (
    <figure className="px-2 pb-2 pt-3">
      <figcaption className="sr-only">Risk over time. {summary}</figcaption>
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: -12 }} barCategoryGap={1}>
            <CartesianGrid stroke={theme.grid} vertical={false} />
            <XAxis
              dataKey="t"
              tickFormatter={(value) => tickTime(value, meta.bucket)}
              stroke={theme.axis}
              tick={{ fontSize: 11, fill: theme.axis }}
              tickLine={false}
              minTickGap={32}
            />
            <YAxis domain={[0, 100]} ticks={[0, bands.suspicious, bands.high, bands.critical, 100].filter((value) => value != null)} stroke={theme.axis} tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} axisLine={false} />
            {[['suspicious', 'SUSPICIOUS'], ['high', 'HIGH'], ['critical', 'CRITICAL']].map(([key, severity]) => bands[key] != null && (
              <ReferenceLine key={key} y={bands[key]} stroke={theme[severity]} strokeDasharray="4 4" strokeOpacity={0.6} />
            ))}
            <Tooltip
              cursor={{ fill: theme.grid }}
              content={(
                <ChartTooltip
                  render={(row) => (
                    <>
                      <p className="font-mono text-fg-secondary">{new Date(row.t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      {row.maxRisk == null
                        ? <p className="mt-1 text-fg-secondary">No stored evaluation: everything scored Safe, or nothing happened.</p>
                        : (
                          <>
                            <p className="mt-1">Highest risk <span className="font-mono tabular">{row.maxRisk}</span> · {SEVERITY_LABEL[row.maxSeverity]}</p>
                            <p className="text-fg-secondary">{pluralize(row.evaluations, 'evaluation')} · {pluralize(row.users, 'user')}</p>
                          </>
                        )}
                    </>
                  )}
                />
              )}
            />
            <Bar dataKey="maxRisk" isAnimationActive={false} radius={[2, 2, 0, 0]}>
              {rows.map((row) => <Cell key={row.t} fill={theme[row.maxSeverity] ?? theme.accent} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** Severity distribution: how many scored file operations produced each risk level. */
export function SeverityDistributionChart({ rows, height = 200 }) {
  const theme = useTheme();
  const byKey = new Map(rows.map((row) => [row.severity, row.count]));
  // Levels the API did not return had no operations in the range: zero is the true count.
  const data = SEVERITIES.map((severity) => ({ severity, label: SEVERITY_LABEL[severity], count: byKey.get(severity) ?? 0 }));
  return (
    <figure className="px-2 pb-2 pt-3">
      <figcaption className="sr-only">
        Scored file operations by risk level: {data.map((row) => `${row.label} ${row.count}`).join(', ')}.
      </figcaption>
      <div style={{ height }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={theme.grid} horizontal={false} />
            <XAxis type="number" allowDecimals={false} stroke={theme.axis} tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} />
            <YAxis type="category" dataKey="label" width={80} stroke={theme.axis} tick={{ fontSize: 12, fill: theme.text }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: theme.grid }} content={<ChartTooltip render={(row) => <p>{row.label}: <span className="font-mono tabular">{row.count}</span> {row.count === 1 ? 'operation' : 'operations'}</p>} />} />
            <Bar dataKey="count" isAnimationActive={false} radius={[0, 2, 2, 0]} label={{ position: 'right', fill: theme.text, fontSize: 11 }}>
              {data.map((row) => <Cell key={row.severity} fill={theme[row.severity]} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

const SECURITY_ACTIONS = new Set(['CANARY_TRIGGER', 'QUARANTINE', 'FREEZE', 'INTEGRITY_CHANGE']);

/** Activity distribution: recorded events per action, security events highlighted. */
export function ActivityDistributionChart({ rows, height }) {
  const theme = useTheme();
  const data = rows.slice(0, 14).map((row) => ({ ...row, label: row.action.replace(/_/g, ' ').toLowerCase() }));
  const chartHeight = height ?? Math.max(160, data.length * 26 + 24);
  return (
    <figure className="px-2 pb-2 pt-3">
      <figcaption className="sr-only">Events per action: {data.map((row) => `${row.label} ${row.count}`).join(', ')}.</figcaption>
      <div style={{ height: chartHeight }} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
            <CartesianGrid stroke={theme.grid} horizontal={false} />
            <XAxis type="number" allowDecimals={false} stroke={theme.axis} tick={{ fontSize: 11, fill: theme.axis }} tickLine={false} />
            <YAxis type="category" dataKey="label" width={118} stroke={theme.axis} tick={{ fontSize: 12, fill: theme.text }} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: theme.grid }} content={<ChartTooltip render={(row) => <p>{row.action}: <span className="font-mono tabular">{row.count}</span></p>} />} />
            <Bar dataKey="count" isAnimationActive={false} radius={[0, 2, 2, 0]} label={{ position: 'right', fill: theme.text, fontSize: 11 }}>
              {data.map((row) => <Cell key={row.action} fill={SECURITY_ACTIONS.has(row.action) ? theme.HIGH : theme.accent} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      {rows.length > data.length && <p className="px-2 text-meta text-fg-muted">Showing the 14 most frequent of {rows.length} actions.</p>}
    </figure>
  );
}
