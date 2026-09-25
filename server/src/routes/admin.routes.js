import { Router } from 'express';
import { z } from 'zod';
import * as admin from '../controllers/admin.controller.js';
import * as analytics from '../controllers/analytics.controller.js';
import * as incidents from '../controllers/incident.controller.js';
import * as simulator from '../controllers/simulator.controller.js';
import { adminAction } from '../middleware/adminAction.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { objectId, validate } from '../middleware/validate.js';
import { ACTIVITY_ACTIONS } from '../models/index.js';
import { BUCKETS } from '../services/analytics.service.js';
import { SCENARIOS } from '../simulator/simulator.service.js';
import { paginationQuery } from '../utils/pagination.js';

// /api/admin/* (api-contract §2.6–2.10). Every route requires an authenticated admin; the
// role is read from the database on each request. Security actions go through
// adminAction(), which writes AdminAuditLog for successes and failures alike.
// /simulator/* is only reachable when SIMULATOR_ENABLED is exactly "true" (routes/index.js).
const router = Router();

router.use(authenticate, requireRole('admin'));

const idParams = z.object({ id: objectId });
const requiredText = (label) => z.string(`Enter a ${label}.`).trim().min(1, `Enter a ${label}.`).max(1000, `The ${label} can be at most 1000 characters.`);

// ── Users (§2.6) ───────────────────────────────────────────────────────────────────────
router.get('/users', validate({
  query: z.object({
    ...paginationQuery,
    q: z.string().trim().max(100).optional(),
    status: z.enum(['ACTIVE', 'FROZEN', 'DISABLED']).optional(),
    role: z.enum(['user', 'admin']).optional(),
  }),
}), admin.listUsers);

router.get('/users/:id', validate({ params: idParams }), admin.getUser);

router.post('/users/:id/freeze', adminAction({
  action: 'FREEZE_USER',
  targetKind: 'User',
  schemas: { params: idParams, body: z.object({ reason: requiredText('reason'), signOut: z.boolean().optional() }) },
}, admin.freezeUser));

router.post('/users/:id/unfreeze', adminAction({
  action: 'UNFREEZE_USER',
  targetKind: 'User',
  schemas: { params: idParams, body: z.object({ reason: requiredText('reason') }) },
}, admin.unfreezeUser));

// ── Files and quarantine (§2.8) ────────────────────────────────────────────────────────
router.get('/files', validate({
  query: z.object({
    ...paginationQuery,
    q: z.string().trim().max(100).optional(),
    owner: z.string().trim().max(100).optional(),
    status: z.enum(['ACTIVE', 'QUARANTINED', 'DELETED']).optional(),
    sort: z.string().max(20).optional(),
  }),
}), admin.listFiles);

router.post('/files/:id/quarantine', adminAction({
  action: 'QUARANTINE_FILE',
  targetKind: 'File',
  schemas: { params: idParams, body: z.object({ reason: requiredText('reason') }) },
}, admin.quarantineFile));

router.post('/files/:id/access-requests', adminAction({
  action: 'REQUEST_FILE_ACCESS',
  targetKind: 'File',
  schemas: {
    params: idParams,
    body: z.object({ reason: requiredText('reason'), versionId: objectId.optional() }),
  },
}, admin.requestFileAccess));

router.post('/file-access-requests/:id/download', adminAction({
  action: 'FORENSIC_DOWNLOAD',
  targetKind: 'FileAccessRequest',
  schemas: { params: idParams },
}, admin.forensicDownload));

router.get('/quarantine', validate({
  query: z.object({
    ...paginationQuery,
    status: z.enum(['QUARANTINED', 'RELEASED', 'RESTORED']).optional(),
    incidentId: objectId.optional(),
  }),
}), admin.listQuarantine);

router.post('/quarantine/:id/release', adminAction({
  action: 'RELEASE_QUARANTINE',
  targetKind: 'QuarantineItem',
  schemas: { params: idParams, body: z.object({ note: requiredText('note') }) },
}, admin.releaseQuarantine));

