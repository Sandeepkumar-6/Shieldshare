import mongoose from 'mongoose';
import { ACTIVE_INCIDENT_STATUSES, FileModel, SecurityIncident, Version } from '../models/index.js';
import * as canaries from '../security/canary.service.js';
import * as detection from '../security/detection.service.js';
import { measureFileEntropy } from '../security/entropy.js';
import { verifyFileHash } from '../security/integrity.js';
import { AppError, errors } from '../utils/AppError.js';
import { validateFileName } from '../utils/filename.js';
import { escapeRegex, paginate, parseSort } from '../utils/pagination.js';
import * as activity from './activity.service.js';
import * as folders from './folder.service.js';
import * as shares from './share.service.js';
import * as storage from './storage.service.js';

// File operations (spec §6, §8, §12). Every write:
//   persists → records its Activity events → calls the detection hook once → returns.
// Blobs are immutable; every new version gets a new blob; nothing here deletes a blob that a
// record references.

const SORTABLE_FIELDS = ['name', 'size', 'createdAt', 'updatedAt'];
const RESTORABLE_STATUSES = ['SAFE', 'RESTORED'];

const versionConflict = () => errors.conflict(
  'VERSION_CONFLICT',
  'This file was changed by another request. Refresh and try again.',
);

async function findOwnedFile(ctx, fileId, { withStorageKey = false } = {}) {
  if (!mongoose.isValidObjectId(fileId)) throw errors.notFound('File not found.');
  const query = FileModel.findOne({ _id: fileId, ownerId: ctx.userId, status: { $ne: 'DELETED' } });
  if (withStorageKey) query.select('+storageKey');
  const file = await query;
  if (!file) throw errors.notFound('File not found.');
  return file;
}

async function findVersion(file, versionId) {
  if (!mongoose.isValidObjectId(versionId)) throw errors.notFound('Version not found.');
  const version = await Version.findOne({ _id: versionId, fileId: file._id }).select('+storageKey');
  if (!version) throw errors.notFound('Version not found.');
  return version;
}

// api-contract §2.3: quarantined files are read-only for non-admins.
function assertWritable(ctx, file) {
  if (file.status === 'QUARANTINED' && ctx.role !== 'admin') {
    throw errors.fileQuarantined();
  }
}

