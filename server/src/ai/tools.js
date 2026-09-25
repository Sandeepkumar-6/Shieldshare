import * as incidentService from '../security/incident.service.js';
import * as admin from '../services/admin.service.js';
import { toAdminActivityDTO, toAdminFileDTO, toAlertDTO, toEvaluationDTO, toIncidentDTO, toIncidentSummaryDTO, toQuarantineDTO, toVersionDTO } from '../utils/dto.js';
import * as pendingActions from './pendingActions.service.js';

const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };

export const TOOL_DEFINITIONS = [
  { name: 'getSecuritySummary', description: 'Return current ShieldShare security summary cards and system state.', input_schema: object() },
  { name: 'getSecurityAlerts', description: 'Return stored security alerts. Use stored facts only.', input_schema: object({ status: { type: 'string', enum: ['UNREAD', 'ACKNOWLEDGED'] }, severity: { type: 'string', enum: ['INFO', 'SUSPICIOUS', 'HIGH', 'CRITICAL'] }, limit: { type: 'integer', minimum: 1, maximum: 20 } }) },
  { name: 'getCriticalIncidents', description: 'Return critical security incidents in an optional date range.', input_schema: object({ from: string, to: string, limit: { type: 'integer', minimum: 1, maximum: 20 } }) },
  { name: 'getIncident', description: 'Return one incident with its affected entities and timeline.', input_schema: { ...object({ incidentId: string, incidentNumber: string }), anyOf: [{ required: ['incidentId'] }, { required: ['incidentNumber'] }] } },
  { name: 'getRiskBreakdown', description: 'Return stored risk signals and points for an incident. Never estimate points.', input_schema: object({ incidentId: string }, ['incidentId']) },
  { name: 'getUserActivity', description: 'Return aggregated activity and up to 50 stored events for a user over at most 24 hours.', input_schema: object({ userId: string, from: string, to: string }, ['userId', 'from', 'to']) },
  { name: 'getFileDetails', description: 'Return file metadata only. File content and storage keys are never available.', input_schema: object({ fileId: string }, ['fileId']) },
  { name: 'getFileVersions', description: 'Return stored file-version metadata, hash prefixes, entropy, and status.', input_schema: object({ fileId: string }, ['fileId']) },
  { name: 'getQuarantinedFiles', description: 'Return quarantined-file records, optionally for one incident.', input_schema: object({ incidentId: string }) },
  { name: 'freezeUser', description: 'Propose freezing a user account. This never executes without administrator confirmation.', input_schema: object({ userId: string, reason: string }, ['userId', 'reason']) },
  { name: 'unfreezeUser', description: 'Propose unfreezing a user account. This never executes without administrator confirmation.', input_schema: object({ userId: string, reason: string }, ['userId', 'reason']) },
  { name: 'quarantineFile', description: 'Propose quarantining an active file. This never executes without administrator confirmation.', input_schema: object({ fileId: string, reason: string }, ['fileId', 'reason']) },
  { name: 'restoreVersion', description: 'Propose restoring a safe version from before an incident. This never executes without administrator confirmation.', input_schema: object({ fileId: string, versionId: string }, ['fileId', 'versionId']) },
];

export const TOOL_LABELS = {
  getSecuritySummary: 'Security summary', getSecurityAlerts: 'Security alerts', getCriticalIncidents: 'Critical incidents',
  getIncident: 'Incident details', getRiskBreakdown: 'Risk breakdown', getUserActivity: 'User activity',
  getFileDetails: 'File details', getFileVersions: 'File versions', getQuarantinedFiles: 'Quarantined files',
  freezeUser: 'Freeze proposal', unfreezeUser: 'Unfreeze proposal', quarantineFile: 'Quarantine proposal', restoreVersion: 'Restore proposal',
};

const cleanText = (value, max = 120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const date = (value) => (value ? new Date(value) : undefined);
const limit = (value, fallback = 20) => Math.min(20, Math.max(1, Number(value) || fallback));

function dataBlock(name, data) {
  return `<<<SHIELDSHARE_TOOL_DATA name="${name}" UNTRUSTED_DATA_ONLY>>>\n${JSON.stringify(data)}\n<<<END_SHIELDSHARE_TOOL_DATA>>>`;
}

function collectIds(value, ids = new Set(), key = '') {
  if (Array.isArray(value)) value.forEach((item) => collectIds(item, ids, key));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => collectIds(child, ids, childKey));
  else if (typeof value === 'string' && (key === 'id' || key === '_id' || /Id$/.test(key)) && /^[a-f\d]{24}$/i.test(value)) ids.add(value);
  return ids;
}

