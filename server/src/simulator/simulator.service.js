import { randomUUID } from 'node:crypto';
import { config } from '../config/env.js';
import { ACTIVE_INCIDENT_STATUSES, FileModel, Folder, SecurityIncident, User, Version } from '../models/index.js';
import { EVENTS, publish } from '../realtime/events.js';
import { seedForUser } from '../security/canary.service.js';
import { activeConfig } from '../security/config.service.js';
import * as freeze from '../security/freeze.service.js';
import * as incidents from '../security/incident.service.js';
import * as windowStore from '../security/window.store.js';
import * as audit from '../services/audit.service.js';
import { AppError, errors } from '../utils/AppError.js';
import { SimulatorHttpError, createApiClient } from './apiClient.js';
import { DEMO_FOLDERS, SeedPathError } from './demoData.js';
import { purgeDemoWorkspace } from './demoWorkspace.js';
import * as scenarios from './scenarios.js';

// Controlled simulator (spec §30). Hard restrictions, all enforced here or in the route gate:
//   1. Every route answers 404 unless SIMULATOR_ENABLED === 'true' (routes/index.js).
//   2. Started only by an administrator through the API (the CLI is a client of that API).
//   3. Acts only as SIMULATOR_DEMO_USER_EMAIL, and refuses when that account is missing, is
//      an administrator, or is not flagged as the demo account (isDemoUser, set by the seed).
//   4. Acts only through the HTTP API (apiClient.js); it never calls services for the demo
//      user's actions and never writes files to disk.
//   5. Reads seed files only from server/demo-data/ (demoData.js, realpath-checked).
//   6. Reset deletes only the demo account's records (demoWorkspace.js).
// One simulator job (seed, run or reset) at a time; the state lives in this process.

export const SCENARIOS = Object.freeze(['ransomware-like', 'normal-use']);
export const DEFAULT_PACE_MS = { 'ransomware-like': 150, 'normal-use': 1500 };

let baseUrl = null;
let busy = null; // { kind: 'seed' | 'run' | 'reset', since }
let lastRun = null;

export function configureSimulator(options) {
  baseUrl = options.baseUrl;
}

const unavailable = (message) => new AppError(409, 'DEMO_USER_UNAVAILABLE', message);

// Restriction 3. Returns the demo account or throws DEMO_USER_UNAVAILABLE.
export async function demoUser() {
  const email = config.simulator.demoUserEmail;
  if (!email) throw unavailable('No demo account is configured. Set SIMULATOR_DEMO_USER_EMAIL in server/.env.');
  const user = await User.findOne({ email });
  if (!user) throw unavailable(`The demo account ${email} does not exist. Run npm run seed to create it.`);
  if (user.role === 'admin') throw unavailable('The configured demo account is an administrator. The simulator only runs as a normal user account.');
  if (!user.isDemoUser) throw unavailable(`${email} is not flagged as the demo account. Run npm run seed to create or flag it.`);
  return user;
}

function acquire(kind) {
  if (busy) {
    const doing = { seed: 'seeding the demo workspace', run: 'running a scenario', reset: 'resetting the demo workspace' }[busy.kind];
    throw errors.conflict('SIMULATOR_BUSY', `The simulator is already ${doing}. Wait for it to finish.`);
  }
  busy = { kind, since: new Date() };
}

function release() {
  busy = null;
}

// A failure of the simulator's own HTTP calls or seed data, as an API error for the admin.
function asAppError(error) {
  if (error instanceof AppError) return error;
  if (error instanceof SimulatorHttpError) {
    if (error.status === 423) return errors.conflict('DEMO_USER_FROZEN', 'The demo account is frozen. Reset the demo workspace first.');
    return errors.conflict('SIMULATOR_FAILED', `The simulator's request failed: ${error.status} ${error.code}. ${error.message}`);
  }
  if (error instanceof SeedPathError) return new AppError(500, 'SEED_DATA_INVALID', `The demo seed data could not be read: ${error.message}`);
  return error;
}

function progressReporter(run) {
  return (event) => {
    if (run) {
      run.step = event.step;
      run.total = event.total;
      run.lastAction = event.lastAction;
    }
    publish(EVENTS.SIMULATOR_PROGRESS, event);
  };
}

