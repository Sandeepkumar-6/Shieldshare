import mongoose from 'mongoose';
import {
  ACTIVE_INCIDENT_STATUSES,
  Alert,
  QuarantineItem,
  SecurityIncident,
  User,
  Version,
} from '../models/index.js';
import { EVENTS, publish } from '../realtime/events.js';
import { errors } from '../utils/AppError.js';
import * as freeze from './freeze.service.js';
import * as quarantine from './quarantine.service.js';
import { publishAlert, publishIncidentUpdated } from './response.service.js';
import * as windowStore from './window.store.js';

// Incident lifecycle (spec §18):
//
//   OPEN ──► CONTAINED ──► INVESTIGATING ──► RECOVERED ──► RESOLVED
//     │           │               │
//     └───────────┴───────────────┴──────────► FALSE_POSITIVE
//
//   investigate     OPEN | CONTAINED            → INVESTIGATING   (admin)
//   containment     OPEN                        → CONTAINED       (system, CRITICAL)
//   recovery        OPEN | CONTAINED | INVEST.  → RECOVERED       (system, last restore)
//   resolve         RECOVERED                   → RESOLVED        (admin, note)
//   false positive  OPEN | CONTAINED | INVEST.  → FALSE_POSITIVE  (admin, note)
//
// Anything else answers 409 INVALID_TRANSITION. Admin transitions go on the timeline here and
// in AdminAuditLog through the route wrapper.

export async function getIncident(id) {
  if (!mongoose.isValidObjectId(id)) throw errors.notFound('Incident not found.');
  const incident = await SecurityIncident.findById(id);
  if (!incident) throw errors.notFound('Incident not found.');
  return incident;
}

export async function getIncidentByReference({ incidentId, incidentNumber }) {
  if (incidentId) return getIncident(incidentId);
  const incident = await SecurityIncident.findOne({ incidentNumber });
  if (!incident) throw errors.notFound('Incident not found.');
  return incident;
}

const invalid = (incident, action) => errors.conflict(
  'INVALID_TRANSITION',
  `An incident that is ${incident.status} can't be ${action}.`,
);

