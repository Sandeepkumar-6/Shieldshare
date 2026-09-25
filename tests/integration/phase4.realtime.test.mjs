// Phase 4 acceptance tests: Socket.IO, analytics, the controlled simulator end to end.
//
// The API runs in-process on a real HTTP port (the simulator is an HTTP client of it) against
// an in-memory MongoDB (mongodb-memory-server, using the local mongod when installed).
// Sockets connect with socket.io-client exactly like the browser.
//
//   cd server && npm run test:realtime

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
const mongoose = requireServer('mongoose');
const { io: connectSocket } = requireServer('socket.io-client');

const LOCAL_MONGOD = 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe';
if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync(LOCAL_MONGOD)) {
  process.env.MONGOMS_SYSTEM_BINARY = LOCAL_MONGOD;
  const version = /db version v([\d.]+)/.exec(execFileSync(LOCAL_MONGOD, ['--version']).toString())?.[1];
  if (version) process.env.MONGOMS_VERSION = version;
}

const STORAGE_DIR = path.join(os.tmpdir(), 'shieldshare-test-storage-p4');
const DEMO_EMAIL = 'demo.p4@test.local';
const DEMO_PASSWORD = 'demo password 123';
const PASSWORD = 'correct horse battery';

let mongo;
let realtime;
let BASE;
let db;
let windowStore;
let activeConfig;
let createUserWithWorkspace;
let adminToken;
let admin;
let adminSocket;

const oid = (value) => new mongoose.Types.ObjectId(String(value));
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const sockets = [];

// ── HTTP and socket helpers ─────────────────────────────────────────────────────────────

