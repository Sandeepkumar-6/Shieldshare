import {
  ACTIVE_INCIDENT_STATUSES,
  Alert,
  FileModel,
  SecurityIncident,
  User,
  Version,
  nextSequence,
} from '../models/index.js';
import { EVENTS, publish } from '../realtime/events.js';
import * as freeze from './freeze.service.js';
import * as quarantine from './quarantine.service.js';
import { OPERATION_ACTIONS } from './rules.engine.js';

// Automatic response (spec §16 Response Matrix, §17, §18):
//   SAFE / SUSPICIOUS  evaluation stored only (a canary touch alerts on its own)
//   HIGH               open incident (OPEN) + INCIDENT_CREATED alert, no freeze
//   CRITICAL           open or update the incident, freeze the user, quarantine the
//                      affected files, incident CONTAINED + INCIDENT_ESCALATED alert
//
// One incident per user while it is OPEN / CONTAINED / INVESTIGATING; further evaluations
// update it. Every step checks what already happened, so running it again never duplicates
// quarantine items, alerts or timeline entries. Called inside the per-user queue.
//
// Real-time (Phase 4): incident.created, incident.updated and security.alert are published
// here; user.frozen and file.quarantined come from the freeze and quarantine services.

const SYSTEM = Object.freeze({ kind: 'SYSTEM' });

const unique = (values) => [...new Set(values.filter(Boolean).map(String))];

function burstFacts(entries) {
  const operations = entries.filter((entry) => OPERATION_ACTIONS.includes(entry.action));
  return {
    windowStart: entries[0].timestamp,
    windowEnd: entries[entries.length - 1].timestamp,
    operations,
    files: unique(operations.filter((entry) => !entry.isCanary).map((entry) => entry.fileId)),
    directories: unique(operations.flatMap((entry) => [entry.directory, entry.fromDirectory])),
    canaryEntries: entries.filter((entry) => entry.action === 'CANARY_TRIGGER'),
  };
}

function ruleText(signal) {
  const o = signal.observed ?? {};
  const t = signal.threshold ?? {};
  const level = signal.level === 'partial' ? ' (partial)' : '';
  switch (signal.key) {
    case 'rapidActivity': return `Rapid activity${level}: ${o.operations} operations in the window (threshold ${t.operations})`;
    case 'massModification': return `Mass modification${level}: ${o.files} files modified (threshold ${t.files})`;
    case 'massRename': return `Mass rename${level}: ${o.files} files renamed (threshold ${t.files})`;
    case 'massDelete': return `Mass delete${level}: ${o.files} files deleted (threshold ${t.files})`;
    case 'directorySpread': return `Directory spread${level}: ${o.folders} folders written (threshold ${t.folders})`;
    case 'extensionChanges': return `Extension changes${level}: ${o.files} files changed extension, ${o.sameExtension} to ${o.extension ?? 'one extension'}`;
    case 'hashChangeRatio': return `Hash-change ratio: ${o.changedFiles} of ${o.touchedFiles} touched files changed content (${Math.round((o.ratio ?? 0) * 100)}%)`;
    default: return `${signal.label}${level}`;
  }
}

const CANARY_VERB = { MODIFY: 'modified', RENAME: 'renamed', MOVE: 'moved', DELETE: 'deleted' };

async function canaryText(entry) {
  const verb = CANARY_VERB[entry.triggeringAction] ?? 'touched';
  return `Canary file ${entry.fileName ?? 'decoy'} ${verb}`;
}

async function canaryTimelineEntries(canaryEntries, existingTimeline = []) {
  const recorded = new Set(existingTimeline.filter((t) => t.type === 'CANARY').map((t) => String(t.ref?.id)));
  const fresh = canaryEntries.filter((entry) => !recorded.has(entry.id));
  return Promise.all(fresh.map(async (entry) => ({
    at: entry.timestamp,
    type: 'CANARY',
    text: await canaryText(entry),
    ref: { kind: 'Activity', id: entry.id },
    actor: 'SYSTEM',
  })));
}