export async function investigate(id, actor) {
  const incident = await getIncident(id);
  if (!['OPEN', 'CONTAINED'].includes(incident.status)) throw invalid(incident, 'moved to investigation');
  const admin = await User.findById(actor.adminId).select('name').lean();
  const updated = await SecurityIncident.findOneAndUpdate(
    { _id: incident._id, status: incident.status },
    {
      $set: { status: 'INVESTIGATING', assignedTo: actor.adminId },
      $push: { timeline: { at: new Date(), type: 'STATUS', actor: 'ADMIN', adminId: actor.adminId, text: `Status → INVESTIGATING (owner: ${admin?.name ?? 'administrator'})` } },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw invalid(incident, 'moved to investigation');
  publishIncidentUpdated(updated);
  return { incident: updated, before: { status: incident.status }, after: { status: updated.status } };
}

export async function resolve(id, actor, { resolution, note, unfreezeUser = false }) {
  const incident = await getIncident(id);
  if (resolution === 'RESOLVED' && incident.status !== 'RECOVERED') {
    throw errors.conflict(
      'INVALID_TRANSITION',
      `Only a RECOVERED incident can be resolved (this one is ${incident.status}). Restore the affected files first, or mark it as a false positive.`,
    );
  }
  if (resolution === 'FALSE_POSITIVE' && !ACTIVE_INCIDENT_STATUSES.includes(incident.status)) {
    throw invalid(incident, 'marked as a false positive');
  }

  const events = [];
  const set = {};
  const user = await User.findById(incident.userId);

  // False positive: release without restoring. Files return to their current version (a file
  // deleted in the window returns to deleted), window versions return to SAFE. Released before
  // the unfreeze below, so the user's live refresh on user.unfrozen already sees the files back.
  if (resolution === 'FALSE_POSITIVE') {
    const items = await QuarantineItem.find({ incidentId: incident._id, status: 'QUARANTINED' });
    let reactivatedLinks = 0;
    for (const item of items) {
      const result = await quarantine.releaseQuarantine(item._id, { note, actor: { kind: 'ADMIN', ...actor } });
      reactivatedLinks += result.reactivatedLinks;
    }
    const versions = await Version.updateMany(
      { incidentId: incident._id, securityStatus: 'SUSPICIOUS' },
      { $set: { securityStatus: 'SAFE' }, $unset: { incidentId: 1 } },
    );
    if (items.length || versions.modifiedCount) {
      events.push({
        at: new Date(), type: 'QUARANTINE', actor: 'ADMIN', adminId: actor.adminId,
        text: `${items.length} file${items.length === 1 ? '' : 's'} released without restore; versions returned to Safe; ${reactivatedLinks} share link${reactivatedLinks === 1 ? '' : 's'} reactivated`,
      });
    }
    if (items.length) set.quarantineStatus = 'RELEASED';
  }

  // Unfreeze: always for a false positive (spec §17), optional when resolving. freeze.service
  // records it on the incident timeline.
  if ((resolution === 'FALSE_POSITIVE' || unfreezeUser) && user?.status === 'FROZEN') {
    await freeze.unfreezeUser(user._id, { reason: `Incident ${incident.incidentNumber} ${resolution.toLowerCase().replace('_', ' ')}: ${note}`, actor: { kind: 'ADMIN', ...actor } });
    set.freezeStatus = 'UNFROZEN';
  }

  const now = new Date();
  events.push({
    at: now, type: 'STATUS', actor: 'ADMIN', adminId: actor.adminId,
    text: `Status → ${resolution}: “${note}”`,
  });
  const updated = await SecurityIncident.findOneAndUpdate(
    { _id: incident._id, status: incident.status },
    {
      $set: { ...set, status: resolution, resolution, resolutionNote: note, resolvedBy: actor.adminId, resolvedAt: now },
      $push: { timeline: { $each: events } },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw invalid(incident, 'resolved');

  await closeOut(updated, resolution === 'FALSE_POSITIVE' ? 'closed as a false positive' : 'resolved', now);

  return {
    incident: updated,
    before: { status: incident.status, userStatus: user?.status ?? null },
    after: { status: updated.status, freezeStatus: updated.freezeStatus, quarantineStatus: updated.quarantineStatus },
  };
}

// After an incident closes: INCIDENT_RESOLVED alert, the user's risk back to SAFE and a fresh
// detection window (the judged activity must not be scored again with the next ordinary write).
async function closeOut(incident, verb, now) {
  const alert = await Alert.create({
    incidentId: incident._id,
    userId: incident.userId,
    type: 'INCIDENT_RESOLVED',
    severity: 'INFO',
    title: `${incident.incidentNumber} ${verb}`,
  });
  await User.updateOne({ _id: incident.userId }, { $set: { securityStatus: 'SAFE' } });
  windowStore.resetUser(incident.userId, now);

  publish(EVENTS.INCIDENT_RESOLVED, { incidentId: String(incident._id), resolution: incident.resolution });
  publishAlert(alert, incident);
}

/**
 * Simulator reset only (spec §30 rule 8): closes a demo incident as RESOLVED with the note
 * "demo reset", whatever its status, because the reset deletes the demo workspace it was
 * about (there is nothing left to recover). The caller must have checked that the incident
 * belongs to the demo account and audit-logs the closure.
 */
export async function closeForDemoReset(incident, actor) {
  if (['RESOLVED', 'FALSE_POSITIVE'].includes(incident.status)) return null;
  const now = new Date();
  const note = 'demo reset';
  const updated = await SecurityIncident.findOneAndUpdate(
    { _id: incident._id, status: incident.status },
    {
      $set: { status: 'RESOLVED', resolution: 'RESOLVED', resolutionNote: note, resolvedBy: actor.adminId, resolvedAt: now },
      $push: { timeline: { at: now, type: 'STATUS', actor: 'ADMIN', adminId: actor.adminId, text: `Status → RESOLVED: “${note}” (simulator reset of the demo workspace)` } },
    },
    { returnDocument: 'after' },
  );
  if (!updated) return null;
  await closeOut(updated, 'resolved (demo reset)', now);
  return { incident: updated, before: { status: incident.status } };
}
