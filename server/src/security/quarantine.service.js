import mongoose from 'mongoose';
import { FileModel, QuarantineItem, ShareLink, Version } from '../models/index.js';
import { EVENTS, publish } from '../realtime/events.js';
import * as activity from '../services/activity.service.js';
import { errors } from '../utils/AppError.js';

// Quarantine (spec §17 "Quarantine Semantics"). Quarantine is a state change: blobs are never
// moved or deleted, so evidence stays intact. Phase 2 calls this from the admin endpoint;
// Phase 3's response service calls the same functions with actor SYSTEM and an incidentId.
//
// actor: { kind: 'ADMIN', adminId, ip } | { kind: 'SYSTEM' }

function actorMetadata(actor) {
  return actor.kind === 'ADMIN' ? { actor: 'ADMIN', adminId: actor.adminId } : { actor: 'SYSTEM' };
}

// Security events are recorded on the file owner's timeline (the subject), with the actor in
// metadata. They are internal events: users never see them in their activity lists.
function ownerContext(file, actor) {
  return { userId: file.ownerId, sessionId: null, ip: actor.ip ?? null };
}

/**
 * @param {string} fileId
 * @param {{ reason: string, incidentId?: string, versionIds?: string[], actor: object }} options
 *   versionIds: when omitted, the current version (manual quarantine). Incident containment
 *   passes the versions created inside the incident window, possibly none (a file that was
 *   only renamed keeps its pre-incident version, which is the safe one).
 *   A DELETED file can be quarantined only as part of an incident (spec §17: files deleted
 *   during the incident are contained too); its status is remembered for release.
 */
export async function quarantineFile(fileId, { reason, incidentId, versionIds, actor }) {
  if (!mongoose.isValidObjectId(fileId)) throw errors.notFound('File not found.');
  const file = await FileModel.findById(fileId);
  if (!file) throw errors.notFound('File not found.');
  const quarantinable = file.status === 'ACTIVE' || (file.status === 'DELETED' && incidentId);
  if (!quarantinable) {
    throw errors.conflict(
      'INVALID_TRANSITION',
      file.status === 'QUARANTINED' ? 'This file is already quarantined.' : 'Only active files can be quarantined.',
    );
  }

  const versions = versionIds !== undefined
    ? await Version.find({ _id: { $in: versionIds }, fileId: file._id })
    : await Version.find({ fileId: file._id, versionNumber: file.currentVersion });

  const now = new Date();
  // Conditional update: two concurrent quarantines cannot both succeed.
  const quarantined = await FileModel.findOneAndUpdate(
    { _id: file._id, status: file.status },
    { $set: { status: 'QUARANTINED', quarantinedAt: now } },
    { returnDocument: 'after', timestamps: false },
  );
  if (!quarantined) throw errors.conflict('INVALID_TRANSITION', 'This file is already quarantined.');

  let item;
  try {
    item = await QuarantineItem.create({
      fileId: file._id,
      incidentId,
      versionIds: versions.map((version) => version._id),
      reason,
      quarantinedBy: actor.kind,
      adminId: actor.kind === 'ADMIN' ? actor.adminId : undefined,
      previousFileStatus: file.status,
    });
  } catch (error) {
    await FileModel.updateOne({ _id: file._id }, { $set: { status: file.status }, $unset: { quarantinedAt: 1 } }, { timestamps: false });
    throw error;
  }

  // Links of a file deleted during the incident were already suspended by the deletion; tie
  // them to this quarantine so recovery brings them back with the file.
  if (file.status === 'DELETED') {
    await ShareLink.updateMany(
      { fileId: file._id, status: 'SUSPENDED', suspendedByQuarantineId: { $exists: false }, expiresAt: { $gt: now } },
      { $set: { suspendedByQuarantineId: item._id, ...(incidentId ? { suspendedByIncidentId: incidentId } : {}) } },
    );
  }

  await Version.updateMany(
    { _id: { $in: item.versionIds } },
    { $set: { securityStatus: 'QUARANTINED', ...(incidentId ? { incidentId } : {}) } },
  );

  // Suspend the links that currently work, remembering which quarantine suspended them.
  const suspended = await ShareLink.updateMany(
    { fileId: file._id, status: 'ACTIVE', expiresAt: { $gt: now } },
    {
      $set: {
        status: 'SUSPENDED',
        suspendedByQuarantineId: item._id,
        ...(incidentId ? { suspendedByIncidentId: incidentId } : {}),
      },
    },
  );

  await activity.record(ownerContext(file, actor), 'QUARANTINE', {
    file: quarantined,
    metadata: {
      quarantineItemId: item._id,
      quarantineReason: reason,
      incidentId,
      versionNumbers: versions.map((version) => version.versionNumber),
      suspendedLinks: suspended.modifiedCount,
      ...actorMetadata(actor),
    },
  });
  publish(EVENTS.FILE_QUARANTINED, {
    fileId: String(file._id),
    incidentId: incidentId ? String(incidentId) : null,
    name: quarantined.name,
  });

  return { file: quarantined, item, versions, suspendedLinks: suspended.modifiedCount };
}

