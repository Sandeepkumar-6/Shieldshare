import mongoose from 'mongoose';
import {
  ACTIVE_INCIDENT_STATUSES,
  Activity,
  Alert,
  FileModel,
  Folder,
  QuarantineItem,
  RiskEvaluation,
  SecurityIncident,
  Session,
  ShareLink,
  User,
  Version,
} from '../models/index.js';
import { errors } from '../utils/AppError.js';
import { escapeRegex, paginate, parseSort } from '../utils/pagination.js';
import { usableShareCounts } from './share.service.js';

// Administrator read models (api-contract §2.6, §2.8). Access is enforced by the admin
// router (authenticate + requireRole('admin')); the security actions themselves live in
// security/freeze.service.js and security/quarantine.service.js.

const toObjectIds = (values) => values.map((value) => new mongoose.Types.ObjectId(String(value)));

async function lastActivityByUser(userIds) {
  if (userIds.length === 0) return new Map();
  const rows = await Activity.aggregate([
    { $match: { userId: { $in: toObjectIds(userIds) } } },
    { $group: { _id: '$userId', last: { $max: '$timestamp' } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.last]));
}

// ── Users ──────────────────────────────────────────────────────────────────────────────

export async function listUsers({ q, status, role, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (role) filter.role = role;
  if (q) {
    const pattern = { $regex: escapeRegex(q), $options: 'i' };
    filter.$or = [{ name: pattern }, { email: pattern }];
  }
  const { skip } = paginate({ page, limit });
  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(filter),
  ]);
  const [last, open] = await Promise.all([
    lastActivityByUser(users.map((user) => user._id)),
    openIncidentsByUser(users.map((user) => user._id)),
  ]);
  return { users, total, lastActivity: last, openIncidents: open };
}

async function openIncidentsByUser(userIds) {
  if (userIds.length === 0) return new Map();
  const rows = await SecurityIncident.aggregate([
    { $match: { userId: { $in: toObjectIds(userIds) }, status: { $in: ACTIVE_INCIDENT_STATUSES } } },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((row) => [String(row._id), row.count]));
}

export async function getUser(userId) {
  if (!mongoose.isValidObjectId(userId)) throw errors.notFound('User not found.');
  const user = await User.findById(userId).lean();
  if (!user) throw errors.notFound('User not found.');

  const visible = { ownerId: user._id, status: { $ne: 'DELETED' }, isCanary: { $ne: true } };
  const [totals, activeSessions, recentActivity, last, recentEvaluations, open] = await Promise.all([
    FileModel.aggregate([{ $match: visible }, { $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: '$size' } } }]),
    Session.countDocuments({ userId: user._id, status: 'ACTIVE', expiresAt: { $gt: new Date() } }),
    Activity.find({ userId: user._id }).sort({ timestamp: -1, _id: -1 }).limit(20).lean(),
    lastActivityByUser([user._id]),
    RiskEvaluation.find({ userId: user._id }).sort({ createdAt: -1 }).limit(10).lean(),
    openIncidentsByUser([user._id]),
  ]);
  return {
    user,
    fileCount: totals[0]?.count ?? 0,
    storageBytes: totals[0]?.bytes ?? 0,
    activeSessions,
    recentActivity,
    recentEvaluations,
    openIncidents: open.get(String(user._id)) ?? 0,
    lastActivityAt: last.get(String(user._id)) ?? null,
  };
}

// GET /api/admin/users/:id/activity?from&to: everything recorded for the user in the range,
// oldest first (the incident Evidence section reads the incident window through this).
export async function userActivity(userId, { from, to, limit = 500 }) {
  if (!mongoose.isValidObjectId(userId)) throw errors.notFound('User not found.');
  if (!(await User.exists({ _id: userId }))) throw errors.notFound('User not found.');
  const filter = { userId };
  if (from || to) filter.timestamp = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  return Activity.find(filter).sort({ timestamp: 1, _id: 1 }).limit(limit).lean();
}

// Name and email of the given users (admin attribution in lists), keyed by id.
export async function usersByIds(ids) {
  const unique = [...new Set(ids.map(String))].filter((value) => mongoose.isValidObjectId(value));
  if (unique.length === 0) return new Map();
  const users = await User.find({ _id: { $in: unique } }).select('name email').lean();
  return new Map(users.map((user) => [String(user._id), { id: String(user._id), name: user.name, email: user.email }]));
}

// ── Summary (spec §20 cards) ───────────────────────────────────────────────────────────

