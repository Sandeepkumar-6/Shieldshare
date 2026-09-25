import * as configService from '../security/config.service.js';
import * as incidents from '../security/incident.service.js';
import * as recovery from '../security/recovery.service.js';
import { health as mlHealth } from '../security/ml.client.js';
import * as adminService from '../services/admin.service.js';
import {
  toAlertDTO,
  toEvaluationDTO,
  toIncidentDTO,
  toIncidentSummaryDTO,
  toRecoveryFileDTO,
  toVersionSummaryDTO,
} from '../utils/dto.js';
import { pageMeta } from '../utils/pagination.js';
import { clientIp } from '../utils/requestContext.js';

const actorOf = (req) => ({ adminId: req.user.id, ip: clientIp(req) });

async function incidentPayload(incident) {
  const related = await adminService.incidentDetail(incident);
  return toIncidentDTO(incident, related);
}

// ── Reads ──────────────────────────────────────────────────────────────────────────────

export async function summary(req, res) {
  res.json({ data: await adminService.summary() });
}

export async function listIncidents(req, res) {
  const query = req.valid.query;
  const { incidents: rows, total, users } = await adminService.listIncidents(query);
  res.json({
    data: rows.map((incident) => toIncidentSummaryDTO(incident, { user: users.get(String(incident.userId)) })),
    meta: pageMeta(query, total),
  });
}

export async function getIncident(req, res) {
  const incident = await incidents.getIncident(req.valid.params.id);
  res.json({ data: await incidentPayload(incident) });
}

export async function incidentRisk(req, res) {
  const incident = await incidents.getIncident(req.valid.params.id);
  const { peak, latest } = await adminService.incidentRisk(incident);
  res.json({ data: { peak: toEvaluationDTO(peak), latest: toEvaluationDTO(latest) } });
}

export async function incidentFiles(req, res) {
  const incident = await incidents.getIncident(req.valid.params.id);
  const states = await recovery.fileStates(incident);
  res.json({ data: states.map(toRecoveryFileDTO) });
}

export async function listAlerts(req, res) {
  const query = req.valid.query;
  const { alerts, total, unread, incidents: incidentById, users } = await adminService.listAlerts(query);
  res.json({
    data: alerts.map((alert) => toAlertDTO(alert, {
      incident: alert.incidentId ? incidentById.get(String(alert.incidentId)) : null,
      user: users.get(String(alert.userId)),
      acknowledgedBy: alert.acknowledgedBy ? users.get(String(alert.acknowledgedBy)) : null,
    })),
    meta: { ...pageMeta(query, total), unread },
  });
}

export async function listRecovery(req, res) {
  const groups = await recovery.listRecovery(req.valid.query);
  res.json({
    data: groups.map(({ incident, user, files }) => ({
      incident: toIncidentSummaryDTO(incident, { user }),
      files: files.map(toRecoveryFileDTO),
    })),
  });
}

export async function getDetectionConfig(req, res) {
  res.json({ data: await configService.activeConfig() });
}

// GET /api/admin/config/detection/versions: version history with who created each version.
export async function listDetectionConfigVersions(req, res) {
  const versions = await configService.listVersions();
  const admins = await adminService.usersByIds(versions.map((version) => version.createdBy).filter(Boolean));
  res.json({
    data: versions.map((version) => ({
      ...version,
      createdBy: version.createdBy ? (admins.get(version.createdBy) ?? { id: version.createdBy, name: null, email: null }) : null,
    })),
  });
}

export async function mlStatus(req, res) {
  const config = await configService.activeConfig();
  res.json({ data: await mlHealth({ timeoutMs: config.ml.timeoutMs }) });
}

// ── Audited actions (wrapped by middleware/adminAction.js) ─────────────────────────────

export async function investigate(req) {
  const { incident, before, after } = await incidents.investigate(req.valid.params.id, actorOf(req));
  return { before, after, send: async (res) => res.json({ data: await incidentPayload(incident) }) };
}

export async function resolve(req) {
  const { incident, before, after } = await incidents.resolve(req.valid.params.id, actorOf(req), req.valid.body);
  return { before, after, send: async (res) => res.json({ data: await incidentPayload(incident) }) };
}

export async function acknowledgeAlert(req) {
  const alert = await adminService.acknowledgeAlert(req.valid.params.id, req.user.id);
  return {
    before: { status: 'UNREAD' },
    after: { status: alert.status },
    send: (res) => res.json({ data: toAlertDTO(alert) }),
  };
}

export async function restoreFile(req) {
  const fileId = req.valid.params.id;
  const incident = await recovery.incidentForFile(fileId);
  const outcome = await recovery.restoreFile(incident, fileId, req.valid.body.versionId, actorOf(req));
  return {
    before: { incident: incident.incidentNumber, ...outcome.before },
    after: {
      incident: incident.incidentNumber,
      restoredFrom: outcome.source.versionNumber,
      newVersion: outcome.newVersion.versionNumber,
      name: outcome.file.name,
      verification: outcome.verification.passed ? 'passed' : 'failed',
      reactivatedLinks: outcome.reactivatedLinks,
      incidentStatus: outcome.incidentStatus,
    },
    send: (res) => res.json({
      data: {
        newVersion: toVersionSummaryDTO(outcome.newVersion),
        verification: outcome.verification,
        file: { id: String(outcome.file._id), name: outcome.file.name, status: outcome.file.status, currentVersion: outcome.file.currentVersion },
        reactivatedLinks: outcome.reactivatedLinks,
        incidentStatus: outcome.incidentStatus,
      },
    }),
  };
}

export async function restoreAll(req) {
  const incident = await incidents.getIncident(req.valid.params.id);
  const { results, incidentStatus } = await recovery.restoreAll(incident, actorOf(req));
  const count = (result) => results.filter((entry) => entry.result === result).length;
  const failed = count('FAILED');
  const after = {
    incident: incident.incidentNumber,
    restored: count('RESTORED'),
    alreadyRestored: count('ALREADY_RESTORED'),
    noSafeVersion: count('NO_SAFE_VERSION'),
    failed,
    incidentStatus,
  };
  // The response lists every file's result. A partial failure is still recorded as a failed
  // action in the audit log.
  return {
    before: { status: incident.status },
    after,
    failure: failed > 0
      ? `RESTORE_PARTIAL_FAILURE: ${results.filter((entry) => entry.result === 'FAILED').map((entry) => `${entry.name} (${entry.error})`).join(', ')}`
      : null,
    send: (res) => res.json({ data: { results, incidentStatus } }),
  };
}

export async function updateDetectionConfig(req) {
  const { before, after } = await configService.updateConfig(req.valid.body, req.user.id);
  return {
    before: { version: before.version },
    after: { version: after.version, changes: req.valid.body },
    send: (res) => res.json({ data: after }),
  };
}
