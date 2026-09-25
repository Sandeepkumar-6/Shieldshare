import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { FileModel, Folder, Version } from '../models/index.js';
import * as activity from '../services/activity.service.js';
import * as storage from '../services/storage.service.js';
import { measureFileEntropy } from './entropy.js';
import { sha256OfFile } from './integrity.js';

// Canary (decoy) files (spec §14). Each user's workspace gets normal File + Version records
// flagged isCanary. They are hidden from the user's UI listings, counts, storage and
// dashboard, but returned by GET /api/files?all=true, which is what automated tooling
// enumerates. Any modify / rename / move / delete on one records a CANARY_TRIGGER.

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CANARY_TEMPLATE_DIR = path.join(serverRoot, '.shieldshare', 'canary');

const MIME_BY_EXTENSION = { '.csv': 'text/csv', '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json' };

export async function listTemplates() {
  const names = await fs.readdir(CANARY_TEMPLATE_DIR);
  return names.filter((name) => !name.startsWith('.')).sort();
}

function templatePath(name) {
  const resolved = path.resolve(CANARY_TEMPLATE_DIR, name);
  if (path.dirname(resolved) !== CANARY_TEMPLATE_DIR) throw new Error('Invalid canary template name.');
  return resolved;
}

// Seeds every missing canary into the user's root folder. Idempotent: a template the user
// already has a canary for is skipped. No activity is recorded: seeding is not a user action
// and must not reach the user's activity or the detection window.
export async function seedForUser(userId) {
  const ownerId = new mongoose.Types.ObjectId(String(userId));
  const root = await Folder.findOne({ ownerId, isRoot: true });
  if (!root) throw new Error(`Root folder missing for user ${userId}`);

  const existing = new Set(
    (await FileModel.find({ ownerId, isCanary: true }).select('canaryTemplate').lean()).map((file) => file.canaryTemplate),
  );
  let created = 0;
  for (const name of await listTemplates()) {
    if (existing.has(name)) continue;
    const source = templatePath(name);
    const storageKey = await storage.importFile(source);
    try {
      const blob = storage.blobPath(storageKey);
      const [sha256, { entropy }, stat] = await Promise.all([sha256OfFile(blob), measureFileEntropy(blob), fs.stat(blob)]);
      const file = await FileModel.create({
        ownerId,
        folderId: root._id,
        name,
        storageKey,
        size: stat.size,
        mimeType: MIME_BY_EXTENSION[path.extname(name).toLowerCase()] ?? 'text/plain',
        currentVersion: 1,
        sha256,
        entropy,
        isCanary: true,
        canaryTemplate: name,
      });
      await Version.create({
        fileId: file._id,
        versionNumber: 1,
        storageKey,
        nameAtVersion: name,
        size: stat.size,
        sha256,
        entropy,
        createdBy: ownerId,
        source: 'UPLOAD',
      });
      created += 1;
    } catch (error) {
      await storage.discardUnreferencedBlob(storageKey);
      throw error;
    }
  }
  return created;
}

// Called by file operations after the main activity is recorded, when the file is a canary.
export async function recordTrigger(ctx, file, triggeringEvent) {
  return activity.record(ctx, 'CANARY_TRIGGER', {
    file,
    nameBefore: triggeringEvent.nameBefore,
    nameAfter: triggeringEvent.nameAfter,
    hashBefore: triggeringEvent.hashBefore,
    hashAfter: triggeringEvent.hashAfter,
    metadata: {
      triggeringAction: triggeringEvent.action,
      triggeringActivityId: triggeringEvent._id,
      canaryTemplate: file.canaryTemplate,
    },
  });
}

// Resets a canary from its template during recovery (spec §17: canaries are reset, not
// version-restored). Idempotent: an untouched canary is left alone.
export async function resetFromTemplate(fileId, { adminId, incidentId, ip }) {
  const file = await FileModel.findById(fileId).select('+storageKey');
  if (!file || !file.isCanary || !file.canaryTemplate) return { reset: false, reason: 'not a canary' };

  const source = templatePath(file.canaryTemplate);
  const templateHash = await sha256OfFile(source);
  const root = await Folder.findOne({ ownerId: file.ownerId, isRoot: true });
  if (
    file.status === 'ACTIVE' && file.sha256 === templateHash && file.name === file.canaryTemplate
    && String(file.folderId) === String(root?._id)
  ) {
    return { reset: false, reason: 'already in its template state', file };
  }

  const storageKey = await storage.importFile(source);
  try {
    const blob = storage.blobPath(storageKey);
    const [{ entropy }, stat] = await Promise.all([measureFileEntropy(blob), fs.stat(blob)]);
    const versionNumber = file.currentVersion + 1;
    const version = await Version.create({
      fileId: file._id,
      versionNumber,
      storageKey,
      nameAtVersion: file.canaryTemplate,
      size: stat.size,
      sha256: templateHash,
      entropy,
      createdBy: adminId,
      source: 'RESTORE',
      securityStatus: 'RESTORED',
      incidentId,
    });
    const before = { name: file.name, status: file.status, sha256: file.sha256 };
    const updated = await FileModel.findByIdAndUpdate(
      file._id,
      {
        $set: {
          storageKey, sha256: templateHash, entropy, size: stat.size, currentVersion: versionNumber,
          name: file.canaryTemplate, folderId: root._id, status: 'ACTIVE', lastVerifiedAt: new Date(),
        },
        $unset: { deletedAt: 1, quarantinedAt: 1 },
      },
      { returnDocument: 'after' },
    );
    await activity.record({ userId: file.ownerId, sessionId: null, ip: ip ?? null }, 'RESTORE', {
      file: updated,
      hashBefore: before.sha256,
      hashAfter: templateHash,
      nameBefore: before.name,
      nameAfter: file.canaryTemplate,
      metadata: { versionNumber, canaryReset: true, incidentId, actor: 'ADMIN', adminId },
    });
    return { reset: true, file: updated, version };
  } catch (error) {
    await storage.discardUnreferencedBlob(storageKey);
    throw error;
  }
}