async function api(method, route, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const res = await fetch(`${BASE}/api${route}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const asAdmin = (method, route, options = {}) => api(method, route, { ...options, token: adminToken });

async function login(email, password = PASSWORD) {
  const res = await api('POST', '/auth/login', { json: { email, password } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data.accessToken;
}

async function registerUser(label) {
  const email = `${label}.${crypto.randomBytes(4).toString('hex')}@test.local`;
  const res = await api('POST', '/auth/register', { json: { name: `Test ${label}`, email, password: PASSWORD } });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { email, token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function upload(user, name, content, folderId) {
  const form = new FormData();
  if (folderId) form.append('folderId', folderId);
  form.append('file', new Blob([content], { type: 'text/plain' }), name);
  const res = await api('POST', '/files', { token: user.token, form });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.file;
}

// Resolves with { socket, events } once connected; rejects with the connect_error.
function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = connectSocket(BASE, { auth: token === undefined ? {} : { token }, reconnection: false, transports: ['websocket'] });
    sockets.push(socket);
    const events = [];
    socket.onAny((event, payload) => events.push({ event, payload, receivedAt: Date.now() }));
    socket.once('connect', () => resolve({ socket, events }));
    socket.once('connect_error', (error) => {
      socket.close();
      reject(error);
    });
  });
}

const disconnected = (socket, ms = 3000) => new Promise((resolve, reject) => {
  if (socket.disconnected) return resolve('already');
  const timer = setTimeout(() => reject(new Error('socket was not disconnected')), ms);
  socket.once('disconnect', (reason) => {
    clearTimeout(timer);
    resolve(reason);
  });
});

async function until(check, { timeout = 30_000, interval = 100, label = 'condition' } = {}) {
  const started = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - started > timeout) throw new Error(`timed out waiting for ${label}`);
    await sleep(interval);
  }
}

// Moves a user's activity and versions ten minutes into the past and rebuilds the detection
// window from the database (as on a server restart): the files now predate any burst.
async function ageFixtures(userId, minutes = 10) {
  const past = new Date(Date.now() - minutes * 60_000);
  await db.collection('activities').updateMany({ userId: oid(userId) }, { $set: { timestamp: past } });
  await db.collection('versions').updateMany({ createdBy: oid(userId) }, { $set: { createdAt: past } });
  await windowStore.rebuild((await activeConfig()).windowSeconds);
}

const waitForIdle = () => until(async () => {
  const res = await asAdmin('GET', '/admin/simulator/status');
  return res.body.data.busy === null && res.body.data.lastRun?.state !== 'running' ? res.body.data : null;
}, { label: 'simulator idle' });

const byEvent = (events, name) => events.filter((entry) => entry.event === name);
const firstIndex = (events, name) => events.findIndex((entry) => entry.event === name);

// Everything a bystander owns, to prove the reset never touches it.
async function snapshotOf(userId) {
  const files = await db.collection('files').find({ ownerId: oid(userId) }).sort({ _id: 1 }).toArray();
  const fileIds = files.map((file) => file._id);
  return {
    files,
    versions: await db.collection('versions').find({ fileId: { $in: fileIds } }).sort({ _id: 1 }).toArray(),
    links: await db.collection('sharelinks').find({ fileId: { $in: fileIds } }).sort({ _id: 1 }).toArray(),
    folders: await db.collection('folders').find({ ownerId: oid(userId) }).sort({ _id: 1 }).toArray(),
    user: await db.collection('users').findOne({ _id: oid(userId) }),
  };
}

// ── Lifecycle ───────────────────────────────────────────────────────────────────────────

before(async () => {
  mongo = await MongoMemoryServer.create();
  fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
  Object.assign(process.env, {
    MONGO_URI: mongo.getUri('shieldshare_p4'),
    STORAGE_DIR,
    NODE_ENV: 'test',
    API_RATE_LIMIT_PER_MINUTE: '5000',
    ML_ENABLED: 'false',
    SIMULATOR_ENABLED: 'true',
    SIMULATOR_DEMO_USER_EMAIL: DEMO_EMAIL,
    SIMULATOR_DEMO_USER_PASSWORD: DEMO_PASSWORD,
  });

  const serverUrl = (file) => new URL(`../../server/src/${file}`, import.meta.url);
  const { initialize } = await import(serverUrl('startup.js'));
  const { createHttpServer } = await import(serverUrl('httpServer.js'));
  const { configureSimulator } = await import(serverUrl('simulator/simulator.service.js'));
  windowStore = await import(serverUrl('security/window.store.js'));
  ({ activeConfig } = await import(serverUrl('security/config.service.js')));
  ({ createUserWithWorkspace } = await import(serverUrl('services/auth.service.js')));

  await initialize();
  const created = createHttpServer();
  realtime = created.realtime;
  await new Promise((resolve) => { created.server.listen(0, '127.0.0.1', resolve); });
  BASE = `http://127.0.0.1:${created.server.address().port}`;
  configureSimulator({ baseUrl: BASE });
  db = mongoose.connection.db;

  admin = await createUserWithWorkspace({ name: 'Test Admin', email: 'admin.p4@test.local', password: 'admin password 123', role: 'admin' });
  adminToken = await login('admin.p4@test.local', 'admin password 123');
  adminSocket = await connect(adminToken);
});

after(async () => {
  for (const socket of sockets) socket.close();
  await realtime?.close();
  await mongoose.disconnect();
  await mongo?.stop();
});

// ── Socket authentication and rooms ─────────────────────────────────────────────────────

describe('socket handshake (same checks as REST authenticate)', () => {
  test('missing, malformed and forged tokens are rejected', async () => {
    for (const token of [undefined, '', 'not-a-jwt', `${adminToken.slice(0, -4)}AAAA`]) {
      await assert.rejects(connect(token), (error) => error.message === 'UNAUTHENTICATED' && error.data?.code === 'UNAUTHENTICATED', `token ${String(token).slice(0, 12)}`);
    }
  });

  test('a signed-out session and a bumped tokenVersion are rejected with SESSION_REVOKED', async () => {
    const user = await registerUser('revoked');
    assert.equal((await api('POST', '/auth/logout', { token: user.token })).status, 204);
    await assert.rejects(connect(user.token), (error) => error.message === 'SESSION_REVOKED');

    const other = await registerUser('bumped');
    await db.collection('users').updateOne({ _id: oid(other.id) }, { $inc: { tokenVersion: 1 } });
    await assert.rejects(connect(other.token), (error) => error.message === 'SESSION_REVOKED');
  });
});