// ── Overview (§2.6) ────────────────────────────────────────────────────────────────────
router.get('/summary', incidents.summary);

router.get('/users/:id/activity', validate({
  params: idParams,
  query: z.object({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
}), admin.userActivity);

// ── Analytics and the global activity feed (§2.6, Phase 4) ─────────────────────────────
const dateRange = { from: z.coerce.date().optional(), to: z.coerce.date().optional() };
const actionList = z.string().max(400).optional().transform((value, ctx) => {
  if (!value) return undefined;
  const actions = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  const unknown = actions.filter((action) => !ACTIVITY_ACTIONS.includes(action));
  if (unknown.length) {
    ctx.addIssue({ code: 'custom', message: `Unknown action: ${unknown.join(', ')}.` });
    return z.NEVER;
  }
  return actions;
});

router.get('/analytics/risk-timeline', validate({
  query: z.object({ ...dateRange, bucket: z.enum(Object.keys(BUCKETS), `Bucket must be one of ${Object.keys(BUCKETS).join(', ')}.`).optional() }),
}), analytics.riskTimeline);
router.get('/analytics/severity-distribution', validate({ query: z.object(dateRange) }), analytics.severityDistribution);
router.get('/analytics/activity-distribution', validate({ query: z.object(dateRange) }), analytics.activityDistribution);

router.get('/activity', validate({
  query: z.object({
    ...paginationQuery,
    ...dateRange,
    userId: objectId.optional(),
    actions: actionList,
    severity: z.enum(['SAFE', 'SUSPICIOUS', 'HIGH', 'CRITICAL']).optional(),
  }),
}), analytics.activityFeed);

// ── Incidents and alerts (§2.7) ────────────────────────────────────────────────────────
router.get('/incidents', validate({
  query: z.object({
    ...paginationQuery,
    status: z.enum(['ACTIVE', 'OPEN', 'CONTAINED', 'INVESTIGATING', 'RECOVERED', 'RESOLVED', 'FALSE_POSITIVE']).optional(),
    severity: z.enum(['HIGH', 'CRITICAL']).optional(),
    userId: objectId.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    sort: z.string().max(20).optional(),
  }),
}), incidents.listIncidents);
router.get('/incidents/:id', validate({ params: idParams }), incidents.getIncident);
router.get('/incidents/:id/risk', validate({ params: idParams }), incidents.incidentRisk);
router.get('/incidents/:id/files', validate({ params: idParams }), incidents.incidentFiles);

router.post('/incidents/:id/investigate', adminAction({
  action: 'INVESTIGATE_INCIDENT',
  targetKind: 'SecurityIncident',
  schemas: { params: idParams },
}, incidents.investigate));

router.post('/incidents/:id/resolve', adminAction({
  action: 'RESOLVE_INCIDENT',
  targetKind: 'SecurityIncident',
  schemas: {
    params: idParams,
    body: z.object({
      resolution: z.enum(['RESOLVED', 'FALSE_POSITIVE'], 'Choose RESOLVED or FALSE_POSITIVE.'),
      note: requiredText('note'),
      unfreezeUser: z.boolean().optional(),
    }),
  },
}, incidents.resolve));

router.get('/alerts', validate({
  query: z.object({
    ...paginationQuery,
    status: z.enum(['UNREAD', 'ACKNOWLEDGED']).optional(),
    severity: z.enum(['INFO', 'SUSPICIOUS', 'HIGH', 'CRITICAL']).optional(),
    type: z.enum(['INCIDENT_CREATED', 'INCIDENT_ESCALATED', 'CANARY_TRIGGERED', 'INCIDENT_RESOLVED']).optional(),
  }),
}), incidents.listAlerts);

router.post('/alerts/:id/ack', adminAction({
  action: 'ACK_ALERT',
  targetKind: 'Alert',
  schemas: { params: idParams },
}, incidents.acknowledgeAlert));

// ── Recovery (§2.8) ────────────────────────────────────────────────────────────────────
router.get('/recovery', validate({ query: z.object({ incidentId: objectId.optional() }) }), incidents.listRecovery);

router.post('/files/:id/restore', adminAction({
  action: 'RESTORE_VERSION',
  targetKind: 'File',
  schemas: { params: idParams, body: z.object({ versionId: objectId }) },
}, incidents.restoreFile));

router.post('/incidents/:id/restore-all', adminAction({
  action: 'RESTORE_ALL',
  targetKind: 'SecurityIncident',
  schemas: { params: idParams },
}, incidents.restoreAll));

// ── Detection configuration (§2.9) ─────────────────────────────────────────────────────
const count = z.number().int('Use a whole number.').positive('Thresholds must be above 0.');
const weight = z.number().min(0, 'Weights range from 0 to 50.').max(50, 'Weights range from 0 to 50.');
const detectionConfigBody = z.object({
  windowSeconds: z.number().int().min(10, 'The window is at least 10 seconds.').max(3600, 'The window is at most 3600 seconds.').optional(),
  thresholds: z.object({
    rapidActivity: count, massModification: count, massRename: count, massDelete: count,
    directorySpread: count, extensionChanges: count, sameExtension: count,
    entropyBaselineMax: z.number().positive().max(8), entropyDeltaMin: z.number().positive().max(8),
  }).partial().strict().optional(),
  weights: z.object({
    rapidActivity: weight, massModification: weight, massRename: weight, massDelete: weight,
    directorySpread: weight, extensionChanges: weight, hashChangeRatio: weight, entropyChange: weight,
    canaryTrigger: weight, mlAnomaly: weight,
  }).partial().strict().optional(),
  severityBands: z.object({
    suspicious: z.number().positive().max(100),
    high: z.number().positive().max(100),
    critical: z.number().positive().max(100),
  }).partial().strict().optional(),
  minCategoriesForCritical: z.number().int().min(1).max(5).optional(),
  entropy: z.object({
    enabled: z.boolean(),
    partialRatio: z.number().positive().max(1),
    fullRatio: z.number().positive().max(1),
  }).partial().strict().optional(),
  ml: z.object({
    enabled: z.boolean(),
    timeoutMs: z.number().int().min(100).max(10000),
    minOperations: z.number().int().min(1).max(1000),
  }).partial().strict().optional(),
}).strict();

router.get('/config/detection', incidents.getDetectionConfig);
router.get('/config/detection/versions', incidents.listDetectionConfigVersions);
router.get('/ml/status', incidents.mlStatus);
router.put('/config/detection', adminAction({
  action: 'CONFIG_UPDATE',
  targetKind: 'DetectionConfig',
  schemas: { body: detectionConfigBody },
}, incidents.updateDetectionConfig));

// ── Controlled simulator (§2.10, spec §30) ─────────────────────────────────────────────
router.get('/simulator/status', simulator.status);
router.post('/simulator/seed', adminAction({ action: 'SIMULATOR_SEED', targetKind: 'User' }, simulator.seed));
router.post('/simulator/run', adminAction({
  action: 'SIMULATOR_RUN',
  targetKind: 'User',
  schemas: {
    body: z.object({
      scenario: z.enum(SCENARIOS, `Choose a scenario: ${SCENARIOS.join(' or ')}.`),
      paceMs: z.number().int('Use whole milliseconds.').min(20, 'Pace is at least 20 ms.').max(5000, 'Pace is at most 5000 ms.').optional(),
    }).strict(),
  },
}, simulator.run));
router.post('/simulator/reset', adminAction({ action: 'SIMULATOR_RESET', targetKind: 'User' }, simulator.reset));

// ── Audit (§2.9). Read-only: no update or delete routes exist. ─────────────────────────
router.get('/audit', validate({
  query: z.object({
    ...paginationQuery,
    adminId: objectId.optional(),
    action: z.string().max(50).optional(),
    result: z.enum(['SUCCESS', 'FAILURE']).optional(),
    targetKind: z.enum(['User', 'File', 'QuarantineItem', 'SecurityIncident', 'Alert', 'DetectionConfig']).optional(),
    targetId: objectId.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
}), admin.listAudit);

export default router;
