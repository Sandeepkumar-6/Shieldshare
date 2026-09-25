import { useMemo, useState } from 'react';
import { FilterTabs } from '../../components/ui/FilterTabs.jsx';
import { PageHeader, Panel } from '../../components/ui/Layout.jsx';
import {
  ActivityDistributionChart,
  ChartState,
  RiskTimelineChart,
  SeverityDistributionChart,
} from '../../features/analytics/charts.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { adminApi } from '../../services/admin.service.js';
import { useLiveRefresh } from '../../state/SocketContext.jsx';
import { formatDateTime } from '../../utils/format.js';

// /admin/analytics (spec §20 "Risk Visualization", skill §37). Three questions, one range:
//   Did risk rise, and when?       → risk over time
//   How risky was the activity?    → scored operations per risk level
//   What kind of activity was it?  → events per action

const RANGES = [
  { value: '1h', label: '1 hour', ms: 3_600_000, bucket: '1m' },
  { value: '24h', label: '24 hours', ms: 86_400_000, bucket: '15m' },
  { value: '7d', label: '7 days', ms: 7 * 86_400_000, bucket: '1h' },
  { value: '30d', label: '30 days', ms: 30 * 86_400_000, bucket: '6h' },
];

function useRange(value, nonce) {
  // Recomputed when the range changes or a refresh is requested, so "now" moves forward.
  return useMemo(() => {
    const range = RANGES.find((entry) => entry.value === value);
    const to = new Date();
    return { from: new Date(to.getTime() - range.ms).toISOString(), to: to.toISOString(), bucket: range.bucket };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, nonce]);
}

export default function AdminAnalytics() {
  const [rangeValue, setRangeValue] = useState('24h');
  const [nonce, setNonce] = useState(0);
  const range = useRange(rangeValue, nonce);
  const params = { from: range.from, to: range.to };

  const timeline = useAsync(() => adminApi.riskTimeline({ ...params, bucket: range.bucket }), [range]);
  const severity = useAsync(() => adminApi.severityDistribution(params), [range]);
  const activity = useAsync(() => adminApi.activityDistribution(params), [range]);

  // New evaluations or a reconnect move the window forward and reload all three.
  useLiveRefresh(['risk.updated', 'incident.created', 'incident.resolved'], () => setNonce((value) => value + 1), { delay: 1500 });

  const withEmpty = (state, rows) => ({ ...state, empty: state.status === 'success' && rows?.length === 0 });

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Risk and activity over a time range, aggregated from stored evaluations and activity records."
        meta={<span>{formatDateTime(range.from)} → {formatDateTime(range.to)}</span>}
        actions={<FilterTabs label="Time range" options={RANGES} value={rangeValue} onChange={setRangeValue} />}
      />

      <div className="flex flex-col gap-6">
        <Panel
          title="Risk over time"
          description="Highest stored risk score per interval. Evaluations are stored from Suspicious upwards; an empty interval means everything scored Safe or nothing happened."
        >
          <ChartState
            state={withEmpty(timeline, timeline.data?.data)}
            height={260}
            emptyTitle="No stored evaluations in this range"
            emptyDescription="Every scored operation in this range was Safe, or there was no activity. Try a longer range."
          >
            {timeline.data && <RiskTimelineChart points={timeline.data.data} meta={timeline.data.meta} height={260} />}
          </ChartState>
        </Panel>

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title="Severity distribution"
            description="File operations (upload, modify, rename, move, delete) by the risk level of the evaluation that followed each one."
          >
            <ChartState
              state={withEmpty(severity, severity.data)}
              height={200}
              emptyTitle="No scored operations in this range"
              emptyDescription="Uploads, modifications, renames, moves and deletes are scored as they happen."
            >
              {severity.data && <SeverityDistributionChart rows={severity.data} />}
            </ChartState>
          </Panel>

          <Panel
            title="Activity distribution"
            description="Every recorded event per action, including sign-ins, sharing and the automatic response. Security events are highlighted."
          >
            <ChartState
              state={withEmpty(activity, activity.data)}
              height={200}
              emptyTitle="No activity in this range"
              emptyDescription="Events appear here once users sign in, upload or share files."
            >
              {activity.data && <ActivityDistributionChart rows={activity.data} />}
            </ChartState>
          </Panel>
        </div>
      </div>
    </>
  );
}
