import * as accountService from '../services/account.service.js';
import * as activityService from '../services/activity.service.js';
import * as fileAccess from '../services/fileAccessRequest.service.js';
import { toActivityDTO, toFileDTO, toOwnerAccessRequestDTO, toShareDTO } from '../utils/dto.js';
import { pageMeta } from '../utils/pagination.js';
import { contextFrom } from '../utils/requestContext.js';

export async function security(req, res) {
  res.json({ data: await accountService.securityStatus(contextFrom(req)) });
}

export async function activity(req, res) {
  const query = req.valid.query;
  const { items, total } = await activityService.listForUser(req.user.id, query);
  res.json({ data: items.map(toActivityDTO), meta: pageMeta(query, total) });
}

export async function dashboard(req, res) {
  const result = await accountService.dashboard(contextFrom(req));
  res.json({
    data: {
      fileCount: result.fileCount,
      storageBytes: result.storageBytes,
      recentFiles: result.recentFiles.map(toFileDTO),
      recentActivity: result.recentActivity.map(toActivityDTO),
      recentShares: result.recentShares.links.map((link) => toShareDTO(link, result.recentShares.files.get(String(link.fileId)))),
      security: result.security,
    },
  });
}

export async function fileAccessRequests(req, res) {
  const query = req.valid.query;
  const result = await fileAccess.listForOwner(req.user.id, query);
  res.json({
    data: result.requests.map((request) => toOwnerAccessRequestDTO(request, {
      file: result.files.get(String(request.fileId)),
      admin: result.admins.get(String(request.adminId)),
    })),
    meta: pageMeta(query, result.total),
  });
}

export async function respondToFileAccessRequest(req, res) {
  const request = await fileAccess.respond(req.user.id, req.valid.params.id, req.valid.body.decision);
  res.json({ data: { id: String(request._id), status: request.status, respondedAt: request.respondedAt } });
}
