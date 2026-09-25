import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { FileModel, ShareLink } from '../models/index.js';
import * as detection from '../security/detection.service.js';
import {
  SHARE_TOKEN_PATTERN,
  hashShareToken,
  issueShareAccessToken,
  newShareToken,
  verifyShareAccessToken,
} from '../security/shareToken.js';
import { AppError, errors } from '../utils/AppError.js';
import { paginate } from '../utils/pagination.js';
import * as activity from './activity.service.js';
import * as storage from './storage.service.js';

// Link-based sharing (spec §7, api-contract §2.4). A link works only while
//   link.status === ACTIVE && link.expiresAt > now && file.status === ACTIVE
// and every other case answers the public with the same 410.

const BCRYPT_ROUNDS = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── Owner operations ───────────────────────────────────────────────────────────────────

async function findOwnedLiveFile(ctx, fileId) {
  if (!mongoose.isValidObjectId(fileId)) throw errors.notFound('File not found.');
  const file = await FileModel.findOne({ _id: fileId, ownerId: ctx.userId, status: { $ne: 'DELETED' } });
  if (!file) throw errors.notFound('File not found.');
  return file;
}

export async function createShare(ctx, fileId, { permission, expiresAt, recipientLabel, password }) {
  const file = await findOwnedLiveFile(ctx, fileId);
  // No new links for a file under review, for anyone (spec §17).
  if (file.status !== 'ACTIVE') throw errors.fileQuarantined();

  const expiry = new Date(expiresAt);
  const now = Date.now();
  if (expiry.getTime() <= now) {
    throw errors.validation('Choose an expiry in the future.');
  }
  if (expiry.getTime() > now + config.share.maxExpiryDays * DAY_MS) {
    throw errors.validation(`Links can last at most ${config.share.maxExpiryDays} days.`);
  }

  const token = newShareToken();
  const link = await ShareLink.create({
    fileId: file._id,
    createdBy: ctx.userId,
    tokenHash: hashShareToken(token),
    permission,
    recipientLabel: recipientLabel || undefined,
    passwordHash: password ? await bcrypt.hash(password, BCRYPT_ROUNDS) : undefined,
    expiresAt: expiry,
  });

  const event = await activity.record(ctx, 'SHARE', {
    file,
    metadata: {
      shareLinkId: link._id,
      permission,
      expiresAt: expiry,
      recipientLabel: link.recipientLabel,
      passwordProtected: Boolean(password),
    },
  });
  await detection.onActivity([event], ctx);

  // The raw token leaves the server exactly once, here.
  return { link, file, token, url: `${config.clientOrigin}/s/${token}` };
}

function statusFilter(status, now) {
  switch (status) {
    case 'ACTIVE':
      return { status: 'ACTIVE', expiresAt: { $gt: now } };
    case 'SUSPENDED':
      return { status: 'SUSPENDED', expiresAt: { $gt: now } };
    case 'REVOKED':
      return { status: 'REVOKED' };
    case 'EXPIRED':
      return { status: { $ne: 'REVOKED' }, $or: [{ status: 'EXPIRED' }, { expiresAt: { $lte: now } }] };
    default:
      return {};
  }
}

async function filesById(fileIds) {
  const files = await FileModel.find({ _id: { $in: fileIds } }).select('name status').lean();
  return new Map(files.map((file) => [String(file._id), file]));
}

export async function listShares(ctx, { fileId, status, page, limit }) {
  const filter = { createdBy: ctx.userId, ...statusFilter(status, new Date()) };
  if (fileId) {
    const file = await findOwnedLiveFile(ctx, fileId);
    filter.fileId = file._id;
  }
  const { skip } = paginate({ page, limit });
  const [links, total] = await Promise.all([
    ShareLink.find(filter).select('+passwordHash').sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    ShareLink.countDocuments(filter),
  ]);
  return { links, total, files: await filesById(links.map((link) => link.fileId)) };
}

export async function recentShares(ctx, limit) {
  const links = await ShareLink.find({ createdBy: ctx.userId })
    .select('+passwordHash')
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean();
  return { links, files: await filesById(links.map((link) => link.fileId)) };
}