export async function summary() {
  const now = new Date();
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [
    totalUsers, totalFiles, activeSessions, frozenUsers, openIncidents, highRiskIncidents,
    criticalIncidents, quarantinedFiles, unreadAlerts, flaggedByEvaluation, withOpenIncident,
  ] = await Promise.all([
    User.countDocuments(),
    FileModel.countDocuments({ status: { $ne: 'DELETED' }, isCanary: { $ne: true } }),
    Session.countDocuments({ status: 'ACTIVE', expiresAt: { $gt: now } }),
    User.countDocuments({ status: 'FROZEN' }),
    SecurityIncident.countDocuments({ status: { $in: ACTIVE_INCIDENT_STATUSES } }),
    SecurityIncident.countDocuments({ status: { $in: ACTIVE_INCIDENT_STATUSES }, severity: 'HIGH' }),
    SecurityIncident.countDocuments({ status: { $in: ACTIVE_INCIDENT_STATUSES }, severity: 'CRITICAL' }),
    FileModel.countDocuments({ status: 'QUARANTINED' }),
    Alert.countDocuments({ status: 'UNREAD' }),
    RiskEvaluation.distinct('userId', { createdAt: { $gte: since } }),
    SecurityIncident.distinct('userId', { status: { $in: ACTIVE_INCIDENT_STATUSES } }),
  ]);
  // "Suspicious" = at least one evaluation ≥ SUSPICIOUS in the last 24 h, or an open incident.
  const suspiciousUsers = new Set([...flaggedByEvaluation, ...withOpenIncident].map(String)).size;
  return {
    systemState: openIncidents > 0 ? 'ACTIVE_INCIDENT' : 'PROTECTED',
    totalUsers,
    totalFiles,
    activeSessions,
    safeUsers: totalUsers - suspiciousUsers,
    suspiciousUsers,
    frozenUsers,
    openIncidents,
    highRiskIncidents,
    criticalIncidents,
    quarantinedFiles,
    unreadAlerts,
  };
}

// ── Incidents and alerts ───────────────────────────────────────────────────────────────

const INCIDENT_SORT = ['createdAt', 'riskScore', 'updatedAt'];

export async function listIncidents({ status, severity, userId, from, to, sort, page, limit }) {
  const filter = {};
  if (status === 'ACTIVE') filter.status = { $in: ACTIVE_INCIDENT_STATUSES };
  else if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (userId) filter.userId = userId;
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
  const sortSpec = parseSort(sort, INCIDENT_SORT, '-createdAt');
  if (!sortSpec) throw errors.validation(`Sort by one of: ${INCIDENT_SORT.join(', ')}.`);

  const { skip } = paginate({ page, limit });
  const [incidents, total] = await Promise.all([
    SecurityIncident.find(filter).sort(sortSpec).skip(skip).limit(limit).lean(),
    SecurityIncident.countDocuments(filter),
  ]);
  const users = await User.find({ _id: { $in: incidents.map((incident) => incident.userId) } }).select('name email').lean();
  return { incidents, total, users: new Map(users.map((user) => [String(user._id), user])) };
}

export async function incidentDetail(incident) {
  const adminIds = [
    incident.assignedTo, incident.resolvedBy, ...incident.timeline.map((entry) => entry.adminId),
  ].filter(Boolean);
  const [user, files, folders, admins] = await Promise.all([
    User.findById(incident.userId).select('name email status role').lean(),
    FileModel.find({ _id: { $in: incident.affectedFiles } }).select('name status isCanary').lean(),
    Folder.find({ _id: { $in: incident.affectedDirectories } }).select('name').lean(),
    User.find({ _id: { $in: adminIds } }).select('name email').lean(),
  ]);
  return { user, files, folders, admins: new Map(admins.map((admin) => [String(admin._id), admin])) };
}

export async function incidentRisk(incident) {
  const [peak, latest] = await Promise.all([
    incident.peakEvaluationId ? RiskEvaluation.findById(incident.peakEvaluationId).lean() : null,
    incident.latestEvaluationId ? RiskEvaluation.findById(incident.latestEvaluationId).lean() : null,
  ]);
  return { peak, latest };
}

