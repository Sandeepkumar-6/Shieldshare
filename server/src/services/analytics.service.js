import { Activity, RiskEvaluation } from '../models/index.js';
import { activeConfig } from '../security/config.service.js';
import { OPERATION_ACTIONS } from '../security/rules.engine.js';

// Admin analytics (spec §20 "Risk Visualization", api-contract §2.6). Every number is an
// aggregation over stored records in [from, to); a range with no records returns an empty
// array. Nothing is interpolated or filled in: a time bucket without a stored evaluation is
// simply absent.
//
// Indexes used: RiskEvaluation { createdAt: -1 }, Activity { action: 1, timestamp: -1 } and
// { timestamp: 1 }.

export const BUCKETS = Object.freeze({
  '1m': { unit: 'minute', binSize: 1, ms: 60_000 },
  '5m': { unit: 'minute', binSize: 5, ms: 5 * 60_000 },
  '15m': { unit: 'minute', binSize: 15, ms: 15 * 60_000 },
  '1h': { unit: 'hour', binSize: 1, ms: 3_600_000 },
  '6h': { unit: 'hour', binSize: 6, ms: 6 * 3_600_000 },
  '1d': { unit: 'day', binSize: 1, ms: 86_400_000 },
});
export const MAX_BUCKETS = 1000;

const SEVERITY_ORDER = ['SAFE', 'SUSPICIOUS', 'HIGH', 'CRITICAL'];

// Risk over time: per bucket, the highest stored risk score, its severity, how many
// evaluations were stored and how many users they concern. Only evaluations at SUSPICIOUS
// or above are stored (spec §10), so an absent bucket means every operation scored SAFE or
// nothing happened.
export async function riskTimeline({ from, to, bucket }) {
  const { unit, binSize } = BUCKETS[bucket];
  const [rows, config] = await Promise.all([
    RiskEvaluation.aggregate([
      { $match: { createdAt: { $gte: from, $lt: to } } },
      {
        $group: {
          _id: { $dateTrunc: { date: '$createdAt', unit, binSize } },
          maxRisk: { $max: '$score' },
          maxSeverityRank: { $max: { $indexOfArray: [SEVERITY_ORDER, '$severity'] } },
          evaluations: { $sum: 1 },
          users: { $addToSet: '$userId' },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    activeConfig(),
  ]);
  return {
    items: rows.map((row) => ({
      t: row._id,
      maxRisk: row.maxRisk,
      maxSeverity: SEVERITY_ORDER[row.maxSeverityRank] ?? null,
      evaluations: row.evaluations,
      users: row.users.length,
    })),
    bands: config.severityBands,
  };
}

// Severity distribution: the risk level each scored file operation produced (the evaluation
// run right after it). Operations recorded before Phase 4 carry no stored level and are not
// counted.
export async function severityDistribution({ from, to }) {
  const rows = await Activity.aggregate([
    { $match: { action: { $in: OPERATION_ACTIONS }, timestamp: { $gte: from, $lt: to }, riskSeverity: { $exists: true } } },
    { $group: { _id: '$riskSeverity', count: { $sum: 1 } } },
  ]);
  return rows
    .map((row) => ({ severity: row._id, count: row.count }))
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
}

// Activity distribution: every recorded event per action (file operations, access, sharing
// and the security events of the response).
export async function activityDistribution({ from, to }) {
  const rows = await Activity.aggregate([
    { $match: { timestamp: { $gte: from, $lt: to } } },
    { $group: { _id: '$action', count: { $sum: 1 } } },
    { $sort: { count: -1, _id: 1 } },
  ]);
  return rows.map((row) => ({ action: row._id, count: row.count }));
}
