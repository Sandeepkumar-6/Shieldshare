// Starts everything the demo needs, in order, with one command (from the repository root):
//
//   node scripts/start-demo.mjs              ML service → API → web client
//   node scripts/start-demo.mjs --no-ml      without the ML service (detection still works)
//   node scripts/start-demo.mjs --simulator  also enables the controlled simulator for this run
//
// Prerequisites: MongoDB running, `npm install` in server/ and client/, server/.env and
// client/.env filled in, `npm run seed` done once, and for the ML service its .venv with a
// trained model (see README). Ctrl+C stops all three. No dependencies beyond Node.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const withMl = !args.has('--no-ml');
const withSimulator = args.has('--simulator');
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

const envFile = path.join(root, 'server', '.env');
if (!fs.existsSync(envFile)) {
  console.error('server/.env is missing. Copy server/.env.example to server/.env and fill it in.');
  process.exit(1);
}
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)).filter(Boolean).map((match) => [match[1], match[2]]));
const apiPort = Number(env.PORT || 5000);

const children = [];
function start(name, command, commandArgs, options) {
  const child = spawn(command, commandArgs, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  const prefix = `[${name}]`.padEnd(6);
  for (const stream of [child.stdout, child.stderr]) {
    let buffered = '';
    stream.on('data', (chunk) => {
      buffered += chunk.toString();
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop();
      for (const line of lines) if (line.trim()) console.log(`${prefix} ${line}`);
    });
  }
  child.on('exit', (code) => {
    console.log(`${prefix} exited (${code ?? 'signal'})`);
    if (!stopping) stopAll(1);
  });
  children.push(child);
  return child;
}

async function waitFor(name, url, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error(`${name} did not answer at ${url} within ${timeoutMs / 1000} s`);
}

let stopping = false;
function stopAll(code = 0) {
  stopping = true;
  for (const child of children) if (!child.killed) child.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

try {
  if (withMl) {
    const venv = path.join(root, 'ml-service', '.venv');
    const python = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
    if (!fs.existsSync(python)) throw new Error('ml-service/.venv is missing. Set it up (README) or run with --no-ml.');
    start('ml', python, ['-m', 'uvicorn', 'app:app', '--host', '127.0.0.1', '--port', '8000'], { cwd: path.join(root, 'ml-service') });
    await waitFor('ML service', 'http://127.0.0.1:8000/health');
    console.log('[demo] ML service up on http://127.0.0.1:8000');
  }

  const apiEnv = { ...process.env, ...(withSimulator ? { SIMULATOR_ENABLED: 'true' } : {}), ...(withMl ? {} : { ML_ENABLED: 'false' }) };
  start('api', process.execPath, ['src/server.js'], { cwd: path.join(root, 'server'), env: apiEnv });
  await waitFor('API', `http://127.0.0.1:${apiPort}/api/health`);
  console.log(`[demo] API up on http://localhost:${apiPort}${withSimulator ? ' (simulator enabled)' : ''}`);

  start('web', process.execPath, [path.join('node_modules', 'vite', 'bin', 'vite.js'), '--port', '5173', '--strictPort'], { cwd: path.join(root, 'client') });
  await waitFor('Web client', 'http://localhost:5173/');
  console.log('[demo] Web client up on http://localhost:5173  (Ctrl+C stops everything)');
  const setting = (name) => process.env[name] || env[name];
  if (withSimulator && !(setting('SIMULATOR_DEMO_USER_EMAIL') && setting('SIMULATOR_DEMO_USER_PASSWORD'))) {
    console.log('[demo] note: set SIMULATOR_DEMO_USER_EMAIL and SIMULATOR_DEMO_USER_PASSWORD in server/.env, then run `npm run seed` in server/.');
  }
} catch (error) {
  console.error(`[demo] ${error.message}`);
  stopAll(1);
}
