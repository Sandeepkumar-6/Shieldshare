// Phase 3 acceptance tests: detection, response and recovery through the real API.
//
// The app runs in-process (supertest) against an in-memory MongoDB (mongodb-memory-server).
// Where a local MongoDB is installed its mongod binary is used instead of a download.
//
// Scenario files are uploaded first and then "aged" (their activity and versions are moved
// ten minutes into the past and the detection window is rebuilt from the database, exactly as
// on a server restart), so each burst happens against files that existed before it.
//
//   cd server && npm run test:detection

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const serverDir = path.join(repoRoot, 'server');
const requireServer = createRequire(path.join(serverDir, 'package.json'));
const { MongoMemoryServer } = requireServer('mongodb-memory-server');
const request = requireServer('supertest');
const mongoose = requireServer('mongoose');

// Prefer an installed mongod (no download). Its version silences the version-mismatch notice.
const LOCAL_MONGOD = 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe';
if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync(LOCAL_MONGOD)) {
  process.env.MONGOMS_SYSTEM_BINARY = LOCAL_MONGOD;
  const version = /db version v([\d.]+)/.exec(execFileSync(LOCAL_MONGOD, ['--version']).toString())?.[1];
  if (version) process.env.MONGOMS_VERSION = version;
}

const STORAGE_DIR = path.join(os.tmpdir(), 'shieldshare-test-storage-p3');
let mongo;
let app;
let db;
let windowStore;
let activeConfig;
let models;
let createUserWithWorkspace;
let adminToken;
let adminUser;

const oid = (value) => new mongoose.Types.ObjectId(String(value));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sum1 = (values) => Math.round(values.reduce((total, value) => total + value, 0) * 10) / 10;

