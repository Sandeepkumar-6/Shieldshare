import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import {
  Activity,
  Alert,
  FileModel,
  Folder,
  SecurityIncident,
  ShareLink,
  User,
  Version,
} from '../models/index.js';
import * as incidentService from '../security/incident.service.js';
import { entropyOfBuffer } from '../security/entropy.js';
import * as recovery from '../security/recovery.service.js';
import { hashShareToken } from '../security/shareToken.js';
import * as windowStore from '../security/window.store.js';
import * as audit from '../services/audit.service.js';
import { createUserWithWorkspace } from '../services/auth.service.js';
import * as fileService from '../services/file.service.js';
import * as storage from '../services/storage.service.js';
import { config } from '../config/env.js';
import { DEMO_PROFILES, fixtureContent, mimeTypeFor } from './demoFixtures.js';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const IP = '127.0.0.1';

const at = (millisecondsAgo) => new Date(Date.now() - millisecondsAgo);
const ctxFor = (user) => ({ userId: user._id, role: user.role, sessionId: null, ip: IP });

async function storeBuffer(buffer) {
  const storageKey = storage.newStorageKey();
  await fsp.writeFile(storage.blobPath(storageKey), buffer, { flag: 'wx' });
  return {
    storageKey,
    size: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    entropy: entropyOfBuffer(buffer),
  };
}

async function ensureFolder(userId, name) {
  if (name === 'Home') return Folder.findOne({ ownerId: userId, isRoot: true });
  return Folder.findOneAndUpdate(
    { ownerId: userId, name },
    { $setOnInsert: { ownerId: userId, name, isRoot: false } },
    { upsert: true, returnDocument: 'after' },
  );
}

async function createHistoricalFile(user, folder, name, index, { recent = false } = {}) {
  const existing = await FileModel.findOne({ ownerId: user._id, name, isCanary: false });
  if (existing) return existing;

  const createdAt = recent ? at((index + 4) * HOUR) : at((index + 3) * DAY);
  const content = fixtureContent(name, user.name);
  const blob = await storeBuffer(content);
  let file;
  try {
    file = await FileModel.create({
      ownerId: user._id,
      folderId: folder._id,
      name,
      storageKey: blob.storageKey,
      size: blob.size,
      mimeType: mimeTypeFor(name),
      currentVersion: 1,
      sha256: blob.sha256,
      entropy: blob.entropy,
      createdAt,
      updatedAt: createdAt,
    });
    const version = await Version.create({
      fileId: file._id,
      versionNumber: 1,
      storageKey: blob.storageKey,
      nameAtVersion: name,
      size: blob.size,
      sha256: blob.sha256,
      entropy: blob.entropy,
      createdBy: user._id,
      source: 'UPLOAD',
      securityStatus: 'SAFE',
      createdAt,
    });
    await Promise.all([
      FileModel.updateOne({ _id: file._id }, { $set: { createdAt, updatedAt: createdAt } }, { timestamps: false }),
      Version.updateOne({ _id: version._id }, { $set: { createdAt } }, { timestamps: false }),
      Activity.create({
        userId: user._id,
        fileId: file._id,
        action: 'UPLOAD',
        timestamp: createdAt,
        directory: folder._id,
        hashAfter: blob.sha256,
        entropyAfter: blob.entropy,
        sizeAfter: blob.size,
        nameAfter: name,
        metadata: { versionNumber: 1, mimeType: mimeTypeFor(name), seededDemoData: true },
        riskSeverity: 'SAFE',
      }),
    ]);
    return file;
  } catch (error) {
    if (!file) await storage.discardUnreferencedBlob(blob.storageKey);
    throw error;
  }
}

async function seedWorkspace(user, profile) {
  const existingFiles = await FileModel.countDocuments({ ownerId: user._id, isCanary: false });
  if (existingFiles > 0) {
    return FileModel.find({ ownerId: user._id, isCanary: false }).sort({ createdAt: 1 });
  }
  const folders = new Map();
  for (const [folderName] of profile.files) {
    if (!folders.has(folderName)) folders.set(folderName, await ensureFolder(user._id, folderName));
  }
  const files = [];
  for (const [index, [folderName, name]] of profile.files.entries()) {
    files.push(await createHistoricalFile(user, folders.get(folderName), name, index, { recent: profile.recent }));
  }
  await Activity.create({
    userId: user._id,
    action: 'LOGIN',
    timestamp: profile.recent ? at(2 * HOUR) : at(2 * DAY),
    ip: IP,
    metadata: { seededDemoData: true },
  });
  if (profile.recent && files[0]) {
    await Activity.create({
      userId: user._id,
      fileId: files[0]._id,
      action: 'DOWNLOAD',
      timestamp: at(70 * 60 * 1000),
      directory: files[0].folderId,
      metadata: { versionNumber: files[0].currentVersion, seededDemoData: true },
    });
  }
  return files;
}

function seedToken(fileId, label) {
  return crypto.createHmac('sha256', config.jwt.secret).update(`shieldshare-demo-share:${fileId}:${label}`).digest('base64url');
}

