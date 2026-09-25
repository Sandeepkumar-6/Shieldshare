import { ACTIVE_INCIDENT_STATUSES, Activity, RiskEvaluation, SecurityIncident, User } from '../models/index.js';
import { config as env } from '../config/env.js';
import { EVENTS, publish } from '../realtime/events.js';
import { awaitsScoring } from '../services/activity.service.js';
import { activeConfig } from './config.service.js';
import { computeFeatures } from './features.js';
import { scoreWindow } from './ml.client.js';
import * as response from './response.service.js';
import { computeRisk } from './risk.engine.js';
import { OPERATION_ACTIONS, evaluateRules } from './rules.engine.js';
import { runExclusive } from './userQueue.js';
import * as windowStore from './window.store.js';

const SEVERITY_RANK = { SAFE: 0, SUSPICIOUS: 1, HIGH: 2, CRITICAL: 3 };
const round1 = (value) => Math.round(value * 10) / 10;

// Inline detection (spec §10 "Evaluation Timing"). Every write operation calls onActivity once,
// after its Activity records are persisted and before the response is sent:
//
//   add to the user's sliding window → rules + integrity + canary → risk score
//   → store a RiskEvaluation when ≥ SUSPICIOUS → response (incident / freeze / quarantine)
//
// The request that crosses CRITICAL completes normally; the freeze is in place before its
// response is sent, so the user's next write gets 423. Evaluations for one user are
// serialized. A failure here is logged and never breaks the file operation.
//
// Real-time (Phase 4): risk.updated and canary.triggered are published before the response
// runs, so administrators see them ahead of incident.created / user.frozen / file.quarantined.
// The operation's own activities are published last, carrying the risk level they produced.
//
// Entropy scoring is inline and baseline-aware. The ML re-evaluation (Phase 5b) runs
// asynchronously after the response; it can only raise a severity, never lower it.

/**
 * @param {Array} activities Activity documents created by one write operation.
 * @param {object} ctx request context (unused for scoring; kept for the call contract).
 * @returns {Promise<object|null>} { evaluation, risk, incident } for tests and diagnostics.
 */
// eslint-disable-next-line no-unused-vars
export async function onActivity(activities, ctx) {
  const all = (activities ?? []).filter(Boolean);
  const relevant = all.filter((activity) => activity.userId && windowStore.DETECTION_ACTIONS.includes(activity.action));
  const scored = all.filter(awaitsScoring);

  let result = null;
  if (relevant.length > 0) {
    const userId = String(relevant[0].userId);
    try {
      result = await runExclusive(userId, () => evaluateUser(userId, relevant, scored));
    } catch (error) {
      console.error('[detection] evaluation failed; the file operation continues', error);
    }
  }
  if (scored.length) {
    publish(EVENTS.ACTIVITY_CREATED, {
      activities: scored,
      severity: result?.risk?.severity ?? null,
      incidentId: result?.incident?._id ?? null,
    });
  }
  return result;
}

async function evaluateUser(userId, activities, scored) {
  const config = await activeConfig();
  windowStore.add(userId, activities);
  const entries = windowStore.entries(userId, new Date(), config.windowSeconds);
  if (entries.length === 0) return null;

  const signals = evaluateRules(entries, config);
  const risk = computeRisk(signals, config);

  await User.updateOne({ _id: userId, securityStatus: { $ne: risk.severity } }, { $set: { securityStatus: risk.severity } });
  if (risk.severity === 'SAFE') {
    await annotate(scored, risk.severity, null);
    scheduleMl({ userId, entries, config, risk, signals, evaluation: null, incident: null, scored });
    return { risk, evaluation: null };
  }

  const evaluation = await RiskEvaluation.create({
    userId,
    windowStart: entries[0].timestamp,
    windowEnd: entries[entries.length - 1].timestamp,
    rawScore: risk.rawScore,
    score: risk.score,
    severity: risk.severity,
    categories: risk.categories,
    capApplied: risk.capApplied,
    reasons: risk.reasons,
    signals,
    ml: { status: 'DISABLED' },
    configVersion: config.version,
    phase: 'INLINE',
  });

  const open = await SecurityIncident.findOne({ userId, status: { $in: ACTIVE_INCIDENT_STATUSES } }).select('_id').lean();
  publish(EVENTS.RISK_UPDATED, {
    userId,
    evaluationId: String(evaluation._id),
    score: evaluation.score,
    severity: evaluation.severity,
    phase: evaluation.phase,
    incidentId: open ? String(open._id) : undefined,
  });
  for (const activity of activities.filter((entry) => entry.action === 'CANARY_TRIGGER')) {
    publish(EVENTS.CANARY_TRIGGERED, {
      userId,
      fileId: String(activity.fileId),
      action: activity.metadata?.triggeringAction ?? null,
      incidentId: open ? String(open._id) : undefined,
    });
  }

  const incident = await response.handleEvaluation({ userId, evaluation, entries, config });
  if (incident) {
    await RiskEvaluation.updateOne({ _id: evaluation._id }, { $set: { incidentId: incident._id } });
    evaluation.incidentId = incident._id;
  }
  await annotate(scored, risk.severity, incident?._id ?? null);
  scheduleMl({ userId, entries, config, risk, signals, evaluation, incident, scored });
  return { risk, evaluation, incident };
}

