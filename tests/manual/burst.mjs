// Manual-test driver for the Phase 3 UI check. NOT the Phase 4 simulator: it is not part of
// the server or the app, it only calls the public REST API as the account you give it, like
// any other client, and it refuses administrator accounts.
//
//   node tests/manual/burst.mjs setup   uploads 12 text files into Home, Finance and Projects
//   (wait at least 60 seconds so those files predate the detection window)
//   node tests/manual/burst.mjs run     modifies all 12, renames 10 to *.locked, touches a
//                                       canary, then tries to delete files (expect 423)
//
// Options: --email, --password (default: SEED_USER_* from server/.env), --api (default
// http://localhost:5000).

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
try { process.loadEnvFile(path.join(root, 'server', '.env')); } catch { /* optional */ }

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};
const mode = args.find((arg) => !arg.startsWith('--') && !args[args.indexOf(arg) - 1]?.startsWith('--'));
const API = option('api', 'http://localhost:5000').replace(/\/+$/, '');
const email = option('email', process.env.SEED_USER_EMAIL);
const password = option('password', process.env.SEED_USER_PASSWORD);

if (!['setup', 'run'].includes(mode) || !email || !password) {
  console.log('Usage: node tests/manual/burst.mjs setup|run [--email you@example.com --password ...] [--api http://localhost:5000]');
  process.exit(1);
}

async function call(method, route, { token, json, form } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let body;
  if (json) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }
  const res = await fetch(`${API}/api${route}`, { method, headers, body });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, data };
}

const login = await call('POST', '/auth/login', { json: { email, password } });
if (login.status !== 200) {
  console.error(`Sign-in failed (${login.status}): ${login.data?.error?.message}`);
  process.exit(1);
}
const token = login.data.data.accessToken;
if (login.data.data.user.role === 'admin') {
  console.error('Refusing to run as an administrator account. Use a normal user.');
  process.exit(1);
}

const folders = (await call('GET', '/folders', { token })).data.data;
const folderId = async (name) => {
  const existing = folders.find((folder) => folder.name === name);
  if (existing) return existing.id;
  const created = await call('POST', '/folders', { token, json: { name } });
  return created.data.data.id;
};

if (mode === 'setup') {
  const targets = [folders.find((folder) => folder.isRoot).id, await folderId('Finance'), await folderId('Projects')];
  for (let i = 0; i < 12; i += 1) {
    const form = new FormData();
    form.append('folderId', targets[i % 3]);
    form.append('file', new Blob([`Quarterly planning notes, part ${i + 1}\n`.repeat(40)], { type: 'text/plain' }), `planning-notes-${String(i + 1).padStart(2, '0')}.txt`);
    const res = await call('POST', '/files', { token, form });
    console.log(`upload planning-notes-${String(i + 1).padStart(2, '0')}.txt → ${res.status}`);
  }
  console.log('\nSetup done. Wait at least 60 seconds, then: node tests/manual/burst.mjs run');
  process.exit(0);
}

// run
const files = (await call('GET', '/files?q=planning-notes&limit=50', { token })).data.data
  .filter((file) => file.status === 'ACTIVE' && !file.name.endsWith('.locked'))
  .slice(0, 12);
if (files.length < 12) {
  console.error(`Found ${files.length} planning-notes files; run "setup" first (and wait 60 s).`);
  process.exit(1);
}
const report = (label, res) => console.log(`${String(res.status).padEnd(4)} ${label}${res.status === 423 ? '   ← frozen (423 Locked)' : ''}`);

for (const [index, file] of files.entries()) {
  const form = new FormData();
  form.append('file', new Blob([`ENCRYPTED ${index} ${crypto.randomUUID()}${crypto.randomUUID()}`], { type: 'text/plain' }), 'x.txt');
  report(`modify ${file.name}`, await call('PUT', `/files/${file.id}/content`, { token, form }));
}
for (const file of files.slice(0, 10)) {
  report(`rename ${file.name} → ${file.name}.locked`, await call('PATCH', `/files/${file.id}`, { token, json: { name: `${file.name}.locked` } }));
}
const all = (await call('GET', '/files?all=true&limit=100', { token })).data.data;
const visible = new Set((await call('GET', '/files?limit=100', { token })).data.data.map((file) => file.id));
const hidden = all.find((file) => !visible.has(file.id) && file.status === 'ACTIVE');
if (hidden) {
  const form = new FormData();
  form.append('file', new Blob([`ENCRYPTED ${crypto.randomUUID()}`], { type: 'text/plain' }), 'x.txt');
  report(`modify ${hidden.name} (found via ?all=true)`, await call('PUT', `/files/${hidden.id}/content`, { token, form }));
}
for (const file of files.slice(0, 3)) {
  report(`delete ${file.name}`, await call('DELETE', `/files/${file.id}`, { token }));
}
console.log('\nDone. Open /admin/incidents as an administrator.');
