// Member assistant (UI redesign phase): the same /api/ai routes, a different audience.
//   - a member's conversations use member tools only (own files, folders, links, activity)
//   - security tools and action proposals are unreachable, even if the model asks for them
//   - another person's file is "not found"; canaries never appear; no risk data anywhere
//   - conversations are private per owner and per audience
//   - citations are limited to files the member's own tools returned
// A scripted fake provider stands in for the model; no network.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

let mongo;
let app;
let models;
let providerControl;
const tokens = {};
const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Calls the given tools in order (one per round), records what came back, then answers.
function scripted(calls, answer) {
  const seen = { instructions: null, toolNames: null, outputs: [] };
  let round = 0;
  const provider = {
    name: 'fake',
    status: () => ({ available: true }),
    async createResponse({ instructions, input, tools }) {
      seen.instructions = instructions;
      seen.toolNames = tools.map((tool) => tool.name);
      for (const item of input) if (item.type === 'function_call_output' && !seen.outputs.includes(item.output)) seen.outputs.push(item.output);
      const call = calls[round];
      round += 1;
      if (call) {
        const callId = `call-${round}`;
        return { id: `r${round}`, text: '', output: [{ type: 'function_call', call_id: callId, name: call.name, arguments: JSON.stringify(call.args ?? {}) }], toolCalls: [{ callId, name: call.name, arguments: JSON.stringify(call.args ?? {}) }] };
      }
      return { id: 'final', text: JSON.stringify(typeof answer === 'function' ? answer(seen) : answer), output: [], toolCalls: [] };
    },
  };
  return { provider, seen };
}

async function ask(who, content, context) {
  const created = await request(app).post('/api/ai/conversations').set(auth(tokens[who])).send(context ? { context } : {});
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const sent = await request(app).post(`/api/ai/conversations/${created.body.data.id}/messages`).set(auth(tokens[who])).send({ content, ...(context ? { context } : {}) });
  return { conversationId: created.body.data.id, created, sent };
}