function storageUnavailable() {
  return new AppError(500, 'STORAGE_UNAVAILABLE', 'The stored content for this file could not be read.');
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────

export async function listFiles(ctx, { folderId, q, sort, all, page, limit }) {
  const filter = { ownerId: ctx.userId };
  if (!all) {
    // UI listings: no canaries, no soft-deleted files (api-contract §2.3)
    filter.status = { $ne: 'DELETED' };
    filter.isCanary = { $ne: true };
  }
  if (folderId) {
    const folder = await folders.getOwnedFolder(ctx, folderId);
    filter.folderId = folder._id;
  }
  if (q) {
    filter.name = { $regex: escapeRegex(q), $options: 'i' };
  }
  const sortSpec = parseSort(sort, SORTABLE_FIELDS, '-updatedAt');
  if (!sortSpec) {
    throw errors.validation(`Sort by one of: ${SORTABLE_FIELDS.join(', ')}.`);
  }
  const { skip } = paginate({ page, limit });
  const [items, total] = await Promise.all([
    FileModel.find(filter).collation({ locale: 'en', strength: 2 }).sort(sortSpec).skip(skip).limit(limit).lean(),
    FileModel.countDocuments(filter),
  ]);
  const shareCounts = await shares.usableShareCounts(items.map((item) => item._id));
  return { items, total, shareCounts };
}

export async function getFile(ctx, fileId) {
  const file = await findOwnedFile(ctx, fileId);
  const shareCounts = await shares.usableShareCounts([file._id]);
  return { file, shareCount: shareCounts.get(String(file._id)) ?? 0 };
}

export async function listVersions(ctx, fileId) {
  const file = await findOwnedFile(ctx, fileId);
  const versions = await Version.find({ fileId: file._id }).sort({ versionNumber: -1 }).lean();
  return { file, versions };
}

export async function listFileActivity(ctx, fileId, pageQuery) {
  const file = await findOwnedFile(ctx, fileId);
  return activity.listForFile(file._id, pageQuery);
}

// ── Upload (spec §6 Upload Flow) ───────────────────────────────────────────────────────

export async function uploadFile(ctx, { blob, folderId }) {
  let file = null;
  let committed = false;
  try {
    const folder = folderId
      ? await folders.getOwnedFolder(ctx, folderId)
      : await folders.getRootFolder(ctx.userId);

    // SHA-256 was computed while the bytes streamed to storage (middleware/upload.js).
    const { entropy } = await measureFileEntropy(storage.blobPath(blob.storageKey));

    file = await FileModel.create({
      ownerId: ctx.userId,
      folderId: folder._id,
      name: blob.name,
      storageKey: blob.storageKey,
      size: blob.size,
      mimeType: blob.mimeType,
      currentVersion: 1,
      sha256: blob.sha256,
      entropy,
    });
    const version = await Version.create({
      fileId: file._id,
      versionNumber: 1,
      storageKey: blob.storageKey,
      nameAtVersion: file.name,
      size: blob.size,
      sha256: blob.sha256,
      entropy,
      createdBy: ctx.userId,
      source: 'UPLOAD',
    });
    committed = true;

    // The activity carries the version's creation time: it is the same operation, and
    // detection compares version times against the window start (spec §8).
    const event = await activity.record(ctx, 'UPLOAD', {
      timestamp: version.createdAt,
      file,
      hashAfter: blob.sha256,
      entropyAfter: entropy,
      sizeAfter: blob.size,
      nameAfter: file.name,
      metadata: { versionNumber: 1, mimeType: blob.mimeType },
    });
    await detection.onActivity([event], ctx);

    return { file, version };
  } catch (error) {
    if (!committed) {
      if (file) await FileModel.deleteOne({ _id: file._id });
      await storage.discardUnreferencedBlob(blob.storageKey);
    }
    throw error;
  }
}

// ── Modify content (spec §6 Modify Content Flow) ───────────────────────────────────────

// Early check before accepting new bytes. modifyContent re-checks after the upload.
export async function assertModifiable(ctx, fileId) {
  assertWritable(ctx, await findOwnedFile(ctx, fileId));
}

export async function modifyContent(ctx, fileId, blob) {
  let committed = false;
  try {
    const file = await findOwnedFile(ctx, fileId);
    assertWritable(ctx, file);

    const { entropy } = await measureFileEntropy(storage.blobPath(blob.storageKey));
    const before = { versionNumber: file.currentVersion, sha256: file.sha256, entropy: file.entropy, size: file.size };
    const versionNumber = before.versionNumber + 1;

    // The unique (fileId, versionNumber) index makes concurrent modifications collide here
    // instead of silently overwriting each other.
    let version;
    try {
      version = await Version.create({
        fileId: file._id,
        versionNumber,
        storageKey: blob.storageKey,
        nameAtVersion: file.name,
        size: blob.size,
        sha256: blob.sha256,
        entropy,
        createdBy: ctx.userId,
        source: 'MODIFY',
      });
    } catch (error) {
      throw error?.code === 11000 ? versionConflict() : error;
    }

    const updated = await FileModel.findOneAndUpdate(
      { _id: file._id, currentVersion: before.versionNumber, status: file.status },
      {
        $set: { storageKey: blob.storageKey, sha256: blob.sha256, entropy, size: blob.size, currentVersion: versionNumber },
        $unset: { lastVerifiedAt: 1 }, // the new version has not been verified yet
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      await Version.deleteOne({ _id: version._id });
      throw versionConflict();
    }
    committed = true;

    const modifyEvent = await activity.record(ctx, 'MODIFY', {
      timestamp: version.createdAt,
      file: updated,
      hashBefore: before.sha256,
      hashAfter: blob.sha256,
      entropyBefore: before.entropy,
      entropyAfter: entropy,
      sizeBefore: before.size,
      sizeAfter: blob.size,
      metadata: { versionNumber },
    });
    const events = [modifyEvent];
    if (before.sha256 !== blob.sha256) {
      events.push(await activity.record(ctx, 'INTEGRITY_CHANGE', {
        timestamp: version.createdAt,
        file: updated,
        hashBefore: before.sha256,
        hashAfter: blob.sha256,
        metadata: { versionNumber, modifyActivityId: modifyEvent._id },
      }));
    }
    if (updated.isCanary) events.push(await canaries.recordTrigger(ctx, updated, modifyEvent));
    await detection.onActivity(events, ctx);

    return { file: updated, version };
  } catch (error) {
    if (!committed) await storage.discardUnreferencedBlob(blob.storageKey);
    throw error;
  }
}

// ── Rename / move ──────────────────────────────────────────────────────────────────────

export async function updateFile(ctx, fileId, { name, folderId }) {
  const file = await findOwnedFile(ctx, fileId);
  assertWritable(ctx, file);

  const newName = name === undefined ? file.name : validateFileName(name);
  const targetFolder = folderId === undefined || String(folderId) === String(file.folderId)
    ? null
    : await folders.getOwnedFolder(ctx, folderId);

  const renaming = newName !== file.name;
  const moving = targetFolder !== null;
  if (!renaming && !moving) return file;

  const $set = {};
  if (renaming) $set.name = newName;
  if (moving) $set.folderId = targetFolder._id;

  const updated = await FileModel.findOneAndUpdate(
    { _id: file._id, status: file.status },
    { $set },
    { returnDocument: 'after' },
  );
  if (!updated) throw errors.notFound('File not found.');

  const events = [];
  if (renaming) {
    events.push(await activity.record(ctx, 'RENAME', {
      file: updated,
      nameBefore: file.name,
      nameAfter: newName,
    }));
  }
  if (moving) {
    events.push(await activity.record(ctx, 'MOVE', {
      file: updated,
      directory: targetFolder._id,
      metadata: { fromFolderId: file.folderId, toFolderId: targetFolder._id },
    }));
  }
  if (updated.isCanary) events.push(await canaries.recordTrigger(ctx, updated, events[0]));
  await detection.onActivity(events, ctx);

  return updated;
}

// ── Soft delete (spec §6) ──────────────────────────────────────────────────────────────

export async function deleteFile(ctx, fileId) {
  const file = await findOwnedFile(ctx, fileId);
  assertWritable(ctx, file);

  const updated = await FileModel.findOneAndUpdate(
    { _id: file._id, status: file.status },
    { $set: { status: 'DELETED', deletedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw errors.notFound('File not found.');

  // Spec §7: links to a deleted file are suspended.
  const suspendedLinks = await shares.suspendLinksOfDeletedFile(file._id);

  // Version blobs are kept: deletion never destroys evidence or recovery points.
  const event = await activity.record(ctx, 'DELETE', {
    file: updated,
    nameBefore: file.name,
    hashBefore: file.sha256,
    entropyBefore: file.entropy,
    sizeBefore: file.size,
    metadata: suspendedLinks ? { suspendedLinks } : undefined,
  });
  const events = [event];
  if (updated.isCanary) events.push(await canaries.recordTrigger(ctx, updated, event));
  await detection.onActivity(events, ctx);
}

// ── Download ───────────────────────────────────────────────────────────────────────────

export async function openDownload(ctx, fileId, versionId) {
  const file = await findOwnedFile(ctx, fileId, { withStorageKey: true });
  assertWritable(ctx, file); // quarantined files cannot be downloaded by non-admins

  let target = {
    storageKey: file.storageKey,
    name: file.name,
    size: file.size,
    versionNumber: file.currentVersion,
  };
  if (versionId) {
    const version = await findVersion(file, versionId);
    if (version.securityStatus === 'QUARANTINED' && ctx.role !== 'admin') {
      throw errors.fileQuarantined();
    }
    target = {
      storageKey: version.storageKey,
      name: version.nameAtVersion,
      size: version.size,
      versionNumber: version.versionNumber,
    };
  }
  if (!(await storage.blobExists(target.storageKey))) throw storageUnavailable();

  await activity.record(ctx, 'DOWNLOAD', { file, metadata: { versionNumber: target.versionNumber } });

  return {
    stream: storage.createBlobReadStream(target.storageKey),
    name: target.name,
    size: target.size,
  };
}

// ── Integrity verification (spec §12) ──────────────────────────────────────────────────

export async function verifyVersion(ctx, fileId, versionId) {
  const file = await findOwnedFile(ctx, fileId);
  const version = versionId
    ? await findVersion(file, versionId)
    : await Version.findOne({ fileId: file._id, versionNumber: file.currentVersion }).select('+storageKey');
  if (!version) throw errors.notFound('Version not found.');

  const result = await verifyFileHash(storage.blobPath(version.storageKey), version.sha256);
  const verifiedAt = new Date();

  // "SHA-256 verified" may only be shown after a passing verification of the current
  // version, so a failure clears the timestamp. Verification is not a content change, so
  // updatedAt is left alone.
  if (version.versionNumber === file.currentVersion) {
    await FileModel.updateOne(
      { _id: file._id, currentVersion: version.versionNumber },
      result.passed ? { $set: { lastVerifiedAt: verifiedAt } } : { $unset: { lastVerifiedAt: 1 } },
      { timestamps: false },
    );
  }

  return {
    passed: result.passed,
    expected: result.expected,
    actual: result.actual,
    verifiedAt,
    versionNumber: version.versionNumber,
  };
}

// ── User restore of an own version (api-contract §2.3; flow mirrors spec §17) ───────────

export async function restoreVersion(ctx, fileId, versionId) {
  const file = await findOwnedFile(ctx, fileId);
  // User restore is only for files that are not under review. Incident recovery is the
  // admin flow (api-contract §2.3, §2.8): a file affected by an open incident (a HIGH
  // incident does not quarantine) is refused too, without naming the incident (spec §25).
  if (file.status === 'QUARANTINED') throw errors.fileQuarantined();
  if (await SecurityIncident.exists({ affectedFiles: file._id, status: { $in: ACTIVE_INCIDENT_STATUSES } })) {
    throw errors.conflict('FILE_UNDER_REVIEW', 'This file is under review, so its versions can\'t be restored right now.');
  }

  const source = await findVersion(file, versionId);
  if (source.versionNumber === file.currentVersion) {
    throw errors.conflict('VERSION_IS_CURRENT', 'This version is already the current version.');
  }
  if (!RESTORABLE_STATUSES.includes(source.securityStatus)) {
    throw errors.conflict('VERSION_NOT_RESTORABLE', 'Only safe versions can be restored.');
  }

  let newKey = null;
  let committed = false;
  try {
    // Copy the safe version's blob to a new key; the source blob is never modified.
    try {
      newKey = await storage.copyBlob(source.storageKey);
    } catch (error) {
      if (error.code === 'ENOENT') throw storageUnavailable();
      throw error;
    }

    // Integrity verification before the restore is marked complete.
    const verification = await verifyFileHash(storage.blobPath(newKey), source.sha256);
    if (!verification.passed) {
      throw new AppError(
        409,
        'INTEGRITY_CHECK_FAILED',
        `Restore stopped: the stored content of version ${source.versionNumber} does not match its recorded SHA-256.`,
        { expected: verification.expected, actual: verification.actual },
      );
    }

    const versionNumber = file.currentVersion + 1;
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
        createdBy: ctx.userId,
        source: 'RESTORE',
        restoredFromVersion: source.versionNumber,
        securityStatus: 'RESTORED',
      });
    } catch (error) {
      throw error?.code === 11000 ? versionConflict() : error;
    }

    const updated = await FileModel.findOneAndUpdate(
      { _id: file._id, currentVersion: file.currentVersion, status: 'ACTIVE' },
      {
        $set: {
          storageKey: newKey,
          name: source.nameAtVersion, // restore brings the name back too (spec §6 Name History)
          sha256: source.sha256,
          entropy: source.entropy,
          size: source.size,
          currentVersion: versionNumber,
          lastVerifiedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      await Version.deleteOne({ _id: newVersion._id });
      throw versionConflict();
    }
    committed = true;

    const event = await activity.record(ctx, 'RESTORE', {
      timestamp: newVersion.createdAt,
      file: updated,
      hashBefore: file.sha256,
      hashAfter: source.sha256,
      entropyBefore: file.entropy,
      entropyAfter: source.entropy,
      sizeBefore: file.size,
      sizeAfter: source.size,
      nameBefore: file.name,
      nameAfter: source.nameAtVersion,
      metadata: { versionNumber, restoredFromVersion: source.versionNumber },
    });
    await detection.onActivity([event], ctx);

    return {
      file: updated,
      newVersion,
      verification: { passed: true, expected: verification.expected, actual: verification.actual },
    };
  } catch (error) {
    if (newKey && !committed) await storage.discardUnreferencedBlob(newKey);
    throw error;
  }
}