// security.alert (api-contract §4) for every alert created, including canary alerts that have
// no incident.
export function publishAlert(alert, incident) {
  publish(EVENTS.SECURITY_ALERT, {
    alertId: String(alert._id),
    incidentId: incident ? String(incident._id) : null,
    incidentNumber: incident?.incidentNumber ?? null,
    severity: alert.severity,
    title: alert.title,
  });
}

export function publishIncidentUpdated(incident) {
  publish(EVENTS.INCIDENT_UPDATED, {
    incidentId: String(incident._id),
    status: incident.status,
    riskScore: incident.riskScore,
  });
}

async function createAlertOnce({ incident, userId, type, severity, title }) {
  if (incident && await Alert.exists({ incidentId: incident._id, type })) return null;
  const alert = await Alert.create({ incidentId: incident?._id, userId, type, severity, title });
  publishAlert(alert, incident);
  return alert;
}

// Spec §8 retroactive marking: every version the user created since the window started is
// SUSPICIOUS, even if it was created as SAFE. Canary versions are left out.
async function markWindowVersionsSuspicious(incident) {
  const canaryIds = await FileModel.find({ ownerId: incident.userId, isCanary: true }).distinct('_id');
  const result = await Version.updateMany(
    {
      createdBy: incident.userId,
      createdAt: { $gte: incident.windowStart },
      securityStatus: { $in: ['SAFE', 'RESTORED'] },
      fileId: { $nin: canaryIds },
    },
    { $set: { securityStatus: 'SUSPICIOUS', incidentId: incident._id } },
  );
  return result.modifiedCount;
}

async function openIncident(user, evaluation, facts) {
  const sequence = await nextSequence('incidentNumber');
  const incidentNumber = `SH-${1000 + sequence}`;
  const fired = evaluation.signals.filter((signal) => signal.points > 0);
  const top = [...fired].sort((a, b) => b.points - a.points)[0];
  const now = new Date();

  const timeline = [
    {
      at: facts.windowStart,
      type: 'ACTIVITY_BURST',
      text: `Burst began: ${facts.operations.length} file operations on ${facts.files.length} files across ${facts.directories.length} folders in the detection window`,
      actor: 'SYSTEM',
    },
    ...fired.filter((signal) => signal.category !== 'DECEPTION').map((signal) => ({
      at: now, type: 'RULE_FIRED', text: ruleText(signal), ref: { kind: 'RiskEvaluation', id: evaluation._id }, actor: 'SYSTEM',
    })),
    ...(await canaryTimelineEntries(facts.canaryEntries)),
    {
      at: now,
      type: 'RISK',
      text: `Risk ${evaluation.score} · ${evaluation.severity}${evaluation.capApplied ? ' (single-category cap applied)' : ''}`,
      ref: { kind: 'RiskEvaluation', id: evaluation._id },
      actor: 'SYSTEM',
    },
  ];

  const incident = await SecurityIncident.create({
    incidentNumber,
    userId: user._id,
    status: 'OPEN',
    riskScore: evaluation.score,
    severity: evaluation.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
    trigger: top?.label,
    signals: fired.map((signal) => signal.key),
    latestEvaluationId: evaluation._id,
    peakEvaluationId: evaluation._id,
    windowStart: facts.windowStart,
    windowEnd: facts.windowEnd,
    affectedFiles: facts.files,
    affectedDirectories: facts.directories,
    canaryTriggered: facts.canaryEntries.length > 0,
    timeline,
  });

  await markWindowVersionsSuspicious(incident);
  publish(EVENTS.INCIDENT_CREATED, {
    incidentId: String(incident._id),
    incidentNumber,
    userId: String(user._id),
    riskScore: incident.riskScore,
    severity: incident.severity,
  });
  await createAlertOnce({
    incident,
    userId: user._id,
    type: 'INCIDENT_CREATED',
    severity: incident.severity,
    title: `${incidentNumber} opened: ${incident.severity} risk activity by ${user.email}`,
  });
  return incident;
}