export async function revokeShare(ctx, linkId) {
  if (!mongoose.isValidObjectId(linkId)) throw errors.notFound('Share link not found.');
  const link = await ShareLink.findOne({ _id: linkId, createdBy: ctx.userId });
  if (!link) throw errors.notFound('Share link not found.');
  if (link.status === 'REVOKED') {
    throw errors.conflict('INVALID_TRANSITION', 'This link has already been revoked.');
  }

  // Revoking is allowed while the file is under review: it only reduces exposure.
  const revoked = await ShareLink.findOneAndUpdate(
    { _id: link._id, status: { $ne: 'REVOKED' } },
    { $set: { status: 'REVOKED', revokedAt: new Date() }, $unset: { suspendedByQuarantineId: 1 } },
    { returnDocument: 'after' },
  ).select('+passwordHash');
  if (!revoked) throw errors.conflict('INVALID_TRANSITION', 'This link has already been revoked.');

  const file = await FileModel.findById(link.fileId);
  const event = await activity.record(ctx, 'SHARE_REVOKE', {
    file,
    metadata: { shareLinkId: link._id, permission: link.permission, recipientLabel: link.recipientLabel },
  });
  await detection.onActivity([event], ctx);
  return { link: revoked, file };
}

// Links currently usable, per file (for the file list's shareCount).
export async function usableShareCounts(fileIds) {
  if (fileIds.length === 0) return new Map();
  const rows = await ShareLink.aggregate([
    { $match: { fileId: { $in: fileIds.map((value) => new mongoose.Types.ObjectId(String(value))) }, status: 'ACTIVE', expiresAt: { $gt: new Date() } } },
    { $group: { _id: '$fileId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

// Spec §7: links to a deleted file are suspended. Returns how many were suspended.
export async function suspendLinksOfDeletedFile(fileId) {
  const result = await ShareLink.updateMany(
    { fileId, status: 'ACTIVE' },
    { $set: { status: 'SUSPENDED' } },
  );
  return result.modifiedCount;
}

// ── Public access (no authentication) ─────────────────────────────────────────────────

// Resolves a raw URL token to a usable link and file, or throws the one generic 410.
async function resolveUsableLink(token) {
  if (typeof token !== 'string' || !SHARE_TOKEN_PATTERN.test(token)) throw errors.linkUnavailable();
  const link = await ShareLink.findOne({ tokenHash: hashShareToken(token) }).select('+passwordHash');
  if (!link || link.status !== 'ACTIVE' || link.expiresAt.getTime() <= Date.now()) {
    throw errors.linkUnavailable();
  }
  const file = await FileModel.findById(link.fileId).select('+storageKey');
  if (!file || file.status !== 'ACTIVE') throw errors.linkUnavailable();
  return { link, file };
}

// SHARE_ACCESS (spec §9: a download or view through a share link). No user, no session.
async function recordAccess(ctx, link, file, accessType) {
  await Promise.all([
    activity.record({ userId: null, sessionId: null, ip: ctx.ip }, 'SHARE_ACCESS', {
      file,
      metadata: {
        shareLinkId: link._id,
        accessType,
        permission: link.permission,
        recipientLabel: link.recipientLabel,
      },
    }),
    ShareLink.updateOne(
      { _id: link._id },
      { $inc: { accessCount: 1 }, $set: { lastAccessedAt: new Date() } },
      { timestamps: false },
    ),
  ]);
}

export async function publicMetadata(ctx, token) {
  const { link, file } = await resolveUsableLink(token);
  // A view is counted when the recipient can actually see the file's details without a
  // password; for protected links the successful unlock is the view.
  if (!link.passwordHash) await recordAccess(ctx, link, file, 'VIEW');
  return { link, file };
}

export async function unlock(ctx, token, password) {
  const { link, file } = await resolveUsableLink(token);
  if (!link.passwordHash) {
    return { accessToken: null, expiresAt: null };
  }
  if (!(await bcrypt.compare(password, link.passwordHash))) {
    throw new AppError(401, 'SHARE_PASSWORD_INVALID', 'That password is incorrect.');
  }
  await recordAccess(ctx, link, file, 'VIEW');
  const { token: accessToken, expiresAt } = issueShareAccessToken(link._id);
  return { accessToken, expiresAt };
}

export async function openPublicDownload(ctx, token, accessToken) {
  const { link, file } = await resolveUsableLink(token);
  if (link.permission !== 'DOWNLOAD') {
    throw new AppError(403, 'SHARE_DOWNLOAD_NOT_ALLOWED', 'This link lets you view the file details but not download the file.');
  }
  if (link.passwordHash && !verifyShareAccessToken(accessToken, link._id)) {
    throw new AppError(401, 'SHARE_PASSWORD_REQUIRED', 'Enter the password for this link to download the file.');
  }
  if (!(await storage.blobExists(file.storageKey))) {
    throw new AppError(500, 'STORAGE_UNAVAILABLE', 'The file could not be read. Try again later.');
  }
  await recordAccess(ctx, link, file, 'DOWNLOAD');
  // Always the file's current version.
  return { stream: storage.createBlobReadStream(file.storageKey), name: file.name, size: file.size };
}