async function ensureShare(user, file, { label, permission, expiresAt, status = 'ACTIVE', createdAt: requestedAt }) {
  const existing = await ShareLink.findOne({ createdBy: user._id, recipientLabel: label });
  if (existing) return null;
  // A link can only be created after its file was uploaded (read back: the stored date is the real one).
  const { createdAt: uploadedAt } = await FileModel.findById(file._id).select('createdAt').lean();
  const createdAt = new Date(Math.max(requestedAt.getTime(), uploadedAt.getTime() + HOUR));
  const afterCreation = (millisecondsAgo) => new Date(Math.max(Date.now() - millisecondsAgo, createdAt.getTime() + 60_000));
  const token = seedToken(file._id, label);
  const link = await ShareLink.create({
    fileId: file._id,
    createdBy: user._id,
    tokenHash: hashShareToken(token),
    permission,
    recipientLabel: label,
    expiresAt,
    status,
    revokedAt: status === 'REVOKED' ? afterCreation(12 * HOUR) : undefined,
    accessCount: status === 'ACTIVE' ? 2 : 0,
    lastAccessedAt: status === 'ACTIVE' ? afterCreation(5 * HOUR) : undefined,
    createdAt,
    updatedAt: createdAt,
  });
  await Promise.all([
    ShareLink.updateOne({ _id: link._id }, { $set: { createdAt, updatedAt: createdAt } }, { timestamps: false }),
    Activity.create({
      userId: user._id,
      fileId: file._id,
      action: 'SHARE',
      timestamp: createdAt,
      directory: file.folderId,
      metadata: { shareLinkId: link._id, permission, expiresAt, recipientLabel: label, passwordProtected: false, seededDemoData: true },
    }),
  ]);
  return { id: link._id, label, url: `${config.clientOrigin}/s/${token}`, status };
}

async function removeDuplicateSeedShares(user) {
  const links = await ShareLink.find({
    createdBy: user._id,
    recipientLabel: { $regex: '@shieldshare\\.demo$' },
  }).sort({ createdAt: 1, _id: 1 });
  const seen = new Set();
  const duplicateIds = [];
  for (const link of links) {
    if (seen.has(link.recipientLabel)) duplicateIds.push(link._id);
    else seen.add(link.recipientLabel);
  }
  if (!duplicateIds.length) return 0;
  await Promise.all([
    ShareLink.deleteMany({ _id: { $in: duplicateIds } }),
    Activity.deleteMany({
      userId: user._id,
      action: 'SHARE',
      'metadata.seededDemoData': true,
      'metadata.shareLinkId': { $in: duplicateIds },
    }),
  ]);
  return duplicateIds.length;
}

async function seedShares(user, files, varied) {
  if (!files.length) return [];
  const created = [];
  const active = await ensureShare(user, files[0], {
    label: 'project-review@shieldshare.demo', permission: 'DOWNLOAD', expiresAt: new Date(Date.now() + 14 * DAY), createdAt: at(4 * DAY),
  });
  if (active) created.push(active);
  const expiring = await ensureShare(user, files[Math.min(1, files.length - 1)], {
    label: 'external-reviewer@shieldshare.demo', permission: 'VIEW', expiresAt: new Date(Date.now() + 2 * DAY), createdAt: at(2 * DAY),
  });
  if (expiring) created.push(expiring);
  if (varied) {
    await ensureShare(user, files[0], {
      label: 'former-vendor@shieldshare.demo', permission: 'VIEW', expiresAt: new Date(Date.now() + 10 * DAY), status: 'REVOKED', createdAt: at(10 * DAY),
    });
    await ensureShare(user, files[Math.min(2, files.length - 1)], {
      label: 'expired-review@shieldshare.demo', permission: 'DOWNLOAD', expiresAt: at(DAY), status: 'EXPIRED', createdAt: at(20 * DAY),
    });
  }
  return created;
}

function attackBuffer(seed, length = 4096) {
  const chunks = [];
  let counter = 0;
  while (Buffer.concat(chunks).length < length) {
    chunks.push(crypto.createHash('sha256').update(`${seed}:${counter}`).digest());
    counter += 1;
  }
  return Buffer.concat(chunks).subarray(0, length);
}

async function blobForAttack(name, seed) {
  const stored = await storeBuffer(attackBuffer(seed));
  return { ...stored, name, mimeType: mimeTypeFor(name) };
}

async function seedSecurityEvent(user) {
  if (await Alert.exists({ userId: user._id, type: 'CANARY_TRIGGERED' })) return;
  const canary = await FileModel.findOne({ ownerId: user._id, isCanary: true });
  if (!canary) return;
  windowStore.resetUser(user._id);
  await fileService.modifyContent(ctxFor(user), canary._id, await blobForAttack(canary.name, `${user.email}:canary`));
}