async function recordEvaluation(incident, evaluation, facts) {
  const fired = evaluation.signals.filter((signal) => signal.points > 0);
  const newSignals = fired.filter((signal) => !incident.signals.includes(signal.key));
  const canaryEntries = await canaryTimelineEntries(facts.canaryEntries, incident.timeline);
  const peak = evaluation.score > incident.riskScore;
  const nowCritical = evaluation.severity === 'CRITICAL' && incident.severity !== 'CRITICAL';
  const now = new Date();

  const push = [
    ...newSignals.filter((signal) => signal.category !== 'DECEPTION').map((signal) => ({
      at: now, type: 'RULE_FIRED', text: ruleText(signal), ref: { kind: 'RiskEvaluation', id: evaluation._id }, actor: 'SYSTEM',
    })),
    ...canaryEntries,
    ...(nowCritical ? [{
      at: now, type: 'RISK', text: `Risk ${evaluation.score} · CRITICAL`, ref: { kind: 'RiskEvaluation', id: evaluation._id }, actor: 'SYSTEM',
    }] : []),
  ];

  const updated = await SecurityIncident.findByIdAndUpdate(
    incident._id,
    {
      $set: {
        latestEvaluationId: evaluation._id,
        ...(peak ? { riskScore: evaluation.score, peakEvaluationId: evaluation._id } : {}),
        ...(nowCritical ? { severity: 'CRITICAL' } : {}),
        ...(facts.canaryEntries.length ? { canaryTriggered: true } : {}),
      },
      $max: { windowEnd: facts.windowEnd },
      $min: { windowStart: facts.windowStart },
      $addToSet: {
        signals: { $each: newSignals.map((signal) => signal.key) },
        affectedFiles: { $each: facts.files },
        affectedDirectories: { $each: facts.directories },
      },
      ...(push.length ? { $push: { timeline: { $each: push } } } : {}),
    },
    { returnDocument: 'after' },
  );
  await markWindowVersionsSuspicious(updated);
  if (peak || nowCritical || push.length) publishIncidentUpdated(updated);
  return updated;
}

// The frozen user is notified (user.frozen to their own room) once containment is complete,
// even if a later step fails, so their reloaded file list already shows the quarantine.
async function contain(incident, user) {
  const state = { frozeNow: false };
  try {
    return await containSteps(incident, user, state);
  } finally {
    if (state.frozeNow) {
      publish(EVENTS.CONTAINMENT_COMPLETED, { userId: String(user._id), incidentId: String(incident._id) });
    }
  }
}

