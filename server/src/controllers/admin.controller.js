import { pipeline } from 'node:stream/promises';
import * as quarantine from '../security/quarantine.service.js';
import * as freeze from '../security/freeze.service.js';
import * as adminService from '../services/admin.service.js';
import * as activity from '../services/activity.service.js';
import * as fileAccess from '../services/fileAccessRequest.service.js';
import * as auditService from '../services/audit.service.js';
import {
  toAdminActivityDTO,
  toAdminFileDTO,
  toAdminUserDTO,
  toAuditDTO,
  toEvaluationDTO,
  toQuarantineDTO,
} from '../utils/dto.js';
import { pageMeta } from '../utils/pagination.js';
import { clientIp } from '../utils/requestContext.js';

const adminActor = (req) => ({ kind: 'ADMIN', adminId: req.user.id, ip: clientIp(req) });

// ── Reads ──────────────────────────────────────────────────────────────────────────────

export async function listUsers(req, res) {
  const query = req.valid.query;
  const { users, total, lastActivity, openIncidents } = await adminService.listUsers(query);
  res.json({
    data: users.map((user) => toAdminUserDTO(user, {
      lastActivityAt: lastActivity.get(String(user._id)),
      openIncidents: openIncidents.get(String(user._id)) ?? 0,
    })),
    meta: pageMeta(query, total),
  });
}

export async function getUser(req, res) {
  const detail = await adminService.getUser(req.valid.params.id);
  res.json({
    data: {
      user: toAdminUserDTO(detail.user, { lastActivityAt: detail.lastActivityAt, openIncidents: detail.openIncidents }),
      fileCount: detail.fileCount,
      storageBytes: detail.storageBytes,
      activeSessions: detail.activeSessions,
      recentActivity: detail.recentActivity.map(toAdminActivityDTO),
      recentEvaluations: detail.recentEvaluations.map(toEvaluationDTO),
    },
  });
}

export async function userActivity(req, res) {
  const items = await adminService.userActivity(req.valid.params.id, req.valid.query);
  res.json({ data: items.map(toAdminActivityDTO) });
}

export async function listFiles(req, res) {
  const query = req.valid.query;
  const { files, total, owners, shareCounts } = await adminService.listFiles(query);
  const accessRequests = await fileAccess.latestByFiles(req.user.id, files.map((file) => file._id));
  res.json({
    data: files.map((file) => toAdminFileDTO(file, {
      owner: owners.get(String(file.ownerId)),
      shareCount: shareCounts.get(String(file._id)) ?? 0,
      accessRequest: accessRequests.get(String(file._id)),
    })),
    meta: pageMeta(query, total),
  });
}

export async function listQuarantine(req, res) {
  const query = req.valid.query;
  const { items, total } = await adminService.listQuarantine(query);
  res.json({
    data: items.map(({ item, ...related }) => toQuarantineDTO(item, related)),
    meta: pageMeta(query, total),
  });
}

export async function listAudit(req, res) {
  const query = req.valid.query;
  const { items, total, actions } = await auditService.list(query);
  res.json({
    data: items.map(({ entry, admin, targetLabel }) => toAuditDTO(entry, { admin, targetLabel })),
    meta: { ...pageMeta(query, total), actions },
  });
}

// ── Audited actions (wrapped by middleware/adminAction.js) ─────────────────────────────

export async function freezeUser(req) {
  const { reason, signOut } = req.valid.body;
  const { user, before, revokedSessions } = await freeze.freezeUser(req.valid.params.id, {
    reason,
    signOut,
    actor: adminActor(req),
  });
  return {
    before,
    after: { status: user.status, signOut: Boolean(signOut), revokedSessions },
    send: (res) => res.json({ data: { user: toAdminUserDTO(user), revokedSessions } }),
  };
}

export async function unfreezeUser(req) {
  const { user, before } = await freeze.unfreezeUser(req.valid.params.id, {
    reason: req.valid.body.reason,
    actor: adminActor(req),
  });
  return {
    before,
    after: { status: user.status },
    send: (res) => res.json({ data: { user: toAdminUserDTO(user) } }),
  };
}

export async function quarantineFile(req) {
  const { file, item, versions, suspendedLinks } = await quarantine.quarantineFile(req.valid.params.id, {
    reason: req.valid.body.reason,
    actor: adminActor(req),
  });
  return {
    before: { fileStatus: 'ACTIVE' },
    after: {
      fileStatus: file.status,
      quarantineItemId: String(item._id),
      versionNumbers: versions.map((version) => version.versionNumber),
      suspendedLinks,
    },
    send: (res) => res.status(201).json({
      data: { quarantine: toQuarantineDTO(item, { file, versions, suspendedLinks }), suspendedLinks },
    }),
  };
}

export async function releaseQuarantine(req) {
  const { item, file, reactivatedLinks, expiredLinks } = await quarantine.releaseQuarantine(req.valid.params.id, {
    note: req.valid.body.note,
    actor: adminActor(req),
  });
  return {
    before: { itemStatus: 'QUARANTINED', fileStatus: 'QUARANTINED' },
    after: { itemStatus: item.status, fileStatus: file?.status ?? null, reactivatedLinks, expiredLinks },
    send: (res) => res.json({
      data: { quarantine: toQuarantineDTO(item, { file }), reactivatedLinks, expiredLinks },
    }),
  };
}

export async function requestFileAccess(req) {
  const { request, version } = await fileAccess.requestAccess(
    req.user.id,
    req.valid.params.id,
    req.valid.body,
  );
  return {
    after: { requestId: String(request._id), status: request.status, versionNumber: version.versionNumber },
    send: (res) => res.status(201).json({
      data: {
        request: {
          id: String(request._id),
          status: request.status,
          versionNumber: request.versionNumber,
          requestedAt: request.createdAt,
        },
      },
    }),
  };
}

export async function forensicDownload(req) {
  const { request, file, version, stream, name, size } = await fileAccess.consumeApprovedAccess(
    req.user.id,
    req.valid.params.id,
  );
  await activity.record(
    { userId: file.ownerId, sessionId: null, ip: clientIp(req) },
    'ADMIN_FORENSIC_ACCESS',
    {
      file,
      metadata: {
        versionNumber: version.versionNumber,
        adminId: req.user.id,
        accessRequestId: request._id,
      },
    },
  );
  return {
    after: {
      fileStatus: file.status,
      versionNumber: version.versionNumber,
      versionStatus: version.securityStatus,
      accessRequestId: String(request._id),
      ownerApproved: true,
    },
    send: async (res) => {
      res.attachment(name);
      res.type('application/octet-stream');
      res.set('Cache-Control', 'no-store');
      if (Number.isFinite(size)) res.set('Content-Length', String(size));
      try {
        await pipeline(stream, res);
      } catch (error) {
        if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error;
      }
    },
  };
}
