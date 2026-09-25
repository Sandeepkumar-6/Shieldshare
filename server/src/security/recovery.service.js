import mongoose from 'mongoose';
import {
  ACTIVE_INCIDENT_STATUSES,
  Activity,
  FileModel,
  QuarantineItem,
  SecurityIncident,
  ShareLink,
  User,
  Version,
} from '../models/index.js';
import { EVENTS, publish } from '../realtime/events.js';
import * as activity from '../services/activity.service.js';
import * as storage from '../services/storage.service.js';
import { AppError, errors } from '../utils/AppError.js';
import * as canaries from './canary.service.js';
import { verifyFileHash } from './integrity.js';
import * as quarantine from './quarantine.service.js';
import { publishIncidentUpdated } from './response.service.js';

// Recovery (spec §8 "Last known safe version", §17 "Recovery Flow").
//
//   propose  the highest versionNumber created before incident.windowStart whose status is
//            SAFE or RESTORED (none → "no safe version", nothing is restored)
//   restore  copy that version's blob into a new RESTORED version N+1, bring the name back,
//            recompute SHA-256 and compare; only on a pass: file ACTIVE (a deleted file is
//            undeleted), QuarantineItem RESTORED, links suspended by the incident reactivated
//   finish   when no affected file is still awaiting recovery, canaries touched in the
//            incident are reset from their templates and the incident becomes RECOVERED
//
// Suspicious / quarantined versions are never deleted or rewritten.

const RESTORABLE = ['SAFE', 'RESTORED'];

export async function proposedSafeVersion(fileId, windowStart) {
  return Version.findOne({
    fileId,
    createdAt: { $lt: windowStart },
    securityStatus: { $in: RESTORABLE },
  }).sort({ versionNumber: -1 });
}

async function restoredVersion(fileId, incidentId) {
  return Version.findOne({ fileId, incidentId, source: 'RESTORE', securityStatus: 'RESTORED' }).sort({ versionNumber: -1 });
}

// Per affected file: its versions from the incident window, the proposed safe version and
// where recovery stands: AWAITING | RESTORED | NO_SAFE_VERSION | RELEASED.
export async function fileStates(incident) {
  const files = await FileModel.find({ _id: { $in: incident.affectedFiles } }).lean();
  const items = await QuarantineItem.find({ incidentId: incident._id }).lean();
  const itemByFile = new Map(items.map((item) => [String(item.fileId), item]));

  return Promise.all(files.map(async (file) => {
    const [windowVersions, proposed, restored] = await Promise.all([
      Version.find({ fileId: file._id, createdAt: { $gte: incident.windowStart }, incidentId: incident._id })
        .sort({ versionNumber: 1 }).lean(),
      proposedSafeVersion(file._id, incident.windowStart),
      restoredVersion(file._id, incident._id),
    ]);
    const item = itemByFile.get(String(file._id)) ?? null;
    let state = 'AWAITING';
    if (restored) state = 'RESTORED';
    else if (item?.status === 'RELEASED') state = 'RELEASED';
    else if (!proposed) state = 'NO_SAFE_VERSION';
    return {
      file,
      windowVersions: windowVersions.filter((version) => String(version._id) !== String(restored?._id)),
      proposed: proposed?.toObject() ?? null,
      restored: restored?.toObject() ?? null,
      quarantineItem: item,
      state,
    };
  }));
}

// The open incident a file belongs to (admin restore is incident recovery; ordinary version
// restores are the owner's own endpoint).
export async function incidentForFile(fileId) {
  if (!mongoose.isValidObjectId(fileId)) throw errors.notFound('File not found.');
  if (!(await FileModel.exists({ _id: fileId }))) throw errors.notFound('File not found.');
  const incident = await SecurityIncident.findOne({ affectedFiles: fileId, status: { $in: ACTIVE_INCIDENT_STATUSES } })
    .sort({ createdAt: -1 });
  if (!incident) {
    throw errors.conflict('NOT_IN_INCIDENT', 'This file is not affected by an open incident, so there is nothing to recover.');
  }
  return incident;
}