async function signedInClient(user) {
  if (!config.simulator.demoUserPassword) {
    throw unavailable('Set SIMULATOR_DEMO_USER_PASSWORD in server/.env so the simulator can sign in as the demo account.');
  }
  const api = createApiClient(baseUrl);
  try {
    await api.login(user.email, config.simulator.demoUserPassword);
  } catch (error) {
    throw unavailable(`The simulator could not sign in as ${user.email} (${error.code ?? error.message}). Check SIMULATOR_DEMO_USER_PASSWORD.`);
  }
  return api;
}

// Seed uploads inside the detection window would make the burst's window start before them,
// leaving the demo files without a version from before the incident to restore (spec §8).
async function readyAt(user) {
  const folders = await Folder.find({ ownerId: user._id, name: { $in: DEMO_FOLDERS } }).select('_id').lean();
  if (!folders.length) return null;
  const files = await FileModel.find({ ownerId: user._id, folderId: { $in: folders.map((folder) => folder._id) }, isCanary: { $ne: true } }).select('_id').lean();
  if (!files.length) return null;
  const newest = await Version.findOne({ fileId: { $in: files.map((file) => file._id) }, source: 'UPLOAD' })
    .sort({ createdAt: -1 }).select('createdAt').lean();
  if (!newest) return null;
  const { windowSeconds } = await activeConfig();
  return new Date(newest.createdAt.getTime() + (windowSeconds + 1) * 1000);
}

// ── Status ──────────────────────────────────────────────────────────────────────────────

export async function status() {
  let user = null;
  let problem = null;
  try {
    user = await demoUser();
  } catch (error) {
    problem = error.message;
  }
  const workspace = user
    ? {
      files: await FileModel.countDocuments({ ownerId: user._id, isCanary: { $ne: true }, status: { $ne: 'DELETED' } }),
      quarantined: await FileModel.countDocuments({ ownerId: user._id, isCanary: { $ne: true }, status: 'QUARANTINED' }),
      openIncidents: await SecurityIncident.countDocuments({ userId: user._id, status: { $in: ACTIVE_INCIDENT_STATUSES } }),
    }
    : null;
  const ready = user ? await readyAt(user) : null;
  return {
    enabled: config.simulator.enabled,
    demoUser: user ? { id: String(user._id), name: user.name, email: user.email, status: user.status } : null,
    problem,
    running: busy?.kind === 'run',
    busy: busy?.kind ?? null,
    workspace,
    readyAt: ready && ready > new Date() ? ready : null,
    lastRun,
    scenarios: SCENARIOS,
    defaultPaceMs: DEFAULT_PACE_MS,
  };
}

// ── Seed ────────────────────────────────────────────────────────────────────────────────