describe('rooms: admins vs user:<id>', () => {
  test('an admin freeze reaches admins with details and the user with { notice } only', async () => {
    const user = await registerUser('rooms');
    const { events } = await connect(user.token);
    const adminSeen = adminSocket.events.length;

    const frozen = await asAdmin('POST', `/admin/users/${user.id}/freeze`, { json: { reason: 'Room test' } });
    assert.equal(frozen.status, 200);
    await until(() => byEvent(events, 'user.frozen').length === 1, { label: 'user notice' });
    const adminFrozen = await until(() => adminSocket.events.slice(adminSeen).find((entry) => entry.event === 'user.frozen' && entry.payload.data.userId === user.id), { label: 'admin event' });
    assert.deepEqual(Object.keys(adminFrozen.payload.data).sort(), ['incidentId', 'reason', 'userId']);
    assert.equal(adminFrozen.payload.data.reason, 'Room test');

    const notice = byEvent(events, 'user.frozen')[0].payload;
    assert.deepEqual(Object.keys(notice).sort(), ['at', 'data', 'eventId']);
    assert.deepEqual(Object.keys(notice.data), ['notice']);
    assert.match(notice.data.notice, /paused/);

    assert.equal((await asAdmin('POST', `/admin/users/${user.id}/unfreeze`, { json: { reason: 'Room test done' } })).status, 200);
    await until(() => byEvent(events, 'user.unfrozen').length === 1, { label: 'unfreeze notice' });
    assert.deepEqual(Object.keys(byEvent(events, 'user.unfrozen')[0].payload.data), ['notice']);

    // Admin-room traffic from other activity never reaches this user.
    const file = await upload(user, 'room-check.txt', 'hello');
    assert.equal((await asAdmin('POST', `/admin/files/${file.id}/quarantine`, { json: { reason: 'Room test' } })).status, 201);
    await until(() => adminSocket.events.slice(adminSeen).some((entry) => entry.event === 'file.quarantined' && entry.payload.data.fileId === file.id), { label: 'file.quarantined' });
    await sleep(400); // one activity batch interval and then some
    assert.deepEqual([...new Set(events.map((entry) => entry.event))].sort(), ['user.frozen', 'user.unfrozen']);
  });
});

describe('revoked sessions lose their socket', () => {
  test('logout disconnects exactly that session', async () => {
    const user = await registerUser('logout');
    const secondToken = await login(user.email);
    const first = await connect(user.token);
    const second = await connect(secondToken);
    const reason = disconnected(first.socket);
    assert.equal((await api('POST', '/auth/logout', { token: user.token })).status, 204);
    assert.equal(await reason, 'io server disconnect');
    await sleep(200);
    assert.ok(second.socket.connected, 'the other session keeps its connection');
  });

  test('freeze with sign-out disconnects every session of the user', async () => {
    const user = await registerUser('signout');
    const a = await connect(user.token);
    const b = await connect(await login(user.email));
    const waits = [disconnected(a.socket), disconnected(b.socket)];
    const res = await asAdmin('POST', `/admin/users/${user.id}/freeze`, { json: { reason: 'Sign-out test', signOut: true } });
    assert.equal(res.status, 200);
    assert.deepEqual(await Promise.all(waits), ['io server disconnect', 'io server disconnect']);
    await assert.rejects(connect(user.token), (error) => error.message === 'SESSION_REVOKED');
  });
});

// ── Simulator guards ────────────────────────────────────────────────────────────────────

