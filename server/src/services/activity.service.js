import { Activity } from '../models/index.js';
import { EVENTS, publish } from '../realtime/events.js';
import { DETECTION_ACTIONS } from '../security/window.store.js';
import { paginate } from '../utils/pagination.js';

// The single activity writer (spec §9). Every operation that produces an activity event goes
// through record(); nothing else creates Activity documents.
//
// Live feed (Phase 4): an activity is published as `activity.created` as soon as it is stored,
// except a user's own write events, which detection scores first and then publishes with the
// risk level they produced (security/detection.service.js).

const SCORED_ACTIONS = Object.freeze([...DETECTION_ACTIONS, 'INTEGRITY_CHANGE']);

// Written by a signed-in user's request and scored by detection.onActivity.
export function awaitsScoring(activity) {
  return Boolean(activity?.userId && activity.sessionId) && SCORED_ACTIONS.includes(activity.action);
}

// Events a user sees about their own account. Detection-side events (INTEGRITY_CHANGE,
// CANARY_TRIGGER, QUARANTINE*, FREEZE/UNFREEZE) are internal security events and are not
// listed to users (api-contract §2.5, spec §25). Canary activity is always excluded.
export const USER_VISIBLE_ACTIONS = Object.freeze([
  'LOGIN', 'LOGOUT', 'UPLOAD', 'DOWNLOAD', 'MODIFY', 'RENAME', 'MOVE', 'DELETE',
  'SHARE', 'SHARE_REVOKE', 'SHARE_ACCESS', 'RESTORE',
]);

/**
 * @param {object} ctx       request context (utils/requestContext.js)
 * @param {string} action    one of ACTIVITY_ACTIONS
 * @param {object} [details] file, directory, before/after values and metadata
 */
export async function record(ctx, action, details = {}) {
  const { file, directory, metadata, ...fields } = details;
  const combined = file ? { fileName: file.name, ...metadata } : metadata;
  const created = await Activity.create({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    ip: ctx.ip,
    action,
    fileId: file?._id,
    directory: directory ?? file?.folderId,
    isCanary: Boolean(file?.isCanary),
    ...fields,
    // Optional values are left out rather than stored as null.
    metadata: combined && Object.fromEntries(Object.entries(combined).filter(([, value]) => value !== undefined)),
  });
  if (!awaitsScoring(created)) publish(EVENTS.ACTIVITY_CREATED, { activities: [created] });
  return created;
}

function userVisibleFilter(extra) {
  return { ...extra, action: { $in: USER_VISIBLE_ACTIONS }, isCanary: { $ne: true } };
}

export async function listForUser(userId, pageQuery) {
  const filter = userVisibleFilter({ userId });
  const { skip, limit } = paginate(pageQuery);
  const [items, total] = await Promise.all([
    Activity.find(filter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Activity.countDocuments(filter),
  ]);
  return { items, total };
}

export async function listForFile(fileId, pageQuery) {
  const filter = userVisibleFilter({ fileId });
  const { skip, limit } = paginate(pageQuery);
  const [items, total] = await Promise.all([
    Activity.find(filter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Activity.countDocuments(filter),
  ]);
  return { items, total };
}

export async function recentForUser(userId, limit) {
  return Activity.find(userVisibleFilter({ userId })).sort({ timestamp: -1, _id: -1 }).limit(limit).lean();
}

// Account and administrative-access notices for the user's Security page (spec §25). They
// deliberately carry no risk score, signal, incident, justification or administrator data.
export async function accountNoticesForUser(userId, limit) {
  const items = await Activity.find({ userId, action: { $in: ['FREEZE', 'UNFREEZE', 'ADMIN_FORENSIC_ACCESS'] } })
    .sort({ timestamp: -1, _id: -1 })
    .limit(limit)
    .lean();
  return items.map((item) => {
    if (item.action === 'ADMIN_FORENSIC_ACCESS') {
      const version = item.metadata?.versionNumber ? ` v${item.metadata.versionNumber}` : '';
      const name = item.metadata?.fileName ? `“${item.metadata.fileName}”${version}` : `a file${version}`;
      return {
        id: String(item._id),
        type: 'ADMIN_FILE_ACCESS',
        message: `An administrator accessed ${name} for an active security investigation. The access was recorded.`,
        at: item.timestamp,
      };
    }
    return {
      id: String(item._id),
      type: item.action === 'FREEZE' ? 'ACCOUNT_PAUSED' : 'ACCESS_RESTORED',
      message: item.action === 'FREEZE'
        ? 'File changes were paused while ShieldShare reviews recent activity on your account.'
        : 'File access has been restored.',
      at: item.timestamp,
    };
  });
}