// Spec §15 / decision P5-3: the ML service is asked after a SUSPICIOUS-or-higher inline result,
// or once the window holds at least ml.minOperations file operations. Never in the request path.
function scheduleMl({ userId, entries, config, risk, signals, evaluation, incident, scored }) {
  if (!config.ml.enabled || !env.mlService.enabled) return;
  const operations = entries.filter((entry) => OPERATION_ACTIONS.includes(entry.action)).length;
  if (risk.severity === 'SAFE' && operations < config.ml.minOperations) return;
  setImmediate(() => {
    runMlEvaluation({ userId, entries, config, inlineRisk: risk, inlineSignals: signals, inlineEvaluation: evaluation, incident, scored })
      .catch((error) => console.error('[detection] asynchronous ML evaluation failed', error));
  });
}

// The HTTP call to the ML service runs outside the user's queue, so a slow service never
// delays the inline scoring of the user's next writes. Storing the WITH_ML evaluation and any
// escalation run inside the queue, like every other evaluation: an escalation can't race an
// inline evaluation into a second incident.
export async function runMlEvaluation({ userId, entries, config, inlineRisk, inlineSignals, inlineEvaluation, incident, scored = [] }) {
  const features = computeFeatures(entries, config.windowSeconds);
  const result = await scoreWindow({
    userId: String(userId),
    windowStart: entries[0].timestamp,
    windowEnd: entries[entries.length - 1].timestamp,
    features,
  }, { timeoutMs: config.ml.timeoutMs });

  return runExclusive(String(userId), () => storeMlEvaluation({
    userId, entries, config, inlineRisk, inlineSignals, inlineEvaluation, incident, scored, result, features,
  }));
}

async function storeMlEvaluation({ userId, entries, config, inlineRisk, inlineSignals, inlineEvaluation, incident, scored, result, features }) {
  const anomalyScore = result.status === 'OK' ? result.anomalyScore : 0;
  const anomalySignal = {
    key: 'mlAnomaly',
    category: 'ANOMALY',
    label: 'ML anomaly',
    level: anomalyScore >= 0.5 ? 'full' : anomalyScore > 0 ? 'partial' : 'none',
    observed: { status: result.status, anomalyScore, isAnomaly: result.isAnomaly ?? false },
    threshold: { baseline: 'synthetic normal activity' },
    points: round1(anomalyScore * config.weights.mlAnomaly),
    maxPoints: config.weights.mlAnomaly,
    evidence: [],
  };
  const signals = [...inlineSignals.filter((signal) => signal.key !== 'mlAnomaly'), anomalySignal];
  const risk = computeRisk(signals, config);
  // Only evaluations at SUSPICIOUS or above are stored (spec §10): a SAFE window the ML
  // service did not lift stays unrecorded, like its inline evaluation.
  if (risk.severity === 'SAFE' && !inlineEvaluation) return { result, features, risk, evaluation: null, incident: null };
  const evaluation = await RiskEvaluation.create({
    userId,
    incidentId: incident?._id,
    windowStart: entries[0].timestamp,
    windowEnd: entries[entries.length - 1].timestamp,
    rawScore: risk.rawScore,
    score: risk.score,
    severity: risk.severity,
    categories: risk.categories,
    capApplied: risk.capApplied,
    reasons: risk.reasons,
    signals,
    ml: {
      status: result.status,
      ...(result.status === 'OK' ? {
        anomalyScore: result.anomalyScore,
        isAnomaly: result.isAnomaly,
        features,
        modelVersion: result.modelVersion,
      } : { features }),
    },
    configVersion: config.version,
    phase: 'WITH_ML',
  });

  let linkedIncident = incident ?? null;
  if (SEVERITY_RANK[risk.severity] > SEVERITY_RANK[inlineRisk.severity]) {
    linkedIncident = await response.handleEvaluation({ userId, evaluation, entries, config });
    if (linkedIncident) {
      await RiskEvaluation.updateOne({ _id: evaluation._id }, { $set: { incidentId: linkedIncident._id } });
      evaluation.incidentId = linkedIncident._id;
    }
    await User.updateOne({ _id: userId }, { $set: { securityStatus: risk.severity } });
    await annotate(scored, risk.severity, linkedIncident?._id ?? null);
  } else if (!linkedIncident && inlineEvaluation?.incidentId) {
    evaluation.incidentId = inlineEvaluation.incidentId;
  }

  publish(EVENTS.RISK_UPDATED, {
    userId: String(userId),
    evaluationId: String(evaluation._id),
    score: evaluation.score,
    severity: evaluation.severity,
    phase: evaluation.phase,
    incidentId: linkedIncident ? String(linkedIncident._id) : undefined,
  });
  return { result, features, risk, evaluation, incident: linkedIncident };
}

// Stores the risk level on the operation's own events (and the incident they belong to), so
// the activity feed and analytics read it back instead of recomputing it.
async function annotate(activities, severity, incidentId) {
  if (activities.length === 0) return;
  await Activity.updateMany(
    { _id: { $in: activities.map((activity) => activity._id) } },
    { $set: { riskSeverity: severity, ...(incidentId ? { 'metadata.incidentId': incidentId } : {}) } },
  );
}