describe('simulator guards', () => {
  test('refuses while the demo account is missing, not flagged, or an administrator', async () => {
    let status = await asAdmin('GET', '/admin/simulator/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.data.enabled, true);
    assert.equal(status.body.data.demoUser, null);
    assert.match(status.body.data.problem, /does not exist/);
    let res = await asAdmin('POST', '/admin/simulator/seed');
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DEMO_USER_UNAVAILABLE');

    const demo = await createUserWithWorkspace({ name: 'Demo Account', email: DEMO_EMAIL, password: DEMO_PASSWORD });
    res = await asAdmin('POST', '/admin/simulator/seed');
    assert.equal(res.status, 409, 'not flagged isDemoUser');
    assert.match(res.body.error.message, /not flagged/);

    await db.collection('users').updateOne({ _id: demo._id }, { $set: { isDemoUser: true, role: 'admin' } });
    for (const route of ['/admin/simulator/seed', '/admin/simulator/reset']) {
      res = await asAdmin('POST', route);
      assert.equal(res.status, 409, route);
      assert.match(res.body.error.message, /administrator/);
    }
    res = await asAdmin('POST', '/admin/simulator/run', { json: { scenario: 'ransomware-like' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'DEMO_USER_UNAVAILABLE');

    await db.collection('users').updateOne({ _id: demo._id }, { $set: { role: 'user' } });
    status = await asAdmin('GET', '/admin/simulator/status');
    assert.equal(status.body.data.demoUser.email, DEMO_EMAIL);
    assert.equal(status.body.data.problem, null);

    // Every refusal is in the audit log (adminAction).
    const audit = await db.collection('adminauditlogs').find({ action: { $in: ['SIMULATOR_SEED', 'SIMULATOR_RESET', 'SIMULATOR_RUN'] }, result: 'FAILURE' }).toArray();
    assert.ok(audit.length >= 5);
  });

  test('non-admins get 403; bodies are validated', async () => {
    const user = await registerUser('nonadmin');
    for (const [method, route] of [['GET', '/admin/simulator/status'], ['POST', '/admin/simulator/seed'], ['POST', '/admin/simulator/run'], ['POST', '/admin/simulator/reset']]) {
      assert.equal((await api(method, route, { token: user.token, ...(method === 'POST' ? { json: {} } : {}) })).status, 403, route);
    }
    assert.equal((await api('GET', '/admin/simulator/status')).status, 401);
    for (const body of [{}, { scenario: 'wipe-everything' }, { scenario: 'ransomware-like', paceMs: 5 }, { scenario: 'ransomware-like', paceMs: 99999 }, { scenario: 'normal-use', extra: 1 }]) {
      const res = await asAdmin('POST', '/admin/simulator/run', { json: body });
      assert.equal(res.status, 422, JSON.stringify(body));
    }
  });
});

// ── Seed, the attack, reset, normal use ─────────────────────────────────────────────────

let demoId;
let bystander;
let bystanderBefore;
let runOutcome;

describe('seed', () => {
  test('uploads demo-data through the API; idempotent; a run right after seeding is refused', async () => {
    // A bystander with files, a folder and a share link: the reset must never touch them.
    bystander = await registerUser('bystander');
    const folder = await api('POST', '/folders', { token: bystander.token, json: { name: 'documents' } });
    const kept = await upload(bystander, 'keep-me.txt', 'bystander content', folder.body.data.id);
    const link = await api('POST', `/files/${kept.id}/shares`, { token: bystander.token, json: { permission: 'VIEW', expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
    assert.equal(link.status, 201);

    const first = await asAdmin('POST', '/admin/simulator/seed');
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.data.uploaded, 15);
    demoId = first.body.data.demoUserId;
    const again = await asAdmin('POST', '/admin/simulator/seed');
    assert.equal(again.body.data.uploaded, 0);
    assert.equal(again.body.data.skipped, 15);

    const folders = await db.collection('folders').find({ ownerId: oid(demoId), isRoot: { $ne: true } }).toArray();
    assert.deepEqual(folders.map((entry) => entry.name).sort(), ['documents', 'finance', 'projects']);
    const uploads = await db.collection('activities').countDocuments({ userId: oid(demoId), action: 'UPLOAD' });
    assert.equal(uploads, 15, 'real UPLOAD activity through the API');
    const sessions = await db.collection('sessions').find({ userId: oid(demoId) }).toArray();
    assert.ok(sessions.length >= 2 && sessions.every((session) => session.status === 'REVOKED'), 'the simulator signs out after each job');

    const early = await asAdmin('POST', '/admin/simulator/run', { json: { scenario: 'ransomware-like' } });
    assert.equal(early.status, 409);
    assert.equal(early.body.error.code, 'SEED_IN_WINDOW');
    assert.ok(early.body.error.details.retryAfterSeconds > 0);

    bystanderBefore = await snapshotOf(bystander.id);
  });
});

describe('end to end: ransomware-like run', () => {
  test('CRITICAL before the run finishes; the simulator stops on 423; exactly one incident; events in order', async () => {
    await ageFixtures(demoId);
    const demoSocket = await connect(await login(DEMO_EMAIL, DEMO_PASSWORD));
    const adminStart = adminSocket.events.length;

    const started = await asAdmin('POST', '/admin/simulator/run', { json: { scenario: 'ransomware-like', paceMs: 40 } });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    assert.equal(started.body.data.state, 'running');
    const busy = await asAdmin('POST', '/admin/simulator/run', { json: { scenario: 'normal-use' } });
    assert.equal(busy.status, 409);
    assert.equal(busy.body.error.code, 'SIMULATOR_BUSY');
    assert.equal((await asAdmin('POST', '/admin/simulator/seed')).body.error.code, 'SIMULATOR_BUSY');

    const status = await waitForIdle();
    const run = status.lastRun;
    runOutcome = run;
    assert.equal(run.state, 'stopped');
    assert.equal(run.stoppedReason, 'frozen by ShieldShare');
    assert.ok(run.step < run.total, `stopped before finishing (${run.step}/${run.total})`);
    assert.ok(run.incident?.incidentNumber, 'the run links the incident');
    assert.ok(run.msFirstWriteToFreeze > 0);

    const user = await db.collection('users').findOne({ _id: oid(demoId) });
    assert.equal(user.status, 'FROZEN');
    const incidents = await db.collection('securityincidents').find({ userId: oid(demoId) }).toArray();
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].severity, 'CRITICAL');
    assert.equal(incidents[0].status, 'CONTAINED');
    assert.equal(incidents[0].canaryTriggered, true);
    const peak = await db.collection('riskevaluations').findOne({ _id: incidents[0].peakEvaluationId });
    const signals = peak.signals.filter((signal) => signal.points > 0);
    assert.equal(Math.round(signals.reduce((sum, signal) => sum + signal.points, 0) * 10) / 10, peak.rawScore);
    assert.ok(peak.categories.length >= 2);

    // Events: allow the last activity batch to arrive.
    await sleep(500);
    const events = adminSocket.events.slice(adminStart);
    const order = ['risk.updated', 'incident.created', 'user.frozen', 'file.quarantined'].map((name) => firstIndex(events, name));
    assert.ok(order.every((index) => index >= 0), `all present: ${order}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `risk.updated → incident.created → user.frozen → file.quarantined: ${order}`);
    assert.ok(firstIndex(events, 'canary.triggered') >= 0);
    assert.ok(byEvent(events, 'security.alert').some((entry) => entry.payload.data.severity === 'CRITICAL'));
    const created = byEvent(events, 'incident.created')[0].payload.data;
    assert.deepEqual(Object.keys(created).sort(), ['incidentId', 'incidentNumber', 'riskScore', 'severity', 'userId']);
    assert.equal(created.incidentNumber, incidents[0].incidentNumber);
    assert.equal(byEvent(events, 'file.quarantined').length, incidents[0].affectedFiles.length);

    // Envelope and unique eventIds, across everything both sockets received.
    const all = [...adminSocket.events, ...demoSocket.events];
    for (const { payload } of all) {
      assert.deepEqual(Object.keys(payload).sort(), ['at', 'data', 'eventId']);
      assert.match(payload.eventId, /^[0-9a-f-]{36}$/);
    }
    assert.equal(new Set(all.map(({ payload }) => payload.eventId)).size, all.length);

    // activity.created: batched, at most one emit per 200 ms, items carry the risk level.
    const batches = byEvent(events, 'activity.created');
    assert.ok(batches.length >= 2);
    const times = batches.map((entry) => Date.parse(entry.payload.at)).sort((a, b) => a - b);
    for (let index = 1; index < times.length; index += 1) {
      assert.ok(times[index] - times[index - 1] >= 190, `emits ${times[index] - times[index - 1]} ms apart`);
    }
    const items = batches.flatMap((entry) => entry.payload.data.items);
    assert.ok(items.some((item) => ['MODIFY', 'RENAME'].includes(item.action) && item.severity === 'CRITICAL'), 'the operation that crossed CRITICAL');
    assert.ok(items.some((item) => item.action === 'CANARY_TRIGGER' && item.isCanary));
    assert.ok(items.some((item) => item.action === 'FREEZE' && item.actor === 'SYSTEM' && item.incidentId === String(incidents[0]._id)));

    // simulator.progress: every write reported, the last one says why it stopped.
    const progress = byEvent(events, 'simulator.progress').map((entry) => entry.payload.data);
    assert.equal(progress.at(-1).stoppedReason, 'frozen by ShieldShare');
    assert.match(progress.at(-1).lastAction, /^423 Locked on /);
    assert.ok(progress.some((entry) => /\(hidden file\)/.test(entry.lastAction)), 'a canary was touched');

    // The demo account's own socket: the notice only, after containment finished.
    const notices = demoSocket.events.map((entry) => entry.event);
    assert.deepEqual(notices, ['user.frozen']);
    assert.deepEqual(Object.keys(demoSocket.events[0].payload.data), ['notice']);
    const lastQuarantine = Math.max(...byEvent(events, 'file.quarantined').map((entry) => Date.parse(entry.payload.at)));
    assert.ok(Date.parse(demoSocket.events[0].payload.at) >= lastQuarantine, 'notice sent once the files are quarantined');

    const breakdown = signals.map((signal) => `${signal.key} ${signal.level} +${signal.points}`).join(', ');
    console.log(`[phase4] ransomware-like: ${run.step}/${run.total} operations before the freeze; first write → freeze ${run.msFirstWriteToFreeze} ms; `
      + `${incidents[0].incidentNumber} ${peak.severity} score ${peak.score} (raw ${peak.rawScore}); ${breakdown}`);
  });

  test('analytics read the stored records; empty ranges are empty; ranges are validated', async () => {
    const from = new Date(Date.now() - 3_600_000).toISOString();
    const timeline = await asAdmin('GET', `/admin/analytics/risk-timeline?from=${from}&bucket=1m`);
    assert.equal(timeline.status, 200);
    assert.ok(timeline.body.data.length >= 1);
    const incident = await db.collection('securityincidents').findOne({ userId: oid(demoId) });
    assert.equal(Math.max(...timeline.body.data.map((point) => point.maxRisk)), incident.riskScore);
    assert.ok(timeline.body.data.some((point) => point.maxSeverity === 'CRITICAL'));
    assert.deepEqual(timeline.body.meta.bands, { suspicious: 30, high: 60, critical: 80 });

    const severity = await asAdmin('GET', `/admin/analytics/severity-distribution?from=${from}`);
    const bySeverity = Object.fromEntries(severity.body.data.map((row) => [row.severity, row.count]));
    assert.ok(bySeverity.CRITICAL >= 1);
    const scored = await db.collection('activities').countDocuments({ action: { $in: ['UPLOAD', 'MODIFY', 'RENAME', 'MOVE', 'DELETE'] }, riskSeverity: { $exists: true }, timestamp: { $gte: new Date(from) } });
    assert.equal(severity.body.data.reduce((sum, row) => sum + row.count, 0), scored);

    const activity = await asAdmin('GET', `/admin/analytics/activity-distribution?from=${from}`);
    const byAction = Object.fromEntries(activity.body.data.map((row) => [row.action, row.count]));
    assert.equal(byAction.MODIFY, await db.collection('activities').countDocuments({ action: 'MODIFY', timestamp: { $gte: new Date(from) } }));
    assert.ok(byAction.RENAME >= 1 && byAction.QUARANTINE >= 1 && byAction.FREEZE >= 1);

    const empty = 'from=2001-01-01T00:00:00Z&to=2001-01-02T00:00:00Z';
    for (const route of ['risk-timeline', 'severity-distribution', 'activity-distribution']) {
      const res = await asAdmin('GET', `/admin/analytics/${route}?${empty}`);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.data, [], route);
    }
    assert.equal((await asAdmin('GET', '/admin/analytics/risk-timeline?from=2026-02-01&to=2026-01-01')).status, 422);
    assert.equal((await asAdmin('GET', '/admin/analytics/risk-timeline?bucket=7m')).status, 422);
    assert.equal((await asAdmin('GET', '/admin/analytics/risk-timeline?from=2026-01-01&to=2026-03-01&bucket=1m')).status, 422);

    const feed = await asAdmin('GET', `/admin/activity?userId=${demoId}&actions=MODIFY,CANARY_TRIGGER&limit=100`);
    assert.equal(feed.status, 200);
    assert.ok(feed.body.data.every((item) => ['MODIFY', 'CANARY_TRIGGER'].includes(item.action) && item.userId === demoId));
    assert.ok(feed.body.data.some((item) => ['HIGH', 'CRITICAL'].includes(item.severity) && item.incidentNumber === incident.incidentNumber));
    assert.ok(feed.body.data.some((item) => item.action === 'CANARY_TRIGGER' && item.isCanary));
    assert.equal((await asAdmin('GET', '/admin/activity?actions=DROP_TABLES')).status, 422);
    const user = await registerUser('feedcheck');
    assert.equal((await api('GET', '/admin/activity', { token: user.token })).status, 403);
    assert.equal((await api('GET', '/admin/analytics/risk-timeline', { token: user.token })).status, 403);
  });

  test('recovery after the simulated attack: restore all → RECOVERED, with live events', async () => {
    const incident = await db.collection('securityincidents').findOne({ userId: oid(demoId) });
    const seen = adminSocket.events.length;
    const res = await asAdmin('POST', `/admin/incidents/${incident._id}/restore-all`);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.incidentStatus, 'RECOVERED');
    const restored = res.body.data.results.filter((result) => result.result === 'RESTORED');
    assert.equal(restored.length, incident.affectedFiles.length);
    assert.ok(restored.every((result) => result.verification.passed && !result.restoredName.endsWith('.locked')));
    await until(() => byEvent(adminSocket.events.slice(seen), 'incident.updated').some((entry) => entry.payload.data.status === 'RECOVERED'), { label: 'incident.updated RECOVERED' });
    assert.equal(byEvent(adminSocket.events.slice(seen), 'recovery.completed').length, restored.length);
  });
});

describe('reset', () => {
  test('demo workspace back to its seed state, account ACTIVE, incidents RESOLVED "demo reset"; nobody else touched', async () => {
    const incident = await db.collection('securityincidents').findOne({ userId: oid(demoId) });
    const res = await asAdmin('POST', '/admin/simulator/reset');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.unfrozen, true);
    assert.deepEqual(res.body.data.closedIncidents, [incident.incidentNumber]);
    assert.equal(res.body.data.seeded.uploaded, 15);
    const templates = fs.readdirSync(path.join(serverDir, '.shieldshare', 'canary')).filter((name) => !name.startsWith('.'));
    assert.equal(res.body.data.canaries, templates.length, 'canaries re-seeded by the Phase 3 logic');

    const user = await db.collection('users').findOne({ _id: oid(demoId) });
    assert.equal(user.status, 'ACTIVE');
    assert.equal(user.securityStatus, 'SAFE');
    const closed = await db.collection('securityincidents').find({ userId: oid(demoId) }).toArray();
    assert.ok(closed.every((entry) => entry.status === 'RESOLVED' && entry.resolutionNote === 'demo reset'));
    assert.ok(await db.collection('adminauditlogs').findOne({ action: 'RESOLVE_INCIDENT', 'target.id': incident._id, note: 'demo reset', result: 'SUCCESS' }));
    assert.ok(await db.collection('adminauditlogs').findOne({ action: 'SIMULATOR_RESET', result: 'SUCCESS', 'target.id': oid(demoId) }));

    const files = await db.collection('files').find({ ownerId: oid(demoId) }).toArray();
    assert.equal(files.filter((file) => !file.isCanary).length, 15);
    assert.equal(files.filter((file) => file.isCanary).length, templates.length);
    assert.ok(files.every((file) => file.status === 'ACTIVE' && file.currentVersion === 1 && !file.name.endsWith('.locked')));
    const fileIds = files.map((file) => file._id);
    assert.equal(await db.collection('quarantineitems').countDocuments({ fileId: { $in: fileIds } }), 0);
    assert.equal(await db.collection('versions').countDocuments({ fileId: { $in: fileIds } }), files.length);
    const blobs = new Set(fs.readdirSync(path.join(STORAGE_DIR, 'blobs')));
    const referenced = await db.collection('versions').find({}, { projection: { storageKey: 1 } }).toArray();
    assert.ok(referenced.every((version) => blobs.has(version.storageKey)), 'no referenced blob was removed');
    assert.equal(blobs.size, referenced.length, 'the demo account\'s old blobs are gone');

    // The bystander's files, versions, links, folders and account are byte-for-byte unchanged.
    assert.deepEqual(await snapshotOf(bystander.id), bystanderBefore);
    const res2 = await api('GET', '/files', { token: bystander.token });
    assert.deepEqual(res2.body.data.map((file) => file.name), ['keep-me.txt']);
  });
});

describe('normal use', () => {
  test('normal-use at human pace stays SAFE: no evaluation stored, no incident', async () => {
    await ageFixtures(demoId);
    const since = new Date();
    const res = await asAdmin('POST', '/admin/simulator/run', { json: { scenario: 'normal-use', paceMs: 300 } });
    assert.equal(res.status, 202);
    const status = await waitForIdle();
    assert.equal(status.lastRun.state, 'completed');
    assert.equal(status.lastRun.step, status.lastRun.total);
    assert.equal(status.lastRun.total, 4);
    const user = await db.collection('users').findOne({ _id: oid(demoId) });
    assert.equal(user.status, 'ACTIVE');
    assert.equal(user.securityStatus, 'SAFE');
    assert.equal(await db.collection('riskevaluations').countDocuments({ userId: oid(demoId), createdAt: { $gte: since } }), 0);
    assert.equal(await db.collection('securityincidents').countDocuments({ userId: oid(demoId), createdAt: { $gte: since } }), 0);
    const scored = await db.collection('activities').find({ userId: oid(demoId), timestamp: { $gte: since }, action: { $in: ['UPLOAD', 'MODIFY'] } }).toArray();
    assert.equal(scored.length, 4);
    assert.ok(scored.every((activity) => activity.riskSeverity === 'SAFE'));
  });
});

describe('Phase 3 gap fixed: user restore while a file is in an open incident', () => {
  test('refused with 409 FILE_UNDER_REVIEW (no incident details); allowed once the incident is closed', async () => {
    const user = await registerUser('restoregap');
    const file = await upload(user, 'notes.txt', 'version one');
    const form = new FormData();
    form.append('file', new Blob(['version two'], { type: 'text/plain' }), 'notes.txt');
    assert.equal((await api('PUT', `/files/${file.id}/content`, { token: user.token, form })).status, 200);
    const versions = await api('GET', `/files/${file.id}/versions`, { token: user.token });
    const v1 = versions.body.data.find((version) => version.versionNumber === 1);

    // An open HIGH incident (not contained, so the file is not quarantined).
    const { insertedId } = await db.collection('securityincidents').insertOne({
      incidentNumber: 'SH-9901', userId: oid(user.id), status: 'OPEN', riskScore: 65, severity: 'HIGH',
      windowStart: new Date(), affectedFiles: [oid(file.id)], timeline: [], createdAt: new Date(), updatedAt: new Date(),
    });
    let res = await api('POST', `/files/${file.id}/versions/${v1.id}/restore`, { token: user.token });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'FILE_UNDER_REVIEW');
    assert.doesNotMatch(JSON.stringify(res.body), /SH-9901|incident|risk/i);

    await db.collection('securityincidents').updateOne({ _id: insertedId }, { $set: { status: 'RESOLVED' } });
    res = await api('POST', `/files/${file.id}/versions/${v1.id}/restore`, { token: user.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });
});
