// Local CLI for the controlled simulator (spec §30). It is a client of the running API: it
// signs in as an administrator (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD from server/.env, or
// --email / --password) and calls /api/admin/simulator/*, so every server-side restriction
// and the audit log apply exactly as for the admin page. It reads no seed files and writes
// nothing to disk.
//
// Usage (from server/, with the API running):
//   npm run sim:seed
//   npm run sim:run                     ransomware-like, default pace
//   npm run sim:run -- --scenario normal-use --pace 1500
//   npm run sim:run -- --wait           wait until freshly seeded files leave the window
//   npm run sim:reset

import { config } from '../config/env.js';

const [command = 'help', ...rest] = process.argv.slice(2);
const flags = {};
for (let index = 0; index < rest.length; index += 1) {
  const arg = rest[index];
  if (!arg.startsWith('--')) continue;
  const next = rest[index + 1];
  if (next === undefined || next.startsWith('--')) flags[arg.slice(2)] = true;
  else {
    flags[arg.slice(2)] = next;
    index += 1;
  }
}

const API = String(flags.api ?? `http://127.0.0.1:${config.port}`).replace(/\/+$/, '');
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

class CliError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let token = null;
async function call(method, route, json) {
  let res;
  try {
    res = await fetch(`${API}/api${route}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) },
      body: json ? JSON.stringify(json) : undefined,
    });
  } catch {
    throw new CliError(0, 'API_UNREACHABLE', `Can't reach the API at ${API}. Start it first (npm run dev).`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new CliError(res.status, body?.error?.code ?? 'HTTP_ERROR', body?.error?.message ?? `HTTP ${res.status}`, body?.error?.details);
  return body?.data;
}

async function signIn() {
  const email = flags.email ?? process.env.SEED_ADMIN_EMAIL;
  const password = flags.password ?? process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) throw new CliError(0, 'NO_ADMIN', 'Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in server/.env, or pass --email and --password.');
  token = (await call('POST', '/auth/login', { email, password })).accessToken;
}

async function signOut() {
  if (token) await call('POST', '/auth/logout').catch(() => {});
}

async function waitForRun(runId) {
  let printed = 0;
  for (;;) {
    const status = await call('GET', '/admin/simulator/status');
    const run = status.lastRun;
    if (run?.id === runId && run.step > printed && run.lastAction) {
      console.log(`  ${String(run.step).padStart(3)}/${run.total ?? '?'}  ${run.lastAction}`);
      printed = run.step;
    }
    if (run?.id === runId && run.state !== 'running' && status.busy !== 'run') return run;
    await sleep(300);
  }
}

async function run() {
  const scenario = flags.scenario ?? 'ransomware-like';
  const paceMs = flags.pace ? Number(flags.pace) : undefined;
  let started;
  try {
    started = await call('POST', '/admin/simulator/run', { scenario, ...(paceMs ? { paceMs } : {}) });
  } catch (error) {
    if (error.code !== 'SEED_IN_WINDOW' || !flags.wait) throw error;
    const seconds = error.details?.retryAfterSeconds ?? 60;
    console.log(`[sim] ${error.message} Waiting ${seconds} s…`);
    await sleep(seconds * 1000);
    started = await call('POST', '/admin/simulator/run', { scenario, ...(paceMs ? { paceMs } : {}) });
  }
  console.log(`[sim] ${scenario} started as the demo account (pace ${started.paceMs} ms)`);
  const done = await waitForRun(started.id);
  console.log(`[sim] ${done.state}: ${done.step}/${done.total} operations${done.stoppedReason ? `; stopped: ${done.stoppedReason}` : ''}`);
  if (done.incident) console.log(`[sim] incident ${done.incident.incidentNumber}: ${done.incident.severity}, risk ${done.incident.riskScore}`);
  if (done.msFirstWriteToFreeze != null) console.log(`[sim] first write → freeze: ${done.msFirstWriteToFreeze} ms`);
}

async function main() {
  if (!['seed', 'run', 'reset'].includes(command)) {
    console.log('Usage: node src/scripts/simulator.js seed|run|reset [--scenario ransomware-like|normal-use] [--pace ms] [--wait] [--api url]');
    return;
  }
  if (!config.simulator.enabled) {
    throw new CliError(0, 'SIMULATOR_DISABLED', 'The simulator is disabled. Set SIMULATOR_ENABLED=true in server/.env and restart the API.');
  }
  await signIn();
  try {
    if (command === 'seed') {
      const result = await call('POST', '/admin/simulator/seed');
      console.log(`[sim] seeded the demo workspace: ${result.uploaded} uploaded, ${result.skipped} already there`);
    } else if (command === 'reset') {
      const result = await call('POST', '/admin/simulator/reset');
      console.log(`[sim] reset: ${result.unfrozen ? 'demo account unfrozen, ' : ''}${result.closedIncidents.length} incident(s) closed (${result.closedIncidents.join(', ') || 'none'}), `
        + `${result.purged.files} files / ${result.purged.versions} versions / ${result.purged.blobs} blobs removed, ${result.canaries} canaries and ${result.seeded.uploaded} demo files seeded`);
    } else {
      await run();
    }
  } finally {
    await signOut();
  }
}

main().catch((error) => {
  console.error(`[sim] ${error.code ? `${error.code}: ` : ''}${error.message}`);
  process.exitCode = 1;
});