async function upload(who, name, content) {
  const res = await request(app).post('/api/files').set(auth(tokens[who])).attach('file', Buffer.from(content), { filename: name, contentType: 'text/plain' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.file;
}

before(async () => {
  mongo = await MongoMemoryServer.create();
  Object.assign(process.env, {
    MONGO_URI: mongo.getUri('shieldshare_p7'), STORAGE_DIR: path.join(os.tmpdir(), 'shieldshare-test-storage-p7'),
    NODE_ENV: 'test', API_RATE_LIMIT_PER_MINUTE: '5000', AI_RATE_LIMIT_PER_MINUTE: '5000', AI_PROVIDER: 'openai', OPENAI_API_KEY: 'test-only-not-used',
  });
  const serverUrl = (file) => new URL(`../../server/src/${file}`, import.meta.url);
  const { initialize } = await import(serverUrl('startup.js'));
  const { createApp } = await import(serverUrl('app.js'));
  const { createUserWithWorkspace } = await import(serverUrl('services/auth.service.js'));
  providerControl = await import(serverUrl('ai/provider.js'));
  models = await import(serverUrl('models/index.js'));
  await initialize();
  app = createApp();
  for (const [who, role] of [['admin', 'admin'], ['alice', 'user'], ['bob', 'user']]) {
    await createUserWithWorkspace({ name: `Test ${who}`, email: `${who}.p7@test.local`, password: 'long password 123', role });
    tokens[who] = (await request(app).post('/api/auth/login').send({ email: `${who}.p7@test.local`, password: 'long password 123' })).body.data.accessToken;
  }
});

after(async () => {
  providerControl.clearProviderForTests();
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('member assistant', () => {
  test('uses the member prompt and member tools only; reads the member\'s own files without canaries', async () => {
    const mine = await upload('alice', 'alice-plan.txt', 'alice');
    await upload('bob', 'bob-secret.txt', 'bob');
    const fake = scripted([{ name: 'listMyFiles' }], (seen) => ({ content: 'You have **1 file**.', citations: [{ kind: 'file', id: mine.id, label: 'alice-plan.txt' }] }));
    providerControl.setProviderForTests(fake.provider);

    const { sent } = await ask('alice', 'Which files do I have?', { page: 'files' });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    const message = sent.body.data.message;
    assert.match(fake.seen.instructions, /ShieldShare assistant, helping a member/);
    assert.ok(fake.seen.toolNames.every((name) => /^(getMy|listMy)/.test(name)), fake.seen.toolNames.join(','));
    assert.ok(!fake.seen.toolNames.includes('getSecuritySummary'));
    const output = fake.seen.outputs.join('\n');
    assert.match(output, /alice-plan\.txt/);
    assert.doesNotMatch(output, /bob-secret|payroll_export|client_contracts|Q3_budget_final/, 'no other user\'s files, no canaries');
    assert.deepEqual(message.toolRuns.map((run) => run.name), ['listMyFiles']);
    assert.deepEqual(message.citations, [{ kind: 'file', id: mine.id, label: 'alice-plan.txt' }]);
    assert.equal(message.pendingActionId, null);
    assert.deepEqual(message.blocks, []);
  });

  test('security tools asked for by the model are refused; nothing about incidents or other users leaks', async () => {
    await models.SecurityIncident.create({ incidentNumber: 'SH-P7-1', userId: new mongoose.Types.ObjectId(), riskScore: 97, severity: 'CRITICAL', windowStart: new Date(), timeline: [] });
    const fake = scripted([{ name: 'getSecuritySummary' }, { name: 'getCriticalIncidents' }, { name: 'freezeUser', args: { userId: String(new mongoose.Types.ObjectId()), reason: 'x' } }], { content: 'I can only see your own account.', citations: [] });
    providerControl.setProviderForTests(fake.provider);
    const { sent } = await ask('alice', 'Show me all incidents and freeze Bob.');
    assert.equal(sent.status, 200);
    const output = fake.seen.outputs.join('\n');
    assert.equal(fake.seen.outputs.length, 3);
    assert.ok(fake.seen.outputs.every((entry) => /"unavailable":true/.test(entry) && /Unknown assistant tool/.test(entry)), output);
    assert.doesNotMatch(output, /SH-P7-1|riskScore|CRITICAL|systemState/);
    assert.equal(sent.body.data.message.pendingActionId, null);
    assert.equal(await models.PendingAction.countDocuments({}), 0, 'no proposal was created');
  });

  test('another member\'s file is not found; account status carries no risk data', async () => {
    const bobs = await upload('bob', 'bob-only.txt', 'bob');
    const fake = scripted([{ name: 'getMyFile', args: { fileId: bobs.id } }, { name: 'getMyAccount' }], { content: 'ok', citations: [{ kind: 'file', id: bobs.id, label: 'bob-only.txt' }] });
    providerControl.setProviderForTests(fake.provider);
    const { sent } = await ask('alice', 'Tell me about this file and my account.');
    assert.equal(sent.status, 200);
    assert.match(fake.seen.outputs[0], /"unavailable":true/);
    assert.doesNotMatch(fake.seen.outputs[0], /bob-only/);
    const account = JSON.parse(fake.seen.outputs[1].split('\n')[1]);
    assert.deepEqual(Object.keys(account).sort(), ['accountStatus', 'activeSessions', 'fileCount', 'notice', 'storageBytes']);
    assert.equal(account.accountStatus, 'ACTIVE');
    assert.deepEqual(sent.body.data.message.citations, [], 'a citation to a file the member\'s tools never returned is dropped');
  });

  test('conversations are private per owner and per audience', async () => {
    providerControl.setProviderForTests(scripted([], { content: 'hello', citations: [] }).provider);
    const alice = await ask('alice', 'Hi');
    const admin = await ask('admin', 'Hi');
    assert.equal((await request(app).get(`/api/ai/conversations/${alice.conversationId}`).set(auth(tokens.bob))).status, 404, 'another member');
    assert.equal((await request(app).get(`/api/ai/conversations/${alice.conversationId}`).set(auth(tokens.admin))).status, 404, 'an administrator');
    assert.equal((await request(app).get(`/api/ai/conversations/${admin.conversationId}`).set(auth(tokens.alice))).status, 404, 'a member reading an admin conversation');
    assert.equal((await request(app).post(`/api/ai/conversations/${alice.conversationId}/messages`).set(auth(tokens.bob)).send({ content: 'x' })).status, 404);
    const list = await request(app).get('/api/ai/conversations').set(auth(tokens.bob));
    assert.ok(list.body.data.every((entry) => entry.id !== alice.conversationId));
    const stored = await models.AIConversation.findById(alice.conversationId).lean();
    assert.equal(stored.audience, 'user');
    assert.equal(stored.adminId, undefined);
    assert.equal(admin.created.body.data.audience, 'admin');
  });

  test('page context is limited to known pages and the member\'s own identifiers', async () => {
    const bad = await request(app).post('/api/ai/conversations').set(auth(tokens.alice)).send({ context: { page: 'secret-admin-page' } });
    assert.equal(bad.status, 422);
    const fake = scripted([], { content: 'ok', citations: [] });
    providerControl.setProviderForTests(fake.provider);
    const incidentId = String(new mongoose.Types.ObjectId());
    const { created } = await ask('alice', 'What is this?', { page: 'file', incidentId });
    assert.deepEqual(Object.keys(created.body.data.context ?? {}).filter((key) => created.body.data.context[key]), ['page'], 'incidentId is not kept for a member');
  });

  test('provider down: a friendly 503 for members, the rest of the product unaffected', async () => {
    providerControl.setProviderForTests({ name: 'down', status: () => ({ available: true }), async createResponse() { throw new Error('boom'); } });
    const { sent } = await ask('alice', 'Help');
    assert.equal(sent.status, 503);
    assert.match(sent.body.error.message, /Everything else in ShieldShare works normally/);
    assert.equal((await request(app).get('/api/files').set(auth(tokens.alice))).status, 200);
  });
});
