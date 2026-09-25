// Shared harness for the integration suites. Each suite gets its own API server, database
// and storage directory, so suites can run in parallel and never touch development data.
// Zero extra dependencies: node:test + native fetch/FormData.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const serverDir = path.join(repoRoot, 'server');
process.loadEnvFile(path.join(serverDir, '.env')); // JWT secret + seed accounts

export const mongoose = createRequire(path.join(serverDir, 'package.json'))('mongoose');
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
export const oid = (value) => new mongoose.Types.ObjectId(String(value));

export function fileForm(name, content, type = 'text/plain', fields = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', new Blob([content], { type }), name);
  return form;
}

export function createHarness({ port, dbName, storageName, maxUploadBytes = 3 * 1024 * 1024 }) {
  const ORIGIN = `http://127.0.0.1:${port}`;
  const BASE = `${ORIGIN}/api`;
  const STORAGE_DIR = path.join(os.tmpdir(), storageName);
  const BLOB_DIR = path.join(STORAGE_DIR, 'blobs');
  const TEST_DB = `mongodb://127.0.0.1:27017/${dbName}`;
  const env = {
    ...process.env,
    PORT: String(port),
    MONGO_URI: TEST_DB,
    STORAGE_DIR,
    MAX_UPLOAD_BYTES: String(maxUploadBytes),
    NODE_ENV: 'test',
  };

  // Every JSON body the server returns is kept for leak scans.
  const responses = [];
  let serverProcess;
  const harness = { ORIGIN, BASE, STORAGE_DIR, BLOB_DIR, responses, env, db: null };

  // `route` is relative to /api unless it starts with "/s/" (public share routes).
  harness.request = async function request(method, route, { token, json, form, headers: extra = {} } = {}) {
    const headers = { ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form) {
      body = form;
    }
    const url = route.startsWith('/s/') ? ORIGIN + route : BASE + route;
    const res = await fetch(url, { method, headers, body });
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await res.json();
      responses.push({ route: `${method} ${route}`, data, public: route.startsWith('/s/') });
      return { status: res.status, body: data, headers: res.headers };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, buffer, headers: res.headers };
  };
  harness.api = harness.request;

  // A hand-written multipart body, for names FormData would normalise (it drops
  // backslashes): a hostile client can send any bytes it likes.
  harness.rawUpload = async function rawUpload(token, filename, content) {
    const boundary = `----shieldshare${crypto.randomBytes(8).toString('hex')}`;
    const body = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n`
      + `Content-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;
    const res = await fetch(`${BASE}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    const data = await res.json();
    responses.push({ route: 'POST /files (raw)', data });
    return { status: res.status, body: data };
  };

  harness.register = async function register(label) {
    const email = `${label}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}@test.local`;
    const res = await harness.api('POST', '/auth/register', {
      json: { name: `Test ${label}`, email, password: 'correct horse battery', role: 'admin' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return { email, password: 'correct horse battery', token: res.body.data.accessToken, user: res.body.data.user };
  };

  harness.loginAdmin = async function loginAdmin() {
    const res = await harness.api('POST', '/auth/login', {
      json: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return { token: res.body.data.accessToken, user: res.body.data.user };
  };

  harness.blobCount = () => (fs.existsSync(BLOB_DIR) ? fs.readdirSync(BLOB_DIR).length : 0);

  async function waitForServer() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        const res = await fetch(`${BASE}/health`);
        if (res.ok) return;
      } catch { /* not up yet */ }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Test server did not start');
  }

  function runSeed() {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['src/scripts/seed-users.js'], { cwd: serverDir, env, stdio: 'pipe' });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('exit', (code) => (code === 0 ? resolve(output) : reject(new Error(output))));
    });
  }

  harness.start = async function start() {
    fs.rmSync(STORAGE_DIR, { recursive: true, force: true });
    const connection = await mongoose.createConnection(TEST_DB).asPromise();
    await connection.dropDatabase();
    harness.connection = connection;
    harness.db = connection.db;

    serverProcess = spawn(process.execPath, ['src/server.js'], { cwd: serverDir, env, stdio: 'pipe' });
    serverProcess.stderr.on('data', (chunk) => process.stderr.write(`[server:${port}] ${chunk}`));
    await waitForServer();
    await runSeed();
  };

  harness.stop = async function stop() {
    serverProcess?.kill();
    await harness.connection?.close();
  };

  // Scans every recorded response for internal fields, storage keys, password hashes and
  // storage paths. `extraSecrets` adds values that must never appear (e.g. token hashes).
  harness.assertNoLeaks = async function assertNoLeaks({ extraSecrets = [], minimum = 20 } = {}) {
    const forbiddenKeys = ['passwordHash', 'tokenHash', 'tokenVersion', 'storageKey', 'isCanary'];
    const forbiddenValues = [STORAGE_DIR, STORAGE_DIR.replaceAll('\\', '/'), JSON.stringify(STORAGE_DIR).slice(1, -1), 'blobs'];
    const [versionKeys, userHashes] = await Promise.all([
      harness.db.collection('versions').distinct('storageKey'),
      harness.db.collection('users').distinct('passwordHash'),
    ]);
    const secrets = [...versionKeys, ...userHashes, ...extraSecrets];
    assert.ok(responses.length >= minimum, `scanned ${responses.length} responses`);

    for (const { route, data } of responses) {
      const text = JSON.stringify(data);
      // Administrators may see canaries (spec §14); users never may.
      const adminRoute = / \/admin\//.test(route);
      for (const key of forbiddenKeys) {
        if (key === 'isCanary' && adminRoute) continue;
        assert.ok(!text.includes(`"${key}"`), `${route} leaked ${key}`);
      }
      for (const value of forbiddenValues) assert.ok(!text.includes(value), `${route} leaked a storage path`);
      for (const secret of secrets) assert.ok(!text.includes(secret), `${route} leaked a secret value`);
    }
    return { scanned: responses.length, secrets: secrets.length };
  };

  return harness;
}
