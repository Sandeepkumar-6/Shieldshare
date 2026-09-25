import mongoose from 'mongoose';
import { Activity, SecurityIncident, User } from '../models/index.js';
import { errors } from '../utils/AppError.js';
import { paginate } from '../utils/pagination.js';

// The administrators' activity feed (spec §20 "Live Feed"). GET /api/admin/activity and the
// batched `activity.created` socket event build their items here, so a feed loaded over REST
// and a feed updated live show the same thing.
//
// Item: { activityId, userId, userName, userEmail, action, fileId, fileName, isCanary,
//         severity, incidentId, actor, nameBefore, nameAfter, timestamp }
//   severity   the risk level the operation produced (scored operations), otherwise the
//              severity of the incident the event belongs to (automatic freeze, quarantine);
//              null when neither exists. Never estimated.
//   actor      USER (the account itself) | SYSTEM (automatic response) | ADMIN | PUBLIC
//              (share-link access, no account)

const id = (value) => (value == null ? null : String(value));

function actorOf(activity) {
  if (!activity.userId) return 'PUBLIC';
  if (activity.metadata?.actor === 'SYSTEM') return 'SYSTEM';
  if (activity.metadata?.actor === 'ADMIN') return 'ADMIN';
  return 'USER';
}

/**
 * @param {Array<{ activity: object, severity?: string|null, incidentId?: string|null }>} entries
 *   `severity` / `incidentId` override the stored values (the live path knows them before
 *   the annotation is written).
 */
export async function toFeedItems(entries) {
  const plain = entries.map((entry) => ({
    ...entry,
    activity: typeof entry.activity?.toObject === 'function' ? entry.activity.toObject() : entry.activity,
  }));
  const userIds = [...new Set(plain.map(({ activity }) => id(activity.userId)).filter(Boolean))];
  const incidentIds = [...new Set(plain.map(({ activity, incidentId }) => id(incidentId ?? activity.metadata?.incidentId)).filter(Boolean))];

  const [users, incidents] = await Promise.all([
    userIds.length ? User.find({ _id: { $in: userIds } }).select('name email').lean() : [],
    incidentIds.length ? SecurityIncident.find({ _id: { $in: incidentIds } }).select('severity incidentNumber').lean() : [],
  ]);
  const userById = new Map(users.map((user) => [String(user._id), user]));
  const incidentById = new Map(incidents.map((incident) => [String(incident._id), incident]));

  return plain.map(({ activity, severity, incidentId }) => {
    const user = userById.get(id(activity.userId));
    const relatedIncidentId = id(incidentId ?? activity.metadata?.incidentId);
    const incident = relatedIncidentId ? incidentById.get(relatedIncidentId) : null;
    return {
      activityId: id(activity._id),
      userId: id(activity.userId),
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
      action: activity.action,
      fileId: id(activity.fileId),
      fileName: activity.metadata?.fileName ?? null,
      isCanary: Boolean(activity.isCanary),
      severity: severity ?? activity.riskSeverity ?? incident?.severity ?? null,
      incidentId: incident ? relatedIncidentId : null,
      incidentNumber: incident?.incidentNumber ?? null,
      actor: actorOf(activity),
      nameBefore: activity.nameBefore ?? null,
      nameAfter: activity.nameAfter ?? null,
      timestamp: activity.timestamp,
    };
  });
}

// GET /api/admin/activity?page&limit&userId&actions&severity&from&to — newest first.
export async function listFeed({ userId, actions, severity, from, to, page, limit }) {
  const filter = {};
  if (userId) {
    if (!mongoose.isValidObjectId(userId)) throw errors.validation('Unknown user.');
    filter.userId = new mongoose.Types.ObjectId(String(userId));
  }
  if (actions?.length) filter.action = { $in: actions };
  if (severity) filter.riskSeverity = severity;
  if (from || to) filter.timestamp = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const { skip } = paginate({ page, limit });
  const [rows, total] = await Promise.all([
    Activity.find(filter).sort({ timestamp: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Activity.countDocuments(filter),
  ]);
  return { items: await toFeedItems(rows.map((activity) => ({ activity }))), total };
}
