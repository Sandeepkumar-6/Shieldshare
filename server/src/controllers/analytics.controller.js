import * as analytics from '../services/analytics.service.js';
import * as feed from '../services/activityFeed.service.js';
import { errors } from '../utils/AppError.js';
import { pageMeta } from '../utils/pagination.js';

// Admin analytics and the global activity feed (api-contract §2.6). Read-only.

const DAY_MS = 86_400_000;
const MAX_RANGE_MS = 92 * DAY_MS;

// Default range: the last 24 hours.
function range({ from, to }) {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - DAY_MS);
  if (start >= end) throw errors.validation('The start of the range must be before its end.');
  if (end - start > MAX_RANGE_MS) throw errors.validation('Choose a range of at most 92 days.');
  return { from: start, to: end };
}

export async function riskTimeline(req, res) {
  const { from, to } = range(req.valid.query);
  const bucket = req.valid.query.bucket ?? '5m';
  if (Math.ceil((to - from) / analytics.BUCKETS[bucket].ms) > analytics.MAX_BUCKETS) {
    throw errors.validation(`A ${bucket} bucket over this range gives more than ${analytics.MAX_BUCKETS} points. Choose a larger bucket.`);
  }
  const { items, bands } = await analytics.riskTimeline({ from, to, bucket });
  res.json({ data: items, meta: { from, to, bucket, bands } });
}

export async function severityDistribution(req, res) {
  const { from, to } = range(req.valid.query);
  res.json({ data: await analytics.severityDistribution({ from, to }), meta: { from, to } });
}

export async function activityDistribution(req, res) {
  const { from, to } = range(req.valid.query);
  res.json({ data: await analytics.activityDistribution({ from, to }), meta: { from, to } });
}

export async function activityFeed(req, res) {
  const query = req.valid.query;
  const { items, total } = await feed.listFeed(query);
  res.json({ data: items, meta: pageMeta(query, total) });
}
