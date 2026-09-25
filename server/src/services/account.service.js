import mongoose from 'mongoose';
import { FileModel, Session, User } from '../models/index.js';
import * as activity from './activity.service.js';
import * as shares from './share.service.js';

// The signed-in user's own overview and security status (api-contract §2.5). Nothing here
// exposes risk scores, signals, rule names, canary information or ML output (spec §25).

export const FROZEN_NOTICE = 'File changes are paused while ShieldShare reviews recent activity on your account. '
  + 'You can still view your files. Contact your administrator if you have questions.';

export async function securityStatus(ctx) {
  const [user, activeSessions, recentNotifications] = await Promise.all([
    User.findById(ctx.userId).lean(),
    Session.countDocuments({ userId: ctx.userId, status: 'ACTIVE', expiresAt: { $gt: new Date() } }),
    activity.accountNoticesForUser(ctx.userId, 10),
  ]);
  const frozen = user?.status === 'FROZEN';
  return {
    status: frozen ? 'FROZEN' : 'ACTIVE',
    ...(frozen ? { notice: FROZEN_NOTICE } : {}),
    activeSessions,
    recentNotifications,
  };
}

export async function dashboard(ctx) {
  const ownerId = new mongoose.Types.ObjectId(ctx.userId);
  // Canaries and soft-deleted files are excluded from counts and storage (spec §14).
  const visible = { ownerId, status: { $ne: 'DELETED' }, isCanary: { $ne: true } };

  const [totals, recentFiles, recentActivity, recentShares, security] = await Promise.all([
    FileModel.aggregate([
      { $match: visible },
      { $group: { _id: null, fileCount: { $sum: 1 }, storageBytes: { $sum: '$size' } } },
    ]),
    FileModel.find(visible).sort({ updatedAt: -1, _id: -1 }).limit(5).lean(),
    activity.recentForUser(ctx.userId, 8),
    shares.recentShares(ctx, 5),
    securityStatus(ctx),
  ]);

  return {
    fileCount: totals[0]?.fileCount ?? 0,
    storageBytes: totals[0]?.storageBytes ?? 0,
    recentFiles,
    recentActivity,
    recentShares,
    security,
  };
}
