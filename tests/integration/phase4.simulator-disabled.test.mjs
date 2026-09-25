// Spec §30 rule 1: with SIMULATOR_ENABLED anything other than exactly "true", every simulator
// route answers 404, for anonymous callers, users and administrators alike, and nothing runs
// or is audited. Its own process, because the setting is read once at startup.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
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

let mongo;
let app;

before(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGO_URI: mongo.getUri('shieldshare_p4_disabled'),
    STORAGE_DIR: path.join(os.tmpdir(), 'shieldshare-test-storage-p4-disabled'),
    NODE_ENV: 'test',
    API_RATE_LIMIT_PER_MINUTE: '5000',
    SIMULATOR_ENABLED: 'TRUE', // not exactly "true": disabled
    SIMULATOR_DEMO_USER_EMAIL: 'demo.disabled@test.local',
    SIMULATOR_DEMO_USER_PASSWORD: 'demo password 123',
  });
  const serverUrl = (file) => new URL(`../../server/src/${file}`, import.meta.url);
  const { initialize } = await import(serverUrl('startup.js'));
  const { createApp } = await import(serverUrl('app.js'));
  const { createUserWithWorkspace } = await import(serverUrl('services/auth.service.js'));
  await initialize();
  app = createApp();
  await createUserWithWorkspace({ name: 'Admin', email: 'admin.disabled@test.local', password: 'admin password 123', role: 'admin' });
  const demo = await createUserWithWorkspace({ name: 'Demo', email: 'demo.disabled@test.local', password: 'demo password 123' });
  await mongoose.connection.db.collection('users').updateOne({ _id: demo._id }, { $set: { isDemoUser: true } });
});

after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

test('every simulator route is 404 for everyone; the rest of /api/admin still works', async () => {
  const adminLogin = await request(app).post('/api/auth/login').send({ email: 'admin.disabled@test.local', password: 'admin password 123' });
  const register = await request(app).post('/api/auth/register').send({ name: 'User', email: 'user.disabled@test.local', password: 'correct horse battery' });
  const tokens = { anonymous: null, user: register.body.data.accessToken, admin: adminLogin.body.data.accessToken };

  const routes = [
    ['get', '/api/admin/simulator/status'],
    ['post', '/api/admin/simulator/seed'],
    ['post', '/api/admin/simulator/run'],
    ['post', '/api/admin/simulator/reset'],
    ['get', '/api/admin/simulator/anything-else'],
  ];
  for (const [who, token] of Object.entries(tokens)) {
    for (const [method, route] of routes) {
      const req = request(app)[method](route);
      if (token) req.set('Authorization', `Bearer ${token}`);
      const res = await req.send({ scenario: 'ransomware-like' });
      assert.equal(res.status, 404, `${who} ${method} ${route}`);
      assert.deepEqual(res.body, { error: { code: 'NOT_FOUND', message: 'Not found.', details: null } });
    }
  }

  const db = mongoose.connection.db;
  assert.equal(await db.collection('adminauditlogs').countDocuments({ action: /^SIMULATOR_/ }), 0, 'nothing was attempted');
  const demo = await db.collection('users').findOne({ email: 'demo.disabled@test.local' });
  assert.equal(await db.collection('sessions').countDocuments({ userId: demo._id }), 0, 'the simulator never signed in');

  const summary = await request(app).get('/api/admin/summary').set('Authorization', `Bearer ${tokens.admin}`);
  assert.equal(summary.status, 200);
});
