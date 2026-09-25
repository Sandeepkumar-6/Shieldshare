import mongoose from 'mongoose';
import { FileModel, Folder, QuarantineItem, ShareLink, Version } from '../models/index.js';
import * as storage from '../services/storage.service.js';

// Simulator reset, workspace part (spec §30 rule 8). Deletes the demo account's files,
// versions, share links, quarantine items, non-root folders and the blobs only they
// reference. Nothing else is touched:
//   - every delete filter names the demo account (ownerId / createdBy) or the demo account's
//     own file ids, and ownership is asserted before each delete runs;
//   - a blob is removed only when no remaining File or Version, of anyone, references it.
// Activity, risk evaluations, incidents, alerts and sessions are kept as history.

export class OwnershipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OwnershipError';
  }
}

function assertAll(documents, predicate, what) {
  const foreign = documents.filter((document) => !predicate(document));
  if (foreign.length) throw new OwnershipError(`Refusing to purge: ${foreign.length} ${what} outside the demo workspace matched.`);
}

export async function purgeDemoWorkspace(demoUserId) {
  const ownerId = new mongoose.Types.ObjectId(String(demoUserId));
  const isOwner = (value) => String(value) === String(ownerId);

  const files = await FileModel.find({ ownerId }).select('+storageKey ownerId').lean();
  assertAll(files, (file) => isOwner(file.ownerId), 'files');
  const fileIds = files.map((file) => file._id);
  const owned = new Set(fileIds.map(String));

  const versions = await Version.find({ fileId: { $in: fileIds } }).select('+storageKey fileId').lean();
  assertAll(versions, (version) => owned.has(String(version.fileId)), 'versions');
  const links = await ShareLink.find({ fileId: { $in: fileIds } }).select('fileId createdBy').lean();
  assertAll(links, (link) => owned.has(String(link.fileId)) && isOwner(link.createdBy), 'share links');
  const items = await QuarantineItem.find({ fileId: { $in: fileIds } }).select('fileId').lean();
  assertAll(items, (item) => owned.has(String(item.fileId)), 'quarantine items');
  const folders = await Folder.find({ ownerId, isRoot: { $ne: true } }).select('ownerId').lean();
  assertAll(folders, (folder) => isOwner(folder.ownerId), 'folders');

  const keys = new Set([...files.map((file) => file.storageKey), ...versions.map((version) => version.storageKey)].filter(Boolean));

  const [linkResult, itemResult, versionResult, fileResult, folderResult] = await Promise.all([
    ShareLink.deleteMany({ _id: { $in: links.map((link) => link._id) }, fileId: { $in: fileIds }, createdBy: ownerId }),
    QuarantineItem.deleteMany({ _id: { $in: items.map((item) => item._id) }, fileId: { $in: fileIds } }),
    Version.deleteMany({ _id: { $in: versions.map((version) => version._id) }, fileId: { $in: fileIds } }),
    FileModel.deleteMany({ _id: { $in: fileIds }, ownerId }),
    Folder.deleteMany({ _id: { $in: folders.map((folder) => folder._id) }, ownerId, isRoot: { $ne: true } }),
  ]);

  let blobs = 0;
  for (const key of keys) {
    const referenced = await Promise.all([Version.exists({ storageKey: key }), FileModel.exists({ storageKey: key })]);
    if (referenced.some(Boolean)) continue;
    await storage.discardUnreferencedBlob(key);
    blobs += 1;
  }

  return {
    files: fileResult.deletedCount,
    versions: versionResult.deletedCount,
    shareLinks: linkResult.deletedCount,
    quarantineItems: itemResult.deletedCount,
    folders: folderResult.deletedCount,
    blobs,
  };
}