// ── API helpers ─────────────────────────────────────────────────────────────────────────

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function registerUser(label) {
  const email = `${label}.${crypto.randomBytes(4).toString('hex')}@test.local`;
  const res = await request(app).post('/api/auth/register').send({ name: `Test ${label}`, email, password: 'correct horse battery' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { email, token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function createFolder(user, name) {
  const res = await request(app).post('/api/folders').set(auth(user.token)).send({ name });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.id;
}

async function rootFolder(user) {
  const res = await request(app).get('/api/folders').set(auth(user.token));
  return res.body.data.find((folder) => folder.isRoot).id;
}

async function upload(user, name, content, folderId) {
  const req = request(app).post('/api/files').set(auth(user.token));
  if (folderId) req.field('folderId', folderId);
  const res = await req.attach('file', Buffer.from(content), { filename: name, contentType: 'text/plain' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.file;
}

const modify = (user, fileId, content) => request(app)
  .put(`/api/files/${fileId}/content`).set(auth(user.token))
  .attach('file', Buffer.from(content), { filename: 'content.txt', contentType: 'text/plain' });
const rename = (user, fileId, name) => request(app).patch(`/api/files/${fileId}`).set(auth(user.token)).send({ name });
const remove = (user, fileId) => request(app).delete(`/api/files/${fileId}`).set(auth(user.token));
const share = (user, fileId) => request(app).post(`/api/files/${fileId}/shares`).set(auth(user.token))
  .send({ permission: 'DOWNLOAD', expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
const admin = (method, route) => request(app)[method](`/api/admin${route}`).set(auth(adminToken));

// Moves a user's existing activity and versions into the past and rebuilds the detection
// window from the database: the files now predate any burst that follows.
async function ageFixtures(userId, minutes = 10) {
  const past = new Date(Date.now() - minutes * 60_000);
  await db.collection('activities').updateMany({ userId: oid(userId) }, { $set: { timestamp: past } });
  await db.collection('versions').updateMany({ createdBy: oid(userId) }, { $set: { createdAt: past } });
  await windowStore.rebuild((await activeConfig()).windowSeconds);
}

async function canaryFiles(user) {
  const res = await request(app).get('/api/files?all=true&limit=100').set(auth(user.token));
  const canaries = await db.collection('files').find({ ownerId: oid(user.id), isCanary: true }).toArray();
  const ids = new Set(canaries.map((file) => String(file._id)));
  return res.body.data.filter((file) => ids.has(file.id));
}

const userDoc = (userId) => db.collection('users').findOne({ _id: oid(userId) });
const incidentsOf = (userId) => db.collection('securityincidents').find({ userId: oid(userId) }).toArray();
const evaluationsOf = (userId) => db.collection('riskevaluations').find({ userId: oid(userId) }).sort({ createdAt: 1 }).toArray();

function breakdown(evaluation) {
  return evaluation.signals.filter((signal) => signal.points > 0).map((signal) => `${signal.key} ${signal.level} +${signal.points}`).join(', ');
}

// Ransomware-like burst: modify N files, rename M of them to *.locked, then touch a canary.
async function burst(user, files, { renames, withCanary = true }) {
  const steps = [];
  const record = async (label, res) => {
    const status = (await userDoc(user.id)).status;
    steps.push({ label, http: res.status, userStatus: status });
    return res;
  };
  for (const [index, file] of files.entries()) {
    await record(`modify ${file.name}`, await modify(user, file.id, `ENCRYPTED ${index} ${crypto.randomBytes(24).toString('hex')}`));
  }
  for (const file of files.slice(0, renames)) {
    await record(`rename ${file.name}`, await rename(user, file.id, `${file.name}.locked`));
  }
  if (withCanary) {
    const [canary] = await canaryFiles(user);
    await record(`modify canary ${canary.name}`, await modify(user, canary.id, `ENCRYPTED canary ${crypto.randomBytes(24).toString('hex')}`));
  }
  return steps;
}

// ── Lifecycle ───────────────────────────────────────────────────────────────────────────

before(async () => {
  mongo = await MongoMemoryServer.create();
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
  process.env.MONGO_URI = mongo.getUri('shieldshare_p3');
  process.env.STORAGE_DIR = STORAGE_DIR;
  process.env.NODE_ENV = 'test';
  process.env.API_RATE_LIMIT_PER_MINUTE = '5000';
  process.env.ML_ENABLED = 'false';

  const serverUrl = (file) => new URL(`../../server/src/${file}`, import.meta.url);
  const { initialize } = await import(serverUrl('startup.js'));
  const { createApp } = await import(serverUrl('app.js'));
  windowStore = await import(serverUrl('security/window.store.js'));
  ({ activeConfig } = await import(serverUrl('security/config.service.js')));
  models = await import(serverUrl('models/index.js'));
  ({ createUserWithWorkspace } = await import(serverUrl('services/auth.service.js')));

  await initialize();
  app = createApp();
  db = mongoose.connection.db;

  adminUser = await createUserWithWorkspace({ name: 'Test Admin', email: 'admin.p3@test.local', password: 'admin password 123', role: 'admin' });
  const login = await request(app).post('/api/auth/login').send({ email: 'admin.p3@test.local', password: 'admin password 123' });
  adminToken = login.body.data.accessToken;
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

// ── Configuration and canaries ──────────────────────────────────────────────────────────

describe('detection configuration', () => {
  test('version 1 is preserved and Phase 5a enables entropy in a new version', async () => {
    const res = await admin('get', '/config/detection');
    assert.equal(res.status, 200);
    const config = res.body.data;
    assert.equal(config.version, 2);
    assert.equal(config.windowSeconds, 60);
    assert.deepEqual(config.thresholds, {
      rapidActivity: 30, massModification: 10, massRename: 8, massDelete: 8, directorySpread: 3,
      extensionChanges: 5, sameExtension: 3, entropyBaselineMax: 6, entropyDeltaMin: 1.5,
    });
    assert.equal(config.weights.massModification, 20);
    assert.equal(config.weights.canaryTrigger, 20);
    assert.deepEqual(config.severityBands, { suspicious: 30, high: 60, critical: 80 });
    assert.equal(config.minCategoriesForCritical, 2);
    assert.deepEqual(config.entropy, { enabled: true, partialRatio: 0.25, fullRatio: 0.5 });
    const original = await db.collection('detectionconfigs').findOne({ version: 1 });
    assert.equal(original.entropy.enabled, false);
    assert.equal(original.isActive, false);
  });

  test('PUT validates ranges, creates a new version, is audited; non-admins get 403', async () => {
    for (const [body, pattern] of [
      [{ weights: { massRename: 60 } }, /0 to 50/],
      [{ thresholds: { massRename: 0 } }, /above 0/],
      [{ severityBands: { high: 20 } }, /ascend/],
      [{ entropy: { partialRatio: 0.8, fullRatio: 0.5 } }, /ascend/],
      [{ unknownSetting: 1 }, /./],
    ]) {
      const res = await admin('put', '/config/detection').send(body);
      assert.equal(res.status, 422, JSON.stringify(body));
      assert.match(res.body.error.message, pattern);
    }
    const ok = await admin('put', '/config/detection').send({ weights: { massRename: 16 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.version, 3);
    assert.equal(ok.body.data.weights.massRename, 16);
    const back = await admin('put', '/config/detection').send({ weights: { massRename: 15 } });
    assert.equal(back.body.data.version, 4);
    assert.equal((await activeConfig()).weights.massRename, 15, 'cache reloaded');

    const audit = await db.collection('adminauditlogs').find({ action: 'CONFIG_UPDATE' }).toArray();
    assert.equal(audit.filter((entry) => entry.result === 'SUCCESS').length, 2);
    assert.equal(audit.filter((entry) => entry.result === 'FAILURE').length, 5);

    const someone = await registerUser('config');
    const forbidden = await request(app).put('/api/admin/config/detection').set(auth(someone.token)).send({ windowSeconds: 30 });
    assert.equal(forbidden.status, 403);
  });
});

describe('canaries', () => {
  test('registration seeds canaries: hidden from listings, counts and dashboard; returned by ?all=true', async () => {
    const user = await registerUser('canarycheck');
    const stored = await db.collection('files').find({ ownerId: oid(user.id), isCanary: true }).toArray();
    assert.deepEqual(stored.map((file) => file.name).sort(), ['Q3_budget_final.csv', 'client_contracts.txt', 'payroll_export.csv']);
    assert.ok(stored.every((file) => file.canaryTemplate === file.name && file.status === 'ACTIVE'));

    const listing = await request(app).get('/api/files').set(auth(user.token));
    assert.equal(listing.body.data.length, 0);
    const dashboard = await request(app).get('/api/me/dashboard').set(auth(user.token));
    assert.equal(dashboard.body.data.fileCount, 0);
    assert.equal(dashboard.body.data.storageBytes, 0);
    const all = await request(app).get('/api/files?all=true').set(auth(user.token));
    assert.equal(all.body.data.length, 3);
    assert.ok(!JSON.stringify(all.body).includes('isCanary'), 'nothing marks them as canaries to the user');

    const adminView = await admin('get', `/files?owner=${encodeURIComponent(user.email)}`);
    assert.equal(adminView.body.data.filter((file) => file.isCanary).length, 3, 'administrators see canaries');
  });
});

// ── Scenarios ───────────────────────────────────────────────────────────────────────────

describe('ransomware-like burst', () => {
  const ctx = {};

  before(async () => {
    const user = await registerUser('burst');
    const home = await rootFolder(user);
    const folders = [home, await createFolder(user, 'Finance'), await createFolder(user, 'Projects')];
    const files = [];
    for (let i = 0; i < 12; i += 1) {
      files.push(await upload(user, `document-${String(i + 1).padStart(2, '0')}.txt`, `Quarterly notes ${i}\n`.repeat(40), folders[i % 3]));
    }
    const links = [(await share(user, files[0].id)).body.data, (await share(user, files[5].id)).body.data];
    await ageFixtures(user.id);
    Object.assign(ctx, { user, files, links });
    ctx.steps = await burst(user, files, { renames: 10 });
    // The attacker keeps going: "encrypt, then delete the originals".
    ctx.after = [];
    for (const file of files.slice(0, 5)) ctx.after.push((await remove(user, file.id)).status);
  });

  test('CRITICAL before the burst finishes; the crossing request completes; later writes get 423', async (t) => {
    const frozenAt = ctx.steps.findIndex((step) => step.userStatus === 'FROZEN');
    assert.ok(frozenAt >= 0, 'the user was frozen during the burst');
    assert.equal(ctx.steps[frozenAt].http, 200, 'the request that crossed CRITICAL completed normally');
    assert.ok(ctx.steps.slice(0, frozenAt + 1).every((step) => step.http === 200));
    assert.deepEqual(ctx.after, [423, 423, 423, 423, 423], 'every write after the freeze is refused');
    t.diagnostic(`frozen at step ${frozenAt + 1} of ${ctx.steps.length}: ${ctx.steps[frozenAt].label}`);
    ctx.frozenAt = frozenAt;
  });

  test('exactly ONE incident, CONTAINED, with windowStart, timeline and evaluations', async (t) => {
    const incidents = await incidentsOf(ctx.user.id);
    assert.equal(incidents.length, 1);
    const [incident] = incidents;
    ctx.incident = incident;
    assert.equal(incident.status, 'CONTAINED');
    assert.equal(incident.severity, 'CRITICAL');
    assert.match(incident.incidentNumber, /^SH-10\d\d$/);
    assert.equal(incident.freezeStatus, 'FROZEN');
    assert.equal(incident.quarantineStatus, 'QUARANTINED');
    assert.equal(incident.canaryTriggered, true);

    const firstModify = await db.collection('activities').find({ userId: oid(ctx.user.id), action: 'MODIFY' }).sort({ timestamp: 1 }).limit(1).next();
    assert.equal(incident.windowStart.getTime(), firstModify.timestamp.getTime(), 'window starts at the first write of the burst');

    const types = new Set(incident.timeline.map((entry) => entry.type));
    for (const type of ['ACTIVITY_BURST', 'RULE_FIRED', 'CANARY', 'RISK', 'FREEZE', 'QUARANTINE', 'STATUS']) {
      assert.ok(types.has(type), `timeline has ${type}`);
    }
    assert.ok(incident.peakEvaluationId && incident.latestEvaluationId);
    const user = await userDoc(ctx.user.id);
    assert.equal(user.status, 'FROZEN');
    assert.equal(String(user.frozenByIncidentId), String(incident._id));
    assert.equal(user.securityStatus, 'CRITICAL');

    const alerts = await db.collection('alerts').find({ incidentId: incident._id }).toArray();
    assert.deepEqual(alerts.map((alert) => alert.type).sort(), ['INCIDENT_CREATED', 'INCIDENT_ESCALATED']);
    t.diagnostic(`${incident.incidentNumber}: peak ${incident.riskScore}, ${incident.timeline.length} timeline entries`);
  });

  test('affected files QUARANTINED, window versions QUARANTINED, share links SUSPENDED; canaries not quarantined', async () => {
    for (const file of ctx.files) {
      const doc = await db.collection('files').findOne({ _id: oid(file.id) });
      assert.equal(doc.status, 'QUARANTINED', file.name);
      const versions = await db.collection('versions').find({ fileId: oid(file.id) }).sort({ versionNumber: 1 }).toArray();
      assert.equal(versions[0].securityStatus, 'SAFE', 'v1 predates the window');
      assert.equal(versions[1].securityStatus, 'QUARANTINED', 'v2 was written in the window');
    }
    assert.ok(ctx.incident.affectedFiles.length === 12);
    for (const link of ctx.links) {
      const doc = await db.collection('sharelinks').findOne({ _id: oid(link.share.id) });
      assert.equal(doc.status, 'SUSPENDED');
      assert.equal(String(doc.suspendedByIncidentId), String(ctx.incident._id));
    }
    const canaries = await db.collection('files').find({ ownerId: oid(ctx.user.id), isCanary: true }).toArray();
    assert.ok(canaries.every((file) => file.status !== 'QUARANTINED'));
    const items = await db.collection('quarantineitems').countDocuments({ incidentId: ctx.incident._id });
    assert.equal(items, 12);
  });

  test('the RiskEvaluation breakdown adds up to the stored score (before clamping)', async (t) => {
    const evaluations = await evaluationsOf(ctx.user.id);
    assert.ok(evaluations.length > 0);
    for (const evaluation of evaluations) {
      assert.equal(sum1(evaluation.signals.map((signal) => signal.points)), evaluation.rawScore);
      assert.equal(evaluation.score, evaluation.capApplied ? evaluation.score : Math.min(100, evaluation.rawScore));
      assert.equal(evaluation.phase, 'INLINE');
      assert.equal(evaluation.ml.status, 'DISABLED');
      assert.equal(evaluation.configVersion, 4);
    }
    const peak = await db.collection('riskevaluations').findOne({ _id: ctx.incident.peakEvaluationId });
    assert.equal(peak.severity, 'CRITICAL');
    assert.ok(peak.categories.length >= 2);
    const first = evaluations.find((evaluation) => evaluation.severity === 'HIGH');
    t.diagnostic(`first HIGH: ${first.score} = ${breakdown(first)}`);
    t.diagnostic(`peak: raw ${peak.rawScore}, score ${peak.score} ${peak.severity} = ${breakdown(peak)}`);
    t.diagnostic(`severity path: ${evaluations.map((evaluation) => `${evaluation.score}`).join(' → ')}`);
  });

  test('re-running the response for the same evaluation duplicates nothing', async () => {
    const response = await import(new URL('../../server/src/security/response.service.js', import.meta.url));
    const config = await activeConfig();
    const peak = await models.RiskEvaluation.findById(ctx.incident.peakEvaluationId);
    const entries = windowStore.entries(ctx.user.id, new Date(), config.windowSeconds);
    const count = async () => ({
      incidents: await db.collection('securityincidents').countDocuments({ userId: oid(ctx.user.id) }),
      items: await db.collection('quarantineitems').countDocuments({ incidentId: ctx.incident._id }),
      alerts: await db.collection('alerts').countDocuments({ incidentId: ctx.incident._id }),
      timeline: (await db.collection('securityincidents').findOne({ _id: ctx.incident._id })).timeline.length,
    });
    const before = await count();
    await response.handleEvaluation({ userId: ctx.user.id, evaluation: peak, entries, config });
    await response.handleEvaluation({ userId: ctx.user.id, evaluation: peak, entries, config });
    assert.deepEqual(await count(), before);
  });

  test('the user sees the frozen state and notices, never risk or detection details', async () => {
    const me = await request(app).get('/api/auth/me').set(auth(ctx.user.token));
    assert.equal(me.body.data.user.status, 'FROZEN');
    const security = await request(app).get('/api/me/security').set(auth(ctx.user.token));
    assert.equal(security.body.data.status, 'FROZEN');
    assert.equal(security.body.data.recentNotifications[0].type, 'ACCOUNT_PAUSED');
    const file = await request(app).get(`/api/files/${ctx.files[0].id}`).set(auth(ctx.user.token));
    assert.equal(file.body.data.status, 'QUARANTINED');
    const activity = await request(app).get('/api/me/activity?limit=100').set(auth(ctx.user.token));
    const text = JSON.stringify([security.body, activity.body, file.body]).toLowerCase();
    // File status QUARANTINED is part of the owner's file shape (shown as 'Under review').
    for (const word of ['risk', 'score', 'canary', 'incident', 'sh-10', 'signal', 'evaluation']) {
      assert.ok(!text.includes(word), `user-facing data mentions "${word}"`);
    }
  });
});

describe('single category', () => {
  test('rename 10 files to *.locked only, default config: below HIGH, no incident, no freeze', async (t) => {
    const user = await registerUser('renamer');
    const files = [];
    for (let i = 0; i < 10; i += 1) files.push(await upload(user, `photo-${i}.txt`, `caption ${i}\n`.repeat(10)));
    await ageFixtures(user.id);
    for (const file of files) assert.equal((await rename(user, file.id, `${file.name}.locked`)).status, 200);

    const evaluations = await evaluationsOf(user.id);
    const last = evaluations.at(-1);
    assert.deepEqual(last.categories, ['BEHAVIOR']);
    assert.ok(['SAFE', 'SUSPICIOUS'].includes(last.severity));
    assert.equal((await incidentsOf(user.id)).length, 0);
    assert.equal((await userDoc(user.id)).status, 'ACTIVE');
    t.diagnostic(`default weights: score ${last.score} ${last.severity} = ${breakdown(last)}`);
  });

  test('with BEHAVIOR weights raised so one category exceeds 79: HIGH, capApplied, incident OPEN, no freeze', async (t) => {
    await admin('put', '/config/detection').send({ weights: { massRename: 45, extensionChanges: 45 } });
    try {
      const user = await registerUser('renamer2');
      const files = [];
      for (let i = 0; i < 10; i += 1) files.push(await upload(user, `scan-${i}.txt`, `page ${i}\n`.repeat(10)));
      await ageFixtures(user.id);
      for (const file of files) assert.equal((await rename(user, file.id, `${file.name}.locked`)).status, 200);

      const last = (await evaluationsOf(user.id)).at(-1);
      assert.equal(last.rawScore, 90);
      assert.equal(last.score, 79);
      assert.equal(last.severity, 'HIGH');
      assert.equal(last.capApplied, true);
      assert.ok(last.reasons.some((reason) => reason.startsWith('Single-category cap applied')));
      const incidents = await incidentsOf(user.id);
      assert.equal(incidents.length, 1);
      assert.equal(incidents[0].status, 'OPEN');
      assert.equal(incidents[0].severity, 'HIGH');
      assert.equal(incidents[0].freezeStatus, 'NONE');
      assert.equal((await userDoc(user.id)).status, 'ACTIVE');
      assert.equal(await db.collection('files').countDocuments({ ownerId: oid(user.id), status: 'QUARANTINED' }), 0);
      t.diagnostic(`raised weights: raw ${last.rawScore} → score ${last.score} ${last.severity} (cap) = ${breakdown(last)}`);
    } finally {
      await admin('put', '/config/detection').send({ weights: { massRename: 15, extensionChanges: 15 } });
    }
  });
});

describe('normal use', () => {
  test('5 uploads + 3 modifies at a human pace: SAFE, no evaluation stored, no incident', async (t) => {
    const user = await registerUser('normal');
    const files = [];
    for (let i = 0; i < 5; i += 1) {
      files.push(await upload(user, `report-${i}.md`, `# Report ${i}\n\nDraft text.\n`));
      await sleep(250);
    }
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await modify(user, files[i].id, `# Report ${i}\n\nEdited text.\n`)).status, 200);
      await sleep(250);
    }
    assert.equal((await evaluationsOf(user.id)).length, 0);
    assert.equal((await incidentsOf(user.id)).length, 0);
    const doc = await userDoc(user.id);
    assert.equal(doc.status, 'ACTIVE');
    assert.equal(doc.securityStatus, 'SAFE');
    t.diagnostic('8 writes, every evaluation SAFE (score 0): nothing stored');
  });
});

describe('recovery', () => {
  let burstUser;
  let incident;

  before(async () => {
    [incident] = await db.collection('securityincidents').find({ status: 'CONTAINED' }).toArray();
    burstUser = await userDoc(incident.userId);
  });

  test('incident files: every affected file proposes its pre-window v1', async () => {
    const res = await admin('get', `/incidents/${incident._id}/files`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 12);
    for (const entry of res.body.data) {
      assert.equal(entry.state, 'AWAITING');
      assert.equal(entry.proposedSafeVersion.versionNumber, 1);
      assert.ok(entry.windowVersions.every((version) => version.securityStatus === 'QUARANTINED'));
    }
    const resolveEarly = await admin('post', `/incidents/${incident._id}/resolve`).send({ resolution: 'RESOLVED', note: 'too soon' });
    assert.equal(resolveEarly.status, 409);
    assert.equal(resolveEarly.body.error.code, 'INVALID_TRANSITION');
  });

  test('restore-all: new RESTORED versions, names back, verified, links reactivated, incident RECOVERED', async () => {
    assert.equal((await admin('post', `/incidents/${incident._id}/investigate`)).body.data.status, 'INVESTIGATING');
    const res = await admin('post', `/incidents/${incident._id}/restore-all`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.incidentStatus, 'RECOVERED');
    assert.equal(res.body.data.results.length, 12);
    for (const result of res.body.data.results) {
      assert.equal(result.result, 'RESTORED', JSON.stringify(result));
      assert.equal(result.verification.passed, true);
      assert.equal(result.fromVersion, 1);
      assert.ok(!result.restoredName.endsWith('.locked'));
    }

    const files = await db.collection('files').find({ _id: { $in: incident.affectedFiles } }).toArray();
    for (const file of files) {
      assert.equal(file.status, 'ACTIVE', `${file.name} (was deleted or quarantined)`);
      assert.match(file.name, /^document-\d\d\.txt$/);
      assert.equal(file.deletedAt, undefined);
      const versions = await db.collection('versions').find({ fileId: file._id }).sort({ versionNumber: 1 }).toArray();
      const last = versions.at(-1);
      assert.equal(last.source, 'RESTORE');
      assert.equal(last.securityStatus, 'RESTORED');
      assert.equal(last.restoredFromVersion, 1);
      assert.equal(last.sha256, versions[0].sha256);
      assert.equal(versions[1].securityStatus, 'QUARANTINED', 'suspicious versions stay in history');
    }
    const items = await db.collection('quarantineitems').find({ incidentId: incident._id }).toArray();
    assert.ok(items.every((item) => item.status === 'RESTORED' && item.restoredToVersion === 3));
    const links = await db.collection('sharelinks').find({ fileId: { $in: incident.affectedFiles } }).toArray();
    assert.ok(links.length === 2 && links.every((link) => link.status === 'ACTIVE' && !link.suspendedByIncidentId));

    const template = fs.readFileSync(path.join(serverDir, '.shieldshare', 'canary', 'Q3_budget_final.csv'));
    const canary = await db.collection('files').findOne({ ownerId: incident.userId, canaryTemplate: 'Q3_budget_final.csv' });
    assert.equal(canary.sha256, crypto.createHash('sha256').update(template).digest('hex'), 'canary reset from its template');

    const doc = await db.collection('securityincidents').findOne({ _id: incident._id });
    assert.equal(doc.status, 'RECOVERED');
    assert.ok(doc.timeline.some((entry) => entry.type === 'VERIFY'));
  });

  test('restore-all again is a no-op; resolve RESOLVED with unfreeze; the user can work again', async () => {
    const versionsBefore = await db.collection('versions').countDocuments({ fileId: { $in: incident.affectedFiles } });
    const again = await admin('post', `/incidents/${incident._id}/restore-all`);
    assert.equal(again.status, 409, 'a RECOVERED incident takes no further restores');
    assert.equal(await db.collection('versions').countDocuments({ fileId: { $in: incident.affectedFiles } }), versionsBefore);

    const missingNote = await admin('post', `/incidents/${incident._id}/resolve`).send({ resolution: 'RESOLVED' });
    assert.equal(missingNote.status, 422);
    const resolved = await admin('post', `/incidents/${incident._id}/resolve`).send({ resolution: 'RESOLVED', note: 'Files restored; account compromised credentials reset', unfreezeUser: true });
    assert.equal(resolved.status, 200, JSON.stringify(resolved.body));
    assert.equal(resolved.body.data.status, 'RESOLVED');
    const user = await userDoc(burstUser._id);
    assert.equal(user.status, 'ACTIVE');
    assert.equal(user.securityStatus, 'SAFE');
    assert.ok(await db.collection('alerts').findOne({ incidentId: incident._id, type: 'INCIDENT_RESOLVED' }));

    const login = await request(app).post('/api/auth/login').send({ email: burstUser.email, password: 'correct horse battery' });
    const token = login.body.data.accessToken;
    const renameOne = await request(app).patch(`/api/files/${incident.affectedFiles[0]}`).set(auth(token)).send({ name: 'document-01-final.txt' });
    assert.equal(renameOne.status, 200, 'writes work again and the old burst is not rescored');
    assert.equal((await userDoc(burstUser._id)).status, 'ACTIVE');

    for (const action of ['INVESTIGATE_INCIDENT', 'RESTORE_ALL', 'RESOLVE_INCIDENT']) {
      assert.ok(await db.collection('adminauditlogs').findOne({ action, result: 'SUCCESS', 'target.id': incident._id }), action);
    }
    assert.ok(await db.collection('adminauditlogs').findOne({ action: 'RESOLVE_INCIDENT', result: 'FAILURE' }), 'failed resolve audited');
  });
});

describe('false positive', () => {
  test('resolve FALSE_POSITIVE: user unfrozen, files ACTIVE, versions SAFE, links back', async (t) => {
    const user = await registerUser('fp');
    const folders = [await rootFolder(user), await createFolder(user, 'Designs')];
    const files = [];
    for (let i = 0; i < 10; i += 1) files.push(await upload(user, `drawing-${i}.txt`, `sketch ${i}\n`.repeat(20), folders[i % 2]));
    const link = (await share(user, files[2].id)).body.data;
    await ageFixtures(user.id);
    await burst(user, files, { renames: 8 });

    const [incident] = await incidentsOf(user.id);
    assert.equal(incident.status, 'CONTAINED');
    const peak = await db.collection('riskevaluations').findOne({ _id: incident.peakEvaluationId });
    t.diagnostic(`fp burst peak: raw ${peak.rawScore}, score ${peak.score} ${peak.severity} = ${breakdown(peak)}`);

    const wrong = await admin('post', `/incidents/${incident._id}/resolve`).send({ resolution: 'RESOLVED', note: 'x' });
    assert.equal(wrong.status, 409);
    const res = await admin('post', `/incidents/${incident._id}/resolve`).send({ resolution: 'FALSE_POSITIVE', note: 'Bulk export by the design team, confirmed' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.status, 'FALSE_POSITIVE');
    assert.equal(res.body.data.quarantineStatus, 'RELEASED');

    assert.equal((await userDoc(user.id)).status, 'ACTIVE');
    for (const file of files) {
      const doc = await db.collection('files').findOne({ _id: oid(file.id) });
      assert.equal(doc.status, 'ACTIVE');
      assert.equal(doc.currentVersion, 2, 'released at the current version, nothing restored');
      const versions = await db.collection('versions').find({ fileId: oid(file.id) }).toArray();
      assert.ok(versions.every((version) => version.securityStatus === 'SAFE'), `${file.name} versions SAFE`);
    }
    assert.equal((await db.collection('sharelinks').findOne({ _id: oid(link.share.id) })).status, 'ACTIVE');
    assert.equal(await db.collection('quarantineitems').countDocuments({ incidentId: incident._id, status: { $ne: 'RELEASED' } }), 0);
    const again = await admin('post', `/incidents/${incident._id}/resolve`).send({ resolution: 'RESOLVED', note: 'x' });
    assert.equal(again.status, 409, 'FALSE_POSITIVE is final');
  });
});

describe('canary alone', () => {
  test('touching one canary: CANARY_TRIGGERED alert without an incident, no freeze; not repeated', async (t) => {
    const user = await registerUser('curious');
    await ageFixtures(user.id);
    const [first, second] = await canaryFiles(user);
    assert.equal((await modify(user, first.id, 'changed')).status, 200);

    const evaluations = await evaluationsOf(user.id);
    assert.equal(evaluations.length, 1);
    assert.equal(evaluations[0].score, 20);
    assert.equal(evaluations[0].severity, 'SUSPICIOUS');
    assert.ok(evaluations[0].reasons.some((reason) => reason.startsWith('Canary floor')));
    assert.equal((await incidentsOf(user.id)).length, 0);
    assert.equal((await userDoc(user.id)).status, 'ACTIVE');
    const alerts = await db.collection('alerts').find({ userId: oid(user.id) }).toArray();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'CANARY_TRIGGERED');
    assert.equal(alerts[0].incidentId, undefined);
    assert.ok(await db.collection('activities').findOne({ userId: oid(user.id), action: 'CANARY_TRIGGER' }));

    assert.equal((await rename(user, second.id, 'contracts-old.txt')).status, 200);
    assert.equal(await db.collection('alerts').countDocuments({ userId: oid(user.id) }), 1, 'one alert per window');
    t.diagnostic(`canary alone: score ${evaluations[0].score} → ${evaluations[0].severity} (canary floor)`);

    const list = await admin('get', '/alerts?type=CANARY_TRIGGERED');
    assert.ok(list.body.data.some((alert) => alert.user?.email === user.email && alert.incident === null));
  });
});

describe('robustness', () => {
  test('admin accounts: incident opens and contains, but auto-freeze is skipped and recorded', async () => {
    const other = await createUserWithWorkspace({ name: 'Second Admin', email: 'admin2.p3@test.local', password: 'admin password 123', role: 'admin' });
    const login = await request(app).post('/api/auth/login').send({ email: 'admin2.p3@test.local', password: 'admin password 123' });
    const user = { id: String(other._id), token: login.body.data.accessToken, email: other.email };
    const folders = [await rootFolder(user), await createFolder(user, 'Admin notes')];
    const files = [];
    for (let i = 0; i < 10; i += 1) files.push(await upload(user, `runbook-${i}.txt`, `step ${i}\n`.repeat(20), folders[i % 2]));
    await ageFixtures(user.id);
    await burst(user, files, { renames: 8 });

    const [incident] = await incidentsOf(user.id);
    assert.equal(incident.status, 'CONTAINED');
    assert.equal((await userDoc(user.id)).status, 'ACTIVE', 'admin not frozen');
    assert.ok(incident.timeline.some((entry) => entry.type === 'FREEZE' && entry.text === 'Auto-freeze skipped: admin account'));
    assert.ok(await db.collection('files').countDocuments({ ownerId: oid(user.id), status: 'QUARANTINED' }) > 0, 'files still quarantined');
  });

  test('a detection failure never breaks the file operation', async () => {
    const user = await registerUser('resilient');
    const [canary] = await canaryFiles(user);
    const original = models.RiskEvaluation.create;
    models.RiskEvaluation.create = async () => { throw new Error('simulated detection storage failure'); };
    const errors = console.error;
    console.error = () => {};
    try {
      const res = await modify(user, canary.id, 'changed during a detection outage');
      assert.equal(res.status, 200, 'the write succeeded');
    } finally {
      models.RiskEvaluation.create = original;
      console.error = errors;
    }
    assert.equal((await db.collection('files').findOne({ _id: oid(canary.id) })).currentVersion, 2);
  });

  test('summary reflects real state; non-admins get 403 on every new admin route', async () => {
    const summary = await admin('get', '/summary');
    assert.equal(summary.status, 200);
    const openIncidents = await db.collection('securityincidents').countDocuments({ status: { $in: ['OPEN', 'CONTAINED', 'INVESTIGATING'] } });
    assert.equal(summary.body.data.openIncidents, openIncidents);
    assert.equal(summary.body.data.systemState, openIncidents > 0 ? 'ACTIVE_INCIDENT' : 'PROTECTED');
    assert.equal(summary.body.data.quarantinedFiles, await db.collection('files').countDocuments({ status: 'QUARANTINED' }));
    const ml = await admin('get', '/ml/status');
    assert.deepEqual(ml.body.data, { available: false, status: 'DISABLED' });

    const someone = await registerUser('nosy');
    const anyIncident = await db.collection('securityincidents').findOne({});
    const anyAlert = await db.collection('alerts').findOne({});
    const anyFile = await db.collection('files').findOne({});
    for (const [method, route] of [
      ['get', '/summary'], ['get', '/incidents'], ['get', `/incidents/${anyIncident._id}`],
      ['get', `/incidents/${anyIncident._id}/risk`], ['get', `/incidents/${anyIncident._id}/files`],
      ['post', `/incidents/${anyIncident._id}/investigate`], ['post', `/incidents/${anyIncident._id}/resolve`],
      ['post', `/incidents/${anyIncident._id}/restore-all`], ['get', '/alerts'], ['post', `/alerts/${anyAlert._id}/ack`],
      ['get', '/recovery'], ['post', `/files/${anyFile._id}/restore`], ['get', '/config/detection'], ['put', '/config/detection'], ['get', '/ml/status'],
      ['get', `/users/${someone.id}/activity`],
    ]) {
      const res = await request(app)[method](`/api/admin${route}`).set(auth(someone.token)).send({});
      assert.equal(res.status, 403, `${method.toUpperCase()} ${route}`);
    }
  });
});