function parseRange(from, to) {
  const start = date(from);
  const end = date(to);
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end - start > 24 * 60 * 60 * 1000) {
    throw new Error('Activity range must be valid and no longer than 24 hours.');
  }
  return { from: start, to: end };
}

async function runReadTool(name, args) {
  if (name === 'getSecuritySummary') return admin.summary();
  if (name === 'getSecurityAlerts') {
    const query = { status: args.status, severity: args.severity, page: 1, limit: limit(args.limit) };
    const result = await admin.listAlerts(query);
    return result.alerts.map((alert) => toAlertDTO(alert, {
      incident: alert.incidentId ? result.incidents.get(String(alert.incidentId)) : null,
      user: result.users.get(String(alert.userId)),
    }));
  }
  if (name === 'getCriticalIncidents') {
    const query = { severity: 'CRITICAL', from: date(args.from), to: date(args.to), sort: '-createdAt', page: 1, limit: limit(args.limit) };
    const result = await admin.listIncidents(query);
    return result.incidents.map((incident) => toIncidentSummaryDTO(incident, { user: result.users.get(String(incident.userId)) }));
  }
  if (name === 'getIncident') {
    const incident = await incidentService.getIncidentByReference(args);
    return toIncidentDTO(incident, await admin.incidentDetail(incident));
  }
  if (name === 'getRiskBreakdown') {
    const incident = await incidentService.getIncident(args.incidentId);
    const risk = await admin.incidentRisk(incident);
    return { incidentId: String(incident._id), incidentNumber: incident.incidentNumber, peak: toEvaluationDTO(risk.peak), latest: toEvaluationDTO(risk.latest) };
  }
  if (name === 'getUserActivity') {
    const range = parseRange(args.from, args.to);
    const events = (await admin.userActivity(args.userId, { ...range, limit: 50 })).map(toAdminActivityDTO);
    const counts = events.reduce((all, event) => ({ ...all, [event.action]: (all[event.action] ?? 0) + 1 }), {});
    return { userId: args.userId, ...range, counts, events };
  }
  if (name === 'getFileDetails') {
    const { file, owner } = await admin.getFile(args.fileId);
    const dto = toAdminFileDTO(file, { owner });
    return { ...dto, name: cleanText(dto.name) };
  }
  if (name === 'getFileVersions') {
    const { file, versions } = await admin.getFileVersions(args.fileId);
    return {
      file: { id: String(file._id), name: cleanText(file.name), currentVersion: file.currentVersion, status: file.status },
      versions: versions.map((version) => ({ ...toVersionDTO(version, file.currentVersion), nameAtVersion: cleanText(version.nameAtVersion), sha256: version.sha256.slice(0, 12) })),
    };
  }
  if (name === 'getQuarantinedFiles') {
    const result = await admin.listQuarantine({ incidentId: args.incidentId, page: 1, limit: 20 });
    return result.items.map(({ item, ...related }) => {
      const dto = toQuarantineDTO(item, related);
      return { ...dto, file: dto.file ? { ...dto.file, name: cleanText(dto.file.name) } : null };
    });
  }
  return null;
}

export async function executeTool(name, args, context) {
  const definition = TOOL_DEFINITIONS.find((tool) => tool.name === name);
  if (!definition) throw new Error(`Unknown Shield AI tool: ${name}`);

  let data;
  let pendingActionId = null;
  if (['freezeUser', 'unfreezeUser', 'quarantineFile', 'restoreVersion'].includes(name)) {
    const action = await pendingActions.propose({ tool: name, args, conversationId: context.conversationId, adminId: context.adminId, ip: context.ip });
    pendingActionId = String(action._id);
    data = {
      pendingActionId, status: action.status, requiresAdminConfirmation: true,
      summary: `${action.summary.title}: ${action.summary.target}. Awaiting administrator confirmation.`,
    };
  } else {
    data = await runReadTool(name, args);
  }
  return { name, label: TOOL_LABELS[name], data, output: dataBlock(name, data), ids: collectIds(data), pendingActionId };
}