function assertRecoverable(incident) {
  if (!ACTIVE_INCIDENT_STATUSES.includes(incident.status)) {
    throw errors.conflict('INVALID_TRANSITION', `Recovery is only possible while the incident is open, contained or under investigation (it is ${incident.status}).`);
  }
}

async function pushTimeline(incidentId, entries) {
  if (entries.length === 0) return null;
  return SecurityIncident.findByIdAndUpdate(incidentId, { $push: { timeline: { $each: entries } } }, { returnDocument: 'after' });
}

/**
 * Restores one affected file to `versionId` (spec §17).
 * actor: { adminId, ip }. Throws INTEGRITY_CHECK_FAILED (409) when verification fails.
 */
// finish: check for RECOVERED afterwards. itemize: write this restore's own timeline entries
// (restore-all writes one summary instead; failed verifications are always itemized).
export async function restoreFile(incident, fileId, versionId, actor, { finish = true, itemize = true } = {}) {
  assertRecoverable(incident);
  if (!mongoose.isValidObjectId(fileId) || !incident.affectedFiles.some((id) => String(id) === String(fileId))) {
    throw errors.conflict('NOT_AFFECTED_FILE', 'This file is not one of the incident\'s affected files.');
  }
  const file = await FileModel.findById(fileId).select('+storageKey');
  if (!file) throw errors.notFound('File not found.');
  if (!mongoose.isValidObjectId(versionId)) throw errors.notFound('Version not found.');
  const source = await Version.findOne({ _id: versionId, fileId: file._id }).select('+storageKey');
  if (!source) throw errors.notFound('Version not found.');
  if (!RESTORABLE.includes(source.securityStatus) || source.createdAt >= incident.windowStart) {
    throw errors.conflict('VERSION_NOT_RESTORABLE', 'Choose a safe version created before the incident started.');
  }

  // Copy the safe blob to a new key and verify it before anything else changes.
  let newKey;
  try {
    newKey = await storage.copyBlob(source.storageKey);
  } catch (error) {
    if (error.code === 'ENOENT') throw new AppError(500, 'STORAGE_UNAVAILABLE', 'The stored content of the safe version could not be read.');
    throw error;
  }
  const verification = await verifyFileHash(storage.blobPath(newKey), source.sha256);
  if (!verification.passed) {
    await storage.discardUnreferencedBlob(newKey);
    await pushTimeline(incident._id, [{
      at: new Date(), type: 'VERIFY', actor: 'ADMIN', adminId: actor.adminId,
      text: `Integrity verification failed for ${file.name}: the stored v${source.versionNumber} does not match its recorded SHA-256. Restore aborted; the file stays quarantined.`,
      ref: { kind: 'Version', id: source._id },
    }]);
    publish(EVENTS.RECOVERY_COMPLETED, {
      fileId: String(file._id), incidentId: String(incident._id), newVersion: null, verification: { passed: false },
    });
    throw new AppError(
      409,
      'INTEGRITY_CHECK_FAILED',
      `Restore stopped: v${source.versionNumber} of ${file.name} does not match its recorded SHA-256. The file stays quarantined.`,
      { expected: verification.expected, actual: verification.actual },
    );
  }

  const before = { name: file.name, versionNumber: file.currentVersion, status: file.status, sha256: file.sha256, entropy: file.entropy, size: file.size };
  const versionNumber = file.currentVersion + 1;
  let committed = false;
  try {
    let newVersion;
    try {
      newVersion = await Version.create({
        fileId: file._id,
        versionNumber,
        storageKey: newKey,
        nameAtVersion: source.nameAtVersion,
        size: source.size,
        sha256: source.sha256,
        entropy: source.entropy,
        createdBy: actor.adminId,
        source: 'RESTORE',
        restoredFromVersion: source.versionNumber,
        securityStatus: 'RESTORED',
        incidentId: incident._id,
      });
    } catch (error) {
      if (error?.code === 11000) throw errors.conflict('VERSION_CONFLICT', 'This file changed during the restore. Try again.');
      throw error;
    }

    const updated = await FileModel.findOneAndUpdate(
      { _id: file._id, currentVersion: before.versionNumber },
      {
        $set: {
          storageKey: newKey,
          name: source.nameAtVersion,
          sha256: source.sha256,
          entropy: source.entropy,
          size: source.size,
          currentVersion: versionNumber,
          status: 'ACTIVE',
          lastVerifiedAt: new Date(),
        },
        $unset: { deletedAt: 1, quarantinedAt: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      await Version.deleteOne({ _id: newVersion._id });
      throw errors.conflict('VERSION_CONFLICT', 'This file changed during the restore. Try again.');
    }
    committed = true;

    await quarantine.markRestored(file._id, incident._id, versionNumber);

    const now = new Date();
    const reactivated = await ShareLink.updateMany(
      { fileId: file._id, suspendedByIncidentId: incident._id, status: 'SUSPENDED', expiresAt: { $gt: now } },
      { $set: { status: 'ACTIVE' }, $unset: { suspendedByIncidentId: 1, suspendedByQuarantineId: 1 } },
    );
    await ShareLink.updateMany(
      { fileId: file._id, suspendedByIncidentId: incident._id, status: 'SUSPENDED', expiresAt: { $lte: now } },
      { $set: { status: 'EXPIRED' }, $unset: { suspendedByIncidentId: 1, suspendedByQuarantineId: 1 } },
    );

    // On the owner's timeline, attributed to the administrator. Admin recovery is not a user
    // write, so it never reaches the detection window.
    await activity.record({ userId: file.ownerId, sessionId: null, ip: actor.ip ?? null }, 'RESTORE', {
      timestamp: newVersion.createdAt,
      file: updated,
      hashBefore: before.sha256,
      hashAfter: source.sha256,
      entropyBefore: before.entropy,
      entropyAfter: source.entropy,
      sizeBefore: before.size,
      sizeAfter: source.size,
      nameBefore: before.name,
      nameAfter: source.nameAtVersion,
      metadata: { versionNumber, restoredFromVersion: source.versionNumber, incidentId: incident._id, actor: 'ADMIN', adminId: actor.adminId },
    });

    if (itemize) await pushTimeline(incident._id, [
      {
        at: now, type: 'RESTORE', actor: 'ADMIN', adminId: actor.adminId, ref: { kind: 'Version', id: newVersion._id },
        text: `${before.name} v${before.versionNumber} → ${source.nameAtVersion} v${versionNumber} (from safe v${source.versionNumber})`
          + `${before.status === 'DELETED' ? ', undeleted' : ''}`,
      },
      {
        at: now, type: 'VERIFY', actor: 'ADMIN', adminId: actor.adminId, ref: { kind: 'Version', id: newVersion._id },
        text: `SHA-256 verified for ${source.nameAtVersion} v${versionNumber}`,
      },
    ]);

    publish(EVENTS.RECOVERY_COMPLETED, {
      fileId: String(file._id), incidentId: String(incident._id), newVersion: versionNumber, verification: { passed: true },
    });

    const incidentStatus = finish ? await finishIfRecovered(incident._id, actor) : null;
    return {
      before: { name: before.name, version: before.versionNumber, fileStatus: before.status },
      file: updated,
      newVersion,
      source,
      verification: { passed: true, expected: verification.expected, actual: verification.actual },
      reactivatedLinks: reactivated.modifiedCount,
      incidentStatus,
    };
  } finally {
    if (!committed) await storage.discardUnreferencedBlob(newKey);
  }
}

// Canary files the user touched since the window started.
async function touchedCanaries(incident) {
  return Activity.find({ userId: incident.userId, action: 'CANARY_TRIGGER', timestamp: { $gte: incident.windowStart } }).distinct('fileId');
}

/**
 * When no affected file is still AWAITING, resets touched canaries and marks the incident
 * RECOVERED. Returns the incident status afterwards.
 */
export async function finishIfRecovered(incidentId, actor) {
  const incident = await SecurityIncident.findById(incidentId);
  if (!ACTIVE_INCIDENT_STATUSES.includes(incident.status)) return incident.status;
  const states = await fileStates(incident);
  if (states.some((state) => state.state === 'AWAITING')) return incident.status;

  const events = [];
  for (const canaryId of await touchedCanaries(incident)) {
    const result = await canaries.resetFromTemplate(canaryId, { adminId: actor.adminId, incidentId: incident._id, ip: actor.ip });
    if (result.reset) {
      events.push({ at: new Date(), type: 'RESTORE', actor: 'ADMIN', adminId: actor.adminId, text: `Canary file reset from template: ${result.file.name}` });
    }
  }

  const restored = states.filter((state) => state.state === 'RESTORED').length;
  const noSafe = states.filter((state) => state.state === 'NO_SAFE_VERSION').length;
  events.push({
    at: new Date(),
    type: 'STATUS',
    actor: 'ADMIN',
    adminId: actor.adminId,
    text: `Status → RECOVERED: ${restored} file${restored === 1 ? '' : 's'} restored and verified`
      + (noSafe ? `; ${noSafe} without a safe version stay${noSafe === 1 ? 's' : ''} quarantined` : ''),
  });
  const updated = await SecurityIncident.findOneAndUpdate(
    { _id: incident._id, status: { $in: ACTIVE_INCIDENT_STATUSES } },
    {
      $set: { status: 'RECOVERED', quarantineStatus: noSafe ? 'PARTIAL' : 'RESTORED' },
      $push: { timeline: { $each: events } },
    },
    { returnDocument: 'after' },
  );
  if (updated) publishIncidentUpdated(updated);
  return updated?.status ?? incident.status;
}

// Restore every affected file awaiting recovery to its proposed safe version. Safe to run
// again: restored files are skipped.
export async function restoreAll(incident, actor) {
  assertRecoverable(incident);
  const results = [];
  for (const state of await fileStates(incident)) {
    const base = { fileId: String(state.file._id), name: state.file.name };
    if (state.state !== 'AWAITING') {
      results.push({ ...base, result: state.state === 'RESTORED' ? 'ALREADY_RESTORED' : state.state });
      continue;
    }
    try {
      const outcome = await restoreFile(incident, state.file._id, state.proposed._id, actor, { finish: false, itemize: false });
      results.push({
        ...base,
        result: 'RESTORED',
        restoredName: outcome.file.name,
        fromVersion: outcome.source.versionNumber,
        newVersion: outcome.newVersion.versionNumber,
        verification: outcome.verification,
        reactivatedLinks: outcome.reactivatedLinks,
      });
    } catch (error) {
      results.push({ ...base, result: 'FAILED', error: error.code ?? 'INTERNAL_ERROR', message: error.message });
    }
  }
  const restored = results.filter((result) => result.result === 'RESTORED');
  if (restored.length) {
    const renamed = restored.filter((result) => result.restoredName !== result.name).length;
    const now = new Date();
    await pushTimeline(incident._id, [
      {
        at: now, type: 'RESTORE', actor: 'ADMIN', adminId: actor.adminId,
        text: `Restore all: ${restored.length} file${restored.length === 1 ? '' : 's'} restored to the last version before the incident`
          + (renamed ? `, ${renamed} renamed back` : ''),
      },
      {
        at: now, type: 'VERIFY', actor: 'ADMIN', adminId: actor.adminId,
        text: `SHA-256 verified for all ${restored.length} restored cop${restored.length === 1 ? 'y' : 'ies'}`,
      },
    ]);
  }
  const incidentStatus = await finishIfRecovered(incident._id, actor);
  return { results, incidentStatus };
}

// GET /api/admin/recovery: files awaiting recovery, grouped by incident.
export async function listRecovery({ incidentId } = {}) {
  const filter = { status: { $in: ACTIVE_INCIDENT_STATUSES } };
  if (incidentId) filter._id = incidentId;
  const incidents = await SecurityIncident.find(filter).sort({ createdAt: -1 });
  const users = await User.find({ _id: { $in: incidents.map((incident) => incident.userId) } }).select('name email').lean();
  const userById = new Map(users.map((user) => [String(user._id), user]));
  return Promise.all(incidents.map(async (incident) => ({
    incident,
    user: userById.get(String(incident.userId)),
    files: await fileStates(incident),
  })));
}
