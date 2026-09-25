// Phase 6 regression tests.
// Asynchronous ML re-evaluation (spec §15, decisions P5-3, P6-1):
//   - storing a WITH_ML evaluation (and escalating) waits for the user's evaluation queue,
//     so it can never race an inline evaluation into a second incident;
//   - a SAFE window still reaches the ML service once it holds ml.minOperations operations;
//   - a burst with the ML service contributing ends in exactly one incident.
// Detection settings history (P6-3): versions newest first, who and when, admin only.
// In-process API (supertest) on mongodb-memory-server, with a local fake ML service.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const requireServer = createRequire(path.join(repoRoot, 'server', 'package.json'));
const { MongoMemoryServer } = requireServer('mongodb-memory-server');
const request = requireServer('supertest');
const mongoose = requireServer('mongoose');

const LOCAL_MONGOD = 'C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe';
if (!process.env.MONGOMS_SYSTEM_BINARY && fs.existsSync(LOCAL_MONGOD)) {
  process.env.MONGOMS_SYSTEM_BINARY = LOCAL_MONGOD;
  const version = /db version v([\d.]+)/.exec(execFileSync(LOCAL_MONGOD, ['--version']).toString())?.[1];
  if (version) process.env.MONGOMS_VERSION = version;
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const oid = (value) => new mongoose.Types.ObjectId(String(value));

let mongo;
let app;
let db;
let fakeMl;
let mlRequests = [];
let adminToken;
let detection;
let userQueue;
let windowStore;
let activeConfig;

// Fake ML service: every window is scored fully anomalous (the weight caps its points).
function startFakeMl() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.url === '/score') mlRequests.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(req.url === '/health'
          ? { status: 'ok' }
          : { anomalyScore: 1, isAnomaly: true, raw: -0.9, modelVersion: 'fake-test-model' }));
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function registerUser(label) {
  const email = `${label}.${crypto.randomBytes(4).toString('hex')}@test.local`;
  const res = await request(app).post('/api/auth/register').send({ name: `Test ${label}`, email, password: 'correct horse battery' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { email, token: res.body.data.accessToken, id: res.body.data.user.id };
}

async function upload(user, name, folderId) {
  const req = request(app).post('/api/files').set(auth(user.token));
  if (folderId) req.field('folderId', folderId);
  const res = await req.attach('file', Buffer.from(`${name}\n${'plain text line\n'.repeat(40)}`), { filename: name, contentType: 'text/plain' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.file;
}

async function ageFixtures(userId) {
  const past = new Date(Date.now() - 10 * 60_000);
  await db.collection('activities').updateMany({ userId: oid(userId) }, { $set: { timestamp: past } });
  await db.collection('versions').updateMany({ createdBy: oid(userId) }, { $set: { createdAt: past } });
  await windowStore.rebuild((await activeConfig()).windowSeconds);
}

async function settle(ms = 1500) {
  // Let queued setImmediate ML jobs call the fake service and store their evaluations.
  await sleep(ms);
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  fakeMl = await startFakeMl();
  Object.assign(process.env, {
    MONGO_URI: mongo.getUri('shieldshare_p6_ml'),
    STORAGE_DIR: path.join(os.tmpdir(), 'shieldshare-test-storage-p6-ml'),
    NODE_ENV: 'test',
    API_RATE_LIMIT_PER_MINUTE: '5000',
    ML_ENABLED: 'true',
    ML_SERVICE_URL: `http://127.0.0.1:${fakeMl.address().port}`,
  });
  fs.rmSync(process.env.STORAGE_DIR, { recursive: true, force: true });

  const serverUrl = (file) => new URL(`../../server/src/${file}`, import.meta.url);
  const { initialize } = await import(serverUrl('startup.js'));
  const { createApp } = await import(serverUrl('app.js'));
  const { createUserWithWorkspace } = await import(serverUrl('services/auth.service.js'));
  detection = await import(serverUrl('security/detection.service.js'));
  userQueue = await import(serverUrl('security/userQueue.js'));
  windowStore = await import(serverUrl('security/window.store.js'));
  ({ activeConfig } = await import(serverUrl('security/config.service.js')));

  await initialize();
  app = createApp();
  db = mongoose.connection.db;
  await createUserWithWorkspace({ name: 'Admin', email: 'admin.p6ml@test.local', password: 'admin password 123', role: 'admin' });
  adminToken = (await request(app).post('/api/auth/login').send({ email: 'admin.p6ml@test.local', password: 'admin password 123' })).body.data.accessToken;
});

after(async () => {
  await new Promise((resolve) => { fakeMl.close(resolve); });
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('asynchronous ML re-evaluation', () => {
  test('the WITH_ML evaluation waits for the user\'s queue (no race with inline scoring)', async () => {
    const user = await registerUser('queue');
    const config = await activeConfig();
    const now = new Date();
    const entries = [{ id: String(new mongoose.Types.ObjectId()), action: 'MODIFY', userId: user.id, fileId: String(new mongoose.Types.ObjectId()), timestamp: now }];
    const inlineRisk = { severity: 'SUSPICIOUS' };

    // Hold the user's queue, as an inline evaluation in progress would.
    let release;
    const held = userQueue.runExclusive(user.id, () => new Promise((resolve) => { release = resolve; }));
    const ml = detection.runMlEvaluation({ userId: user.id, entries, config, inlineRisk, inlineSignals: [], inlineEvaluation: { incidentId: null }, incident: null });

    await sleep(400);
    assert.equal(await db.collection('riskevaluations').countDocuments({ userId: oid(user.id), phase: 'WITH_ML' }), 0, 'nothing stored while the queue is held');
    release();
    await held;
    const outcome = await ml;
    assert.equal(outcome.result.status, 'OK');
    assert.equal(await db.collection('riskevaluations').countDocuments({ userId: oid(user.id), phase: 'WITH_ML' }), 1, 'stored once the queue is free');
  });

  test('a SAFE window reaches the ML service at ml.minOperations operations; SAFE results are not stored', async () => {
    const put = await request(app).put('/api/admin/config/detection').set(auth(adminToken)).send({ ml: { minOperations: 3 } });
    assert.equal(put.status, 200, JSON.stringify(put.body));
    const user = await registerUser('minops');
    mlRequests = [];

    await upload(user, 'one.txt');
    await upload(user, 'two.txt');
    await settle(600);
    assert.equal(mlRequests.filter((entry) => entry.userId === user.id).length, 0, 'below the minimum: not asked');

    await upload(user, 'three.txt');
    await settle(800);
    assert.equal(mlRequests.filter((entry) => entry.userId === user.id).length, 1, 'at the minimum: asked once');
    assert.equal(await db.collection('riskevaluations').countDocuments({ userId: oid(user.id) }), 0, 'still SAFE with ML: nothing stored');

    await request(app).put('/api/admin/config/detection').set(auth(adminToken)).send({ ml: { minOperations: 10 } });
  });

  test('a burst with ML contributing ends in exactly one incident, with WITH_ML evaluations linked to it', async () => {
    const user = await registerUser('burst');
    const folders = [];
    for (const name of ['alpha', 'beta', 'gamma']) {
      const res = await request(app).post('/api/folders').set(auth(user.token)).send({ name });
      folders.push(res.body.data.id);
    }
    const files = [];
    for (let index = 0; index < 12; index += 1) files.push(await upload(user, `doc-${index}.txt`, folders[index % 3]));
    await ageFixtures(user.id);

    // No pacing: ML answers arrive while later inline evaluations are being made.
    for (const [index, file] of files.entries()) {
      await request(app).put(`/api/files/${file.id}/content`).set(auth(user.token))
        .attach('file', crypto.randomBytes(900), { filename: file.name, contentType: 'application/octet-stream' });
      await request(app).patch(`/api/files/${file.id}`).set(auth(user.token)).send({ name: `${file.name}.locked` });
      if (index % 3 === 2) await sleep(5);
    }
    await settle(2000);

    const incidents = await db.collection('securityincidents').find({ userId: oid(user.id) }).toArray();
    assert.equal(incidents.length, 1, `one incident, got ${incidents.map((incident) => incident.incidentNumber).join(', ')}`);
    const withMl = await db.collection('riskevaluations').find({ userId: oid(user.id), phase: 'WITH_ML' }).toArray();
    assert.ok(withMl.length >= 1);
    assert.ok(withMl.every((evaluation) => evaluation.ml.status === 'OK' && evaluation.ml.modelVersion === 'fake-test-model'));
    assert.ok(withMl.filter((evaluation) => evaluation.incidentId).every((evaluation) => String(evaluation.incidentId) === String(incidents[0]._id)));
  });
});

describe('detection settings history', () => {
  test('versions newest first, exactly one active, attributed to the admin; audited; admin only', async () => {
    const before = await request(app).get('/api/admin/config/detection/versions').set(auth(adminToken));
    assert.equal(before.status, 200);
    const saved = await request(app).put('/api/admin/config/detection').set(auth(adminToken)).send({ thresholds: { massRename: 7 }, weights: { canaryTrigger: 25 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));

    const res = await request(app).get('/api/admin/config/detection/versions').set(auth(adminToken));
    const versions = res.body.data;
    assert.equal(versions.length, before.body.data.length + 1);
    assert.deepEqual(versions.map((version) => version.version), [...versions.map((version) => version.version)].sort((a, b) => b - a));
    assert.equal(versions.filter((version) => version.isActive).length, 1);
    assert.equal(versions[0].isActive, true);
    assert.equal(versions[0].version, saved.body.data.version);
    assert.equal(versions[0].thresholds.massRename, 7);
    assert.equal(versions[0].weights.canaryTrigger, 25);
    assert.deepEqual(Object.keys(versions[0].createdBy).sort(), ['email', 'id', 'name']);
    assert.equal(versions[0].createdBy.email, 'admin.p6ml@test.local');
    assert.equal(versions.at(-1).version, 1);
    assert.equal(versions.at(-1).createdBy, null, 'version 1 comes from the spec defaults');
    assert.ok(await db.collection('adminauditlogs').findOne({ action: 'CONFIG_UPDATE', result: 'SUCCESS', 'after.version': saved.body.data.version }));

    const invalid = await request(app).put('/api/admin/config/detection').set(auth(adminToken)).send({ severityBands: { high: 95 } });
    assert.equal(invalid.status, 422, 'bands must ascend');
    const user = await registerUser('settings');
    assert.equal((await request(app).get('/api/admin/config/detection/versions').set(auth(user.token))).status, 403);
    assert.equal((await request(app).put('/api/admin/config/detection').set(auth(user.token)).send({ weights: { canaryTrigger: 1 } })).status, 403);
  });
});
