import mongoose from 'mongoose';
import { FileAccessRequest, FileModel, User, Version } from '../models/index.js';
import { AppError, errors } from '../utils/AppError.js';
import { paginate } from '../utils/pagination.js';
import * as storage from './storage.service.js';

export async function requestAccess(adminId, fileId, { versionId, reason }) {
  if (!mongoose.isValidObjectId(fileId)) throw errors.notFound('File not found.');
  const file = await FileModel.findById(fileId).lean();
  if (!file || file.isCanary) throw errors.notFound('File not found.');
  const version = versionId
    ? await Version.findOne({ _id: versionId, fileId: file._id }).lean()
    : await Version.findOne({ fileId: file._id, versionNumber: file.currentVersion }).lean();
  if (!version) throw errors.notFound('Version not found.');

  const existing = await FileAccessRequest.findOne({
    fileId: file._id,
    versionId: version._id,
    adminId,
    status: { $in: ['PENDING', 'APPROVED'] },
  }).sort({ createdAt: -1 }).lean();
  if (existing) {
    throw errors.conflict(
      'ACCESS_REQUEST_EXISTS',
      existing.status === 'PENDING'
        ? 'The owner has not responded to the existing request yet.'
        : 'The owner has already approved a one-time download for this version.',
    );
  }

  const request = await FileAccessRequest.create({
    fileId: file._id,
    versionId: version._id,
    versionNumber: version.versionNumber,
    ownerId: file.ownerId,
    adminId,
    reason,
  });
  return { request, file, version };
}

export async function latestByFiles(adminId, fileIds) {
  if (fileIds.length === 0) return new Map();
  const requests = await FileAccessRequest.find({ adminId, fileId: { $in: fileIds } })
    .sort({ createdAt: -1 })
    .lean();
  const result = new Map();
  for (const request of requests) {
    const key = String(request.fileId);
    if (!result.has(key)) result.set(key, request);
  }
  return result;
}

export async function listForOwner(ownerId, pageQuery) {
  const { skip, limit } = paginate(pageQuery);
  const filter = { ownerId };
  const [requests, total] = await Promise.all([
    FileAccessRequest.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    FileAccessRequest.countDocuments(filter),
  ]);
  const [files, admins] = await Promise.all([
    FileModel.find({ _id: { $in: requests.map((request) => request.fileId) } }).select('name status').lean(),
    User.find({ _id: { $in: requests.map((request) => request.adminId) } }).select('name').lean(),
  ]);
  return {
    requests,
    total,
    files: new Map(files.map((file) => [String(file._id), file])),
    admins: new Map(admins.map((admin) => [String(admin._id), admin])),
  };
}

export async function respond(ownerId, requestId, decision) {
  if (!mongoose.isValidObjectId(requestId)) throw errors.notFound('Access request not found.');
  const status = decision === 'APPROVE' ? 'APPROVED' : 'DENIED';
  const request = await FileAccessRequest.findOneAndUpdate(
    { _id: requestId, ownerId, status: 'PENDING' },
    { $set: { status, respondedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (request) return request;
  const existing = await FileAccessRequest.findOne({ _id: requestId, ownerId }).lean();
  if (!existing) throw errors.notFound('Access request not found.');
  throw errors.conflict('ACCESS_REQUEST_ALREADY_DECIDED', 'This access request has already been answered.');
}

export async function consumeApprovedAccess(adminId, requestId) {
  if (!mongoose.isValidObjectId(requestId)) throw errors.notFound('Access request not found.');
  const request = await FileAccessRequest.findOne({ _id: requestId, adminId });
  if (!request) throw errors.notFound('Access request not found.');
  if (request.status !== 'APPROVED') {
    const messages = {
      PENDING: 'The owner has not approved this request yet.',
      DENIED: 'The owner denied this access request.',
      USED: 'This one-time approval has already been used.',
    };
    throw errors.conflict('FILE_ACCESS_NOT_APPROVED', messages[request.status] ?? 'File access is not approved.');
  }

  const [file, version] = await Promise.all([
    FileModel.findOne({ _id: request.fileId, ownerId: request.ownerId }),
    Version.findOne({ _id: request.versionId, fileId: request.fileId }).select('+storageKey'),
  ]);
  if (!file || !version) throw errors.notFound('The requested file version is no longer available.');
  if (!(await storage.blobExists(version.storageKey))) {
    throw new AppError(500, 'STORAGE_UNAVAILABLE', 'The stored content for this version could not be read.');
  }

  const consumed = await FileAccessRequest.findOneAndUpdate(
    { _id: request._id, adminId, status: 'APPROVED' },
    { $set: { status: 'USED', usedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!consumed) throw errors.conflict('FILE_ACCESS_ALREADY_USED', 'This one-time approval has already been used.');
  return {
    request: consumed,
    file,
    version,
    stream: storage.createBlobReadStream(version.storageKey),
    name: version.nameAtVersion,
    size: version.size,
  };
}