export async function seed() {
  acquire('seed');
  try {
    const user = await demoUser();
    const api = await signedInClient(user);
    try {
      const result = await scenarios.seed({ api, progress: progressReporter(null) });
      return { demoUserId: String(user._id), ...result };
    } finally {
      await api.logout();
    }
  } catch (error) {
    throw asAppError(error);
  } finally {
    release();
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────────────────

// Starts a scenario and returns at once; progress arrives as simulator.progress events and
// the outcome in status().lastRun.
export async function startRun({ scenario, paceMs }) {
  acquire('run');
  let user;
  let api;
  try {
    user = await demoUser();
    if (user.status !== 'ACTIVE') {
      throw errors.conflict('DEMO_USER_FROZEN', 'The demo account is frozen from an earlier run. Reset the demo workspace first.');
    }
    if (scenario === 'ransomware-like') {
      const ready = await readyAt(user);
      if (ready && ready > new Date()) {
        const seconds = Math.ceil((ready.getTime() - Date.now()) / 1000);
        throw new AppError(
          409,
          'SEED_IN_WINDOW',
          `The demo files were uploaded less than a detection window ago. Wait ${seconds} s so they predate the burst and recovery has a safe version to restore.`,
          { readyAt: ready, retryAfterSeconds: seconds },
        );
      }
    }
    api = await signedInClient(user);
  } catch (error) {
    release();
    throw error;
  }

  const run = {
    id: randomUUID(),
    scenario,
    paceMs: paceMs ?? DEFAULT_PACE_MS[scenario],
    state: 'running',
    startedAt: new Date(),
    finishedAt: null,
    step: 0,
    total: null,
    lastAction: null,
    stoppedReason: null,
    firstWriteAt: null,
    frozenAt: null,
    msFirstWriteToFreeze: null,
    incident: null,
  };
  lastRun = run;

  const execute = scenario === 'ransomware-like' ? scenarios.ransomwareLike : scenarios.normalUse;
  execute({ api, paceMs: run.paceMs, progress: progressReporter(run) })
    .then(async (outcome) => {
      run.step = outcome.step;
      run.total = outcome.total;
      run.firstWriteAt = outcome.firstWriteAt;
      run.stoppedReason = outcome.stoppedReason;
      run.state = outcome.stoppedReason === scenarios.FROZEN_REASON ? 'stopped' : outcome.stoppedReason ? 'failed' : 'completed';
      if (run.state === 'stopped') await describeFreeze(run, user);
    })
    .catch((error) => {
      run.state = 'failed';
      run.stoppedReason = `error: ${error.message}`;
      publish(EVENTS.SIMULATOR_PROGRESS, { step: run.step, total: run.total ?? 0, lastAction: 'Simulator error', stoppedReason: run.stoppedReason });
    })
    .finally(async () => {
      run.finishedAt = new Date();
      await api.logout();
      release();
    });

  return run;
}

// Server facts about the freeze that stopped the run (not the simulator's own view).
async function describeFreeze(run, user) {
  const [fresh, incident] = await Promise.all([
    User.findById(user._id).select('frozenAt').lean(),
    SecurityIncident.findOne({ userId: user._id, status: { $in: ACTIVE_INCIDENT_STATUSES } }).sort({ createdAt: -1 }).select('incidentNumber riskScore severity').lean(),
  ]);
  run.frozenAt = fresh?.frozenAt ?? null;
  if (run.frozenAt && run.firstWriteAt) run.msFirstWriteToFreeze = run.frozenAt.getTime() - run.firstWriteAt.getTime();
  if (incident) {
    run.incident = { id: String(incident._id), incidentNumber: incident.incidentNumber, riskScore: incident.riskScore, severity: incident.severity };
  }
}

// ── Reset ───────────────────────────────────────────────────────────────────────────────

/**
 * Spec §30 rule 8: unfreeze the demo account, close its incidents as RESOLVED ("demo reset",
 * audit-logged per incident), delete its workspace, re-seed canaries and demo-data.
 * actor: { adminId, ip }
 */
export async function reset(actor) {
  acquire('reset');
  try {
    const user = await demoUser();
    const adminActor = { kind: 'ADMIN', adminId: actor.adminId, ip: actor.ip };
    const before = { status: user.status };

    let unfrozen = false;
    if (user.status === 'FROZEN') {
      await freeze.unfreezeUser(user._id, { reason: 'demo reset', actor: adminActor });
      unfrozen = true;
    }

    const closed = [];
    const open = await SecurityIncident.find({ userId: user._id, status: { $nin: ['RESOLVED', 'FALSE_POSITIVE'] } });
    for (const incident of open) {
      const outcome = await incidents.closeForDemoReset(incident, actor);
      if (!outcome) continue;
      closed.push(incident.incidentNumber);
      await audit.record({
        adminId: actor.adminId,
        action: 'RESOLVE_INCIDENT',
        target: { kind: 'SecurityIncident', id: incident._id },
        ip: actor.ip,
        note: 'demo reset',
        before: outcome.before,
        after: { status: 'RESOLVED', via: 'simulator reset' },
        result: 'SUCCESS',
      });
    }

    const purged = await purgeDemoWorkspace(user._id);
    await User.updateOne({ _id: user._id }, { $set: { securityStatus: 'SAFE' } });
    windowStore.resetUser(user._id, new Date());
    const canaries = await seedForUser(user._id);

    const api = await signedInClient(user);
    let seeded;
    try {
      seeded = await scenarios.seed({ api, progress: progressReporter(null) });
    } finally {
      await api.logout();
    }
    return { demoUserId: String(user._id), before, unfrozen, closedIncidents: closed, purged, canaries, seeded };
  } catch (error) {
    throw asAppError(error);
  } finally {
    release();
  }
}