async function createIncident(user, files) {
  const existing = await SecurityIncident.findOne({ userId: user._id }).sort({ createdAt: -1 });
  if (existing) return existing;
  windowStore.resetUser(user._id);
  const context = ctxFor(user);
  for (const [index, original] of files.slice(0, 8).entries()) {
    const currentUser = await User.findById(user._id).select('status');
    if (currentUser.status === 'FROZEN') break;
    const current = await FileModel.findById(original._id);
    await fileService.modifyContent(context, current._id, await blobForAttack(current.name, `${user.email}:${index}`));
    const afterModify = await User.findById(user._id).select('status');
    if (afterModify.status === 'FROZEN') break;
    await fileService.updateFile(context, current._id, { name: `${current.name}.locked` });
  }
  const afterWrites = await User.findById(user._id).select('status');
  if (afterWrites.status !== 'FROZEN') {
    const canary = await FileModel.findOne({ ownerId: user._id, isCanary: true });
    if (canary) await fileService.modifyContent(context, canary._id, await blobForAttack(canary.name, `${user.email}:incident-canary`));
  }
  return SecurityIncident.findOne({ userId: user._id, status: { $in: ['OPEN', 'CONTAINED', 'INVESTIGATING'] } }).sort({ createdAt: -1 });
}

// The administrator's recovery goes through the same services as the admin routes, and is
// written to AdminAuditLog the way adminAction() records it, so the seeded history is complete.
async function recoverIncident(incident, admin) {
  if (!incident || ['RESOLVED', 'FALSE_POSITIVE'].includes(incident.status)) return incident;
  const actor = { adminId: admin._id, ip: IP };
  const auditEntry = { adminId: admin._id, target: { kind: 'SecurityIncident', id: incident._id }, via: 'UI', ip: IP };
  const current = await SecurityIncident.findById(incident._id);
  if (['OPEN', 'CONTAINED', 'INVESTIGATING'].includes(current.status)) {
    const { results, incidentStatus } = await recovery.restoreAll(current, actor);
    const count = (result) => results.filter((entry) => entry.result === result).length;
    await audit.record({
      ...auditEntry,
      action: 'RESTORE_ALL',
      before: { status: current.status },
      after: {
        incident: current.incidentNumber,
        restored: count('RESTORED'),
        alreadyRestored: count('ALREADY_RESTORED'),
        noSafeVersion: count('NO_SAFE_VERSION'),
        failed: count('FAILED'),
        incidentStatus,
      },
      result: count('FAILED') > 0 ? 'FAILURE' : 'SUCCESS',
    });
  }
  const recovered = await SecurityIncident.findById(incident._id);
  if (recovered.status === 'RECOVERED') {
    const note = 'Demo recovery completed; every available safe version passed SHA-256 verification.';
    const { before, after } = await incidentService.resolve(recovered._id, actor, {
      resolution: 'RESOLVED',
      note,
      unfreezeUser: true,
    });
    await audit.record({ ...auditEntry, action: 'RESOLVE_INCIDENT', before, after, note, result: 'SUCCESS' });
  }
  return SecurityIncident.findById(incident._id);
}

async function ensureDemoUser(profile, password) {
  let user = await User.findOne({ email: profile.email });
  let created = false;
  if (!user) {
    user = await createUserWithWorkspace({ name: profile.name, email: profile.email, password, role: 'user' });
    created = true;
  }
  return { user, created };
}

export async function seedRealisticDemoData({ password, admin }) {
  const report = { usersCreated: 0, usersExisting: 0, files: 0, incidents: [], shares: [] };
  for (const profile of DEMO_PROFILES) {
    const { user, created } = await ensureDemoUser(profile, password);
    report[created ? 'usersCreated' : 'usersExisting'] += 1;
    await removeDuplicateSeedShares(user);
    let files = await seedWorkspace(user, profile);
    report.files += files.length;
    if (profile.shares) report.shares.push(...await seedShares(user, files, profile.variedShares));
    if (profile.securityEvent) await seedSecurityEvent(user);
    if (profile.incident) {
      const existingLink = await ensureShare(user, files[0], {
        label: `${profile.incident}-review@shieldshare.demo`, permission: 'DOWNLOAD', expiresAt: new Date(Date.now() + 14 * DAY), createdAt: at(3 * DAY),
      });
      if (existingLink) report.shares.push(existingLink);
      const incident = await createIncident(user, files);
      const finalIncident = profile.incident === 'recovered' ? await recoverIncident(incident, admin) : incident;
      if (finalIncident) report.incidents.push({ number: finalIncident.incidentNumber, status: finalIncident.status, user: user.email });
    }
  }
  // Containment suspends a contained user's links after they were created: report the
  // status each link has now, not the one it was created with.
  const current = await ShareLink.find({ _id: { $in: report.shares.map((share) => share.id) } }).select('status').lean();
  const statusById = new Map(current.map((link) => [String(link._id), link.status]));
  report.shares = report.shares.map(({ id, ...share }) => ({ ...share, status: statusById.get(String(id)) ?? share.status }));
  return report;
}