async function containSteps(incident, user, state) {
  const events = [];
  const set = { severity: 'CRITICAL' };
  const now = new Date();

  // 1. Freeze (spec §5). Admin accounts are never frozen automatically.
  if (user.role === 'admin') {
    if (!incident.timeline.some((entry) => entry.type === 'FREEZE')) {
      events.push({ at: now, type: 'FREEZE', text: 'Auto-freeze skipped: admin account', actor: 'SYSTEM' });
    }
  } else if (user.status === 'ACTIVE') {
    try {
      await freeze.freezeUser(user._id, {
        reason: `Automatic containment for incident ${incident.incidentNumber}`,
        incidentId: incident._id,
        actor: SYSTEM,
      });
      state.frozeNow = true;
      events.push({ at: now, type: 'FREEZE', text: 'Account frozen automatically: file changes blocked, read access kept', actor: 'SYSTEM' });
      set.freezeStatus = 'FROZEN';
    } catch (error) {
      if (error.code !== 'INVALID_TRANSITION') throw error;
    }
  } else if (user.status === 'FROZEN' && incident.freezeStatus !== 'FROZEN') {
    set.freezeStatus = 'FROZEN';
  }

  // 2. Quarantine every affected file not already contained (deleted ones too).
  const files = await FileModel.find({ _id: { $in: incident.affectedFiles }, isCanary: { $ne: true } });
  let quarantinedFiles = 0;
  let quarantinedVersions = 0;
  let suspendedLinks = 0;
  for (const file of files) {
    if (file.status === 'QUARANTINED') continue;
    const windowVersions = await Version.find({
      fileId: file._id,
      createdBy: incident.userId,
      createdAt: { $gte: incident.windowStart },
    }).distinct('_id');
    try {
      const result = await quarantine.quarantineFile(file._id, {
        reason: `Incident ${incident.incidentNumber}: ${incident.trigger ?? 'ransomware-like activity'}`,
        incidentId: incident._id,
        versionIds: windowVersions,
        actor: SYSTEM,
      });
      quarantinedFiles += 1;
      quarantinedVersions += result.versions.length;
      suspendedLinks += result.suspendedLinks;
    } catch (error) {
      if (error.code !== 'INVALID_TRANSITION') throw error; // raced with another quarantine
    }
  }
  if (quarantinedFiles > 0) {
    events.push({
      at: new Date(),
      type: 'QUARANTINE',
      text: `${quarantinedFiles} file${quarantinedFiles === 1 ? '' : 's'} quarantined (${quarantinedVersions} version${quarantinedVersions === 1 ? '' : 's'}); ${suspendedLinks} share link${suspendedLinks === 1 ? '' : 's'} suspended`,
      actor: 'SYSTEM',
    });
  }
  const remaining = await FileModel.countDocuments({
    _id: { $in: incident.affectedFiles }, isCanary: { $ne: true }, status: { $ne: 'QUARANTINED' },
  });
  set.quarantineStatus = files.length === 0 ? 'NONE' : remaining === 0 ? 'QUARANTINED' : 'PARTIAL';

  // 3. Status (an incident under investigation stays with its administrator).
  if (incident.status === 'OPEN') {
    set.status = 'CONTAINED';
    events.push({ at: new Date(), type: 'STATUS', text: 'Status → CONTAINED', actor: 'SYSTEM' });
  }

  const updated = await SecurityIncident.findByIdAndUpdate(
    incident._id,
    { $set: set, ...(events.length ? { $push: { timeline: { $each: events } } } : {}) },
    { returnDocument: 'after' },
  );
  publishIncidentUpdated(updated);

  await createAlertOnce({
    incident: updated,
    userId: user._id,
    type: 'INCIDENT_ESCALATED',
    severity: 'CRITICAL',
    title: `${updated.incidentNumber} contained: CRITICAL activity by ${user.email}`
      + `${user.role === 'admin' ? ' (admin account, not frozen)' : ', account frozen'}, ${quarantinedFiles} files quarantined`,
  });
  return updated;
}

// A canary touched outside any HIGH/CRITICAL burst: alert without an incident, at most once
// per user per detection window.
async function canaryAlert(user, facts, config) {
  const since = new Date(Date.now() - config.windowSeconds * 1000);
  if (await Alert.exists({ userId: user._id, type: 'CANARY_TRIGGERED', createdAt: { $gte: since } })) return;
  const first = facts.canaryEntries[0];
  const alert = await Alert.create({
    userId: user._id,
    type: 'CANARY_TRIGGERED',
    severity: 'SUSPICIOUS',
    title: `Canary file ${first?.fileName ?? ''} ${CANARY_VERB[first?.triggeringAction] ?? 'touched'} by ${user.email}`.replace(/\s+/g, ' '),
  });
  publishAlert(alert, null);
}

export async function handleEvaluation({ userId, evaluation, entries, config }) {
  const user = await User.findById(userId);
  if (!user) return null;
  const facts = burstFacts(entries);
  let incident = await SecurityIncident.findOne({ userId, status: { $in: ACTIVE_INCIDENT_STATUSES } });

  if (evaluation.severity === 'HIGH' || evaluation.severity === 'CRITICAL') {
    incident = incident ? await recordEvaluation(incident, evaluation, facts) : await openIncident(user, evaluation, facts);
    if (evaluation.severity === 'CRITICAL') incident = await contain(incident, user);
    return incident;
  }

  if (facts.canaryEntries.length) {
    if (incident) {
      // Keep the open incident's evidence complete.
      const canaryEntries = await canaryTimelineEntries(facts.canaryEntries, incident.timeline);
      if (canaryEntries.length) {
        incident = await SecurityIncident.findByIdAndUpdate(
          incident._id,
          { $set: { canaryTriggered: true }, $push: { timeline: { $each: canaryEntries } } },
          { returnDocument: 'after' },
        );
        publishIncidentUpdated(incident);
      }
      return incident;
    }
    await canaryAlert(user, facts, config);
  }
  // A SUSPICIOUS evaluation during an open incident is linked to it without changing it.
  return incident;
}
