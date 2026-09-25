import mongoose from 'mongoose';
import { AdminAuditLog, Alert, FileAccessRequest, FileModel, QuarantineItem, SecurityIncident, User } from '../models/index.js';
import { paginate } from '../utils/pagination.js';

// AdminAuditLog (api-contract §3.13): every administrator security action, successful or
// not. This module only ever inserts and reads; there is no update or delete.

export async function record(entry) {
  return AdminAuditLog.create(entry);
}

// Display names for audit targets, resolved at read time.
async function targetLabels(entries) {
  const idsByKind = { User: new Set(), File: new Set(), FileAccessRequest: new Set(), QuarantineItem: new Set(), SecurityIncident: new Set(), Alert: new Set() };
  for (const entry of entries) {
    if (entry.target?.id && idsByKind[entry.target.kind]) idsByKind[entry.target.kind].add(String(entry.target.id));
  }
  const [users, files, accessRequests, items, incidents, alerts] = await Promise.all([
    User.find({ _id: { $in: [...idsByKind.User] } }).select('name email').lean(),
    FileModel.find({ _id: { $in: [...idsByKind.File] } }).select('name').lean(),
    FileAccessRequest.find({ _id: { $in: [...idsByKind.FileAccessRequest] } }).select('fileId').lean(),
    QuarantineItem.find({ _id: { $in: [...idsByKind.QuarantineItem] } }).select('fileId').lean(),
    SecurityIncident.find({ _id: { $in: [...idsByKind.SecurityIncident] } }).select('incidentNumber').lean(),
    Alert.find({ _id: { $in: [...idsByKind.Alert] } }).select('title').lean(),
  ]);
  const relatedFiles = await FileModel.find({ _id: { $in: [...items, ...accessRequests].map((item) => item.fileId) } }).select('name').lean();
  const fileName = new Map(relatedFiles.map((file) => [String(file._id), file.name]));

  const labels = new Map();
  users.forEach((user) => labels.set(`User:${user._id}`, user.email));
  files.forEach((file) => labels.set(`File:${file._id}`, file.name));
  accessRequests.forEach((request) => labels.set(`FileAccessRequest:${request._id}`, fileName.get(String(request.fileId)) ?? null));
  items.forEach((item) => labels.set(`QuarantineItem:${item._id}`, fileName.get(String(item.fileId)) ?? null));
  incidents.forEach((incident) => labels.set(`SecurityIncident:${incident._id}`, incident.incidentNumber));
  alerts.forEach((alert) => labels.set(`Alert:${alert._id}`, alert.title));
  return labels;
}

export async function list({ adminId, action, result, targetKind, targetId, from, to, page, limit }) {
  const filter = {};
  if (adminId) filter.adminId = new mongoose.Types.ObjectId(adminId);
  if (action) filter.action = action;
  if (result) filter.result = result;
  if (targetKind) filter['target.kind'] = targetKind;
  if (targetId) filter['target.id'] = new mongoose.Types.ObjectId(targetId);
  if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const { skip } = paginate({ page, limit });
  const [entries, total, actions] = await Promise.all([
    AdminAuditLog.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    AdminAuditLog.countDocuments(filter),
    AdminAuditLog.distinct('action'),
  ]);
  const [admins, labels] = await Promise.all([
    User.find({ _id: { $in: entries.map((entry) => entry.adminId) } }).select('name email').lean(),
    targetLabels(entries),
  ]);
  const adminById = new Map(admins.map((admin) => [String(admin._id), admin]));

  return {
    total,
    actions: actions.sort(),
    items: entries.map((entry) => ({
      entry,
      admin: adminById.get(String(entry.adminId)),
      targetLabel: entry.target?.id ? labels.get(`${entry.target.kind}:${entry.target.id}`) : null,
    })),
  };
}