export async function listAlerts({ status, severity, type, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (severity) filter.severity = severity;
  if (type) filter.type = type;
  const { skip } = paginate({ page, limit });
  const [alerts, total, unread] = await Promise.all([
    Alert.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Alert.countDocuments(filter),
    Alert.countDocuments({ status: 'UNREAD' }),
  ]);
  const [incidents, users] = await Promise.all([
    SecurityIncident.find({ _id: { $in: alerts.map((alert) => alert.incidentId).filter(Boolean) } }).select('incidentNumber status').lean(),
    User.find({ _id: { $in: alerts.flatMap((alert) => [alert.userId, alert.acknowledgedBy]).filter(Boolean) } }).select('name email').lean(),
  ]);
  return {
    alerts,
    total,
    unread,
    incidents: new Map(incidents.map((incident) => [String(incident._id), incident])),
    users: new Map(users.map((user) => [String(user._id), user])),
  };
}

export async function acknowledgeAlert(alertId, adminId) {
  if (!mongoose.isValidObjectId(alertId)) throw errors.notFound('Alert not found.');
  const alert = await Alert.findById(alertId);
  if (!alert) throw errors.notFound('Alert not found.');
  if (alert.status === 'ACKNOWLEDGED') throw errors.conflict('INVALID_TRANSITION', 'This alert has already been acknowledged.');
  const updated = await Alert.findOneAndUpdate(
    { _id: alert._id, status: 'UNREAD' },
    { $set: { status: 'ACKNOWLEDGED', acknowledgedBy: adminId, acknowledgedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!updated) throw errors.conflict('INVALID_TRANSITION', 'This alert has already been acknowledged.');
  return updated;
}

// ── Files (all owners, every status) ───────────────────────────────────────────────────

const FILE_SORT = ['name', 'size', 'createdAt', 'updatedAt'];

export async function listFiles({ q, owner, status, sort, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (q) filter.name = { $regex: escapeRegex(q), $options: 'i' };
  if (owner) {
    const pattern = { $regex: escapeRegex(owner), $options: 'i' };
    const owners = await User.find({ $or: [{ name: pattern }, { email: pattern }] }).select('_id').lean();
    filter.ownerId = { $in: owners.map((user) => user._id) };
  }
  const sortSpec = parseSort(sort, FILE_SORT, '-updatedAt');
  if (!sortSpec) throw errors.validation(`Sort by one of: ${FILE_SORT.join(', ')}.`);

  const { skip } = paginate({ page, limit });
  const [files, total] = await Promise.all([
    FileModel.find(filter).collation({ locale: 'en', strength: 2 }).sort(sortSpec).skip(skip).limit(limit).lean(),
    FileModel.countDocuments(filter),
  ]);
  const [owners, shareCounts] = await Promise.all([
    User.find({ _id: { $in: files.map((file) => file.ownerId) } }).select('name email').lean(),
    usableShareCounts(files.map((file) => file._id)),
  ]);
  return {
    files,
    total,
    owners: new Map(owners.map((user) => [String(user._id), user])),
    shareCounts,
  };
}

export async function getFile(fileId) {
  if (!mongoose.isValidObjectId(fileId)) throw errors.notFound('File not found.');
  const file = await FileModel.findById(fileId).lean();
  if (!file) throw errors.notFound('File not found.');
  const owner = await User.findById(file.ownerId).select('name email').lean();
  return { file, owner };
}

export async function getFileVersions(fileId, { limit = 50 } = {}) {
  const { file } = await getFile(fileId);
  const versions = await Version.find({ fileId: file._id }).sort({ versionNumber: -1 }).limit(limit).lean();
  return { file, versions };
}

export async function getVersion(fileId, versionId) {
  if (!mongoose.isValidObjectId(fileId) || !mongoose.isValidObjectId(versionId)) throw errors.notFound('Version not found.');
  const version = await Version.findOne({ _id: versionId, fileId }).lean();
  if (!version) throw errors.notFound('Version not found.');
  return version;
}

// ── Quarantine ─────────────────────────────────────────────────────────────────────────

export async function listQuarantine({ status, incidentId, page, limit }) {
  const filter = {};
  if (status) filter.status = status;
  if (incidentId) filter.incidentId = new mongoose.Types.ObjectId(incidentId);
  const { skip } = paginate({ page, limit });
  const [items, total] = await Promise.all([
    QuarantineItem.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    QuarantineItem.countDocuments(filter),
  ]);

  const files = await FileModel.find({ _id: { $in: items.map((item) => item.fileId) } }).select('name status currentVersion ownerId').lean();
  const fileById = new Map(files.map((file) => [String(file._id), file]));
  const userIds = [
    ...files.map((file) => file.ownerId),
    ...items.flatMap((item) => [item.adminId, item.releasedBy]).filter(Boolean),
  ];
  const [users, versions, suspended] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('name email').lean(),
    Version.find({ _id: { $in: items.flatMap((item) => item.versionIds) } }).select('versionNumber securityStatus').lean(),
    ShareLink.aggregate([
      { $match: { suspendedByQuarantineId: { $in: items.map((item) => item._id) }, status: 'SUSPENDED' } },
      { $group: { _id: '$suspendedByQuarantineId', count: { $sum: 1 } } },
    ]),
  ]);
  const userById = new Map(users.map((user) => [String(user._id), user]));
  const versionById = new Map(versions.map((version) => [String(version._id), version]));
  const suspendedByItem = new Map(suspended.map((row) => [String(row._id), row.count]));

  return {
    total,
    items: items.map((item) => {
      const file = fileById.get(String(item.fileId));
      return {
        item,
        file,
        owner: file ? userById.get(String(file.ownerId)) : null,
        admin: item.adminId ? userById.get(String(item.adminId)) : null,
        releasedBy: item.releasedBy ? userById.get(String(item.releasedBy)) : null,
        versions: item.versionIds.map((versionId) => versionById.get(String(versionId))).filter(Boolean),
        suspendedLinks: suspendedByItem.get(String(item._id)) ?? 0,
      };
    }),
  };
}