/**
 * Release without restore (spec §17 "Releasing a False Positive"): the file returns to
 * ACTIVE at its current version, quarantined versions return to SAFE, and only the links
 * this quarantine suspended come back, if they have not expired meanwhile.
 */
export async function releaseQuarantine(itemId, { note, actor }) {
  if (!mongoose.isValidObjectId(itemId)) throw errors.notFound('Quarantine item not found.');
  const existing = await QuarantineItem.findById(itemId);
  if (!existing) throw errors.notFound('Quarantine item not found.');
  if (existing.status !== 'QUARANTINED') {
    throw errors.conflict('INVALID_TRANSITION', 'This quarantine has already been released.');
  }

  const now = new Date();
  const item = await QuarantineItem.findOneAndUpdate(
    { _id: existing._id, status: 'QUARANTINED' },
    {
      $set: {
        status: 'RELEASED',
        releasedAt: now,
        releaseNote: note,
        ...(actor.kind === 'ADMIN' ? { releasedBy: actor.adminId } : {}),
      },
    },
    { returnDocument: 'after' },
  );
  if (!item) throw errors.conflict('INVALID_TRANSITION', 'This quarantine has already been released.');

  // The file goes back to what it was: ACTIVE, or DELETED if it was deleted during an incident.
  const file = await FileModel.findOneAndUpdate(
    { _id: item.fileId, status: 'QUARANTINED' },
    { $set: { status: item.previousFileStatus ?? 'ACTIVE' }, $unset: { quarantinedAt: 1 } },
    { returnDocument: 'after', timestamps: false },
  ) ?? await FileModel.findById(item.fileId);

  // A version that was itself a restore goes back to RESTORED, every other one to SAFE, so
  // release does not erase the version's history.
  await Version.updateMany(
    { _id: { $in: item.versionIds }, securityStatus: 'QUARANTINED', source: 'RESTORE' },
    { $set: { securityStatus: 'RESTORED' }, $unset: { incidentId: 1 } },
  );
  await Version.updateMany(
    { _id: { $in: item.versionIds }, securityStatus: 'QUARANTINED' },
    { $set: { securityStatus: 'SAFE' }, $unset: { incidentId: 1 } },
  );

  // A file that returns to DELETED keeps its links suspended (spec §7); only the quarantine's
  // claim on them is cleared.
  const reactivated = file?.status === 'ACTIVE'
    ? await ShareLink.updateMany(
      { suspendedByQuarantineId: item._id, status: 'SUSPENDED', expiresAt: { $gt: now } },
      { $set: { status: 'ACTIVE' }, $unset: { suspendedByQuarantineId: 1, suspendedByIncidentId: 1 } },
    )
    : await ShareLink.updateMany(
      { suspendedByQuarantineId: item._id, status: 'SUSPENDED', expiresAt: { $gt: now } },
      { $unset: { suspendedByQuarantineId: 1, suspendedByIncidentId: 1 } },
    ).then(() => ({ modifiedCount: 0 }));
  const expired = await ShareLink.updateMany(
    { suspendedByQuarantineId: item._id, status: 'SUSPENDED', expiresAt: { $lte: now } },
    { $set: { status: 'EXPIRED' }, $unset: { suspendedByQuarantineId: 1, suspendedByIncidentId: 1 } },
  );

  await activity.record(ownerContext(file, actor), 'QUARANTINE_RELEASE', {
    file,
    metadata: {
      quarantineItemId: item._id,
      releaseNote: note,
      reactivatedLinks: reactivated.modifiedCount,
      expiredLinks: expired.modifiedCount,
      ...actorMetadata(actor),
    },
  });

  return { item, file, reactivatedLinks: reactivated.modifiedCount, expiredLinks: expired.modifiedCount };
}

// Recovery (spec §17): the file was restored to a safe version, so its quarantine for this
// incident is RESTORED. The quarantined versions stay QUARANTINED in history.
export async function markRestored(fileId, incidentId, restoredToVersion) {
  return QuarantineItem.findOneAndUpdate(
    { fileId, incidentId, status: 'QUARANTINED' },
    { $set: { status: 'RESTORED', restoredToVersion } },
    { returnDocument: 'after' },
  );
}
