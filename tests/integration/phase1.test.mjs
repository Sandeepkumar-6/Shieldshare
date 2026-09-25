// Phase 1 acceptance tests (auth, sessions, freeze middleware, folders, files, versions,
// integrity, activity). Runs its own API server on port 5055 against the shieldshare_test
// database and a temporary storage directory (see helpers.mjs).
//
//   cd server && npm test

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { createHarness, fileForm, oid, sha256 } from './helpers.mjs';

const { measureFileEntropy, sampleRanges, entropyOfBuffer } = await import(
  new URL('../../server/src/security/entropy.js', import.meta.url)
);

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const harness = createHarness({ port: 5055, dbName: 'shieldshare_test', storageName: 'shieldshare-test-storage', maxUploadBytes: MAX_UPLOAD_BYTES });
const { api, rawUpload, register, blobCount, BLOB_DIR } = harness;
let db;

before(async () => {
  await harness.start();
  db = harness.db;
});

after(() => harness.stop());

// ── entropy module (spec §13) ───────────────────────────────────────────────────────────

describe('entropy', () => {
  test('Shannon entropy in bits/byte: constant data is 0, uniform bytes are 8', () => {
    assert.equal(entropyOfBuffer(Buffer.alloc(4096, 0x41)), 0);
    const uniform = Buffer.alloc(256 * 16);
    for (let i = 0; i < uniform.length; i += 1) uniform[i] = i % 256;
    assert.equal(entropyOfBuffer(uniform), 8);
  });

  test('files over 1 MB are sampled: first, last and 4 evenly spaced 64 KB blocks', async () => {
    assert.deepEqual(sampleRanges(1024 * 1024), [{ offset: 0, length: 1024 * 1024 }]);
    const size = 10 * 1024 * 1024;
    const ranges = sampleRanges(size);
    assert.equal(ranges.length, 6);
    assert.equal(ranges[0].offset, 0);
    assert.equal(ranges[5].offset, size - 64 * 1024);
    assert.ok(ranges.every((range) => range.length === 64 * 1024));

    const tmp = path.join(os.tmpdir(), `shieldshare-entropy-${Date.now()}.bin`);
    fs.writeFileSync(tmp, crypto.randomBytes(2 * 1024 * 1024));
    const result = await measureFileEntropy(tmp);
    fs.rmSync(tmp);
    assert.equal(result.sampled, true);
    assert.equal(result.bytesAnalysed, 6 * 64 * 1024);
    assert.ok(result.entropy > 7.9, `random data should be ~8 bits/byte, got ${result.entropy}`);
  });
});

// ── auth and sessions ───────────────────────────────────────────────────────────────────

describe('auth', () => {
  test('register creates a user (role never taken from input) and a root folder', async () => {
    const alice = await register('alice');
    assert.equal(alice.user.role, 'user', 'role in the request body must be ignored');
    assert.equal(alice.user.status, 'ACTIVE');
    assert.deepEqual(Object.keys(alice.user).sort(), ['createdAt', 'email', 'id', 'name', 'role', 'status']);

    const folders = await api('GET', '/folders', { token: alice.token });
    assert.equal(folders.status, 200);
    assert.equal(folders.body.data.length, 1);
    assert.equal(folders.body.data[0].isRoot, true);
  });

  test('login creates an ACTIVE session and a LOGIN activity; wrong password is 401', async () => {
    const bob = await register('bob');
    const bad = await api('POST', '/auth/login', { json: { email: bob.email, password: 'wrong password!' } });
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error.code, 'UNAUTHENTICATED');

    const res = await api('POST', '/auth/login', { json: { email: bob.email, password: bob.password } });
    assert.equal(res.status, 200);
    const payload = JSON.parse(Buffer.from(res.body.data.accessToken.split('.')[1], 'base64url').toString());
    assert.deepEqual(Object.keys(payload).filter((k) => ['sub', 'sid', 'tv'].includes(k)).sort(), ['sid', 'sub', 'tv']);

    const session = await db.collection('sessions').findOne({ _id: oid(payload.sid) });
    assert.equal(session.status, 'ACTIVE');
    const login = await db.collection('activities').findOne({ action: 'LOGIN', sessionId: oid(payload.sid) });
    assert.ok(login, 'LOGIN activity recorded');
    assert.ok(login.ip, 'LOGIN activity has an IP');
  });

  test('logout revokes the session; the old token is rejected with 401', async () => {
    const carol = await register('carol');
    assert.equal((await api('GET', '/auth/me', { token: carol.token })).status, 200);

    const out = await api('POST', '/auth/logout', { token: carol.token });
    assert.equal(out.status, 204);

    const again = await api('GET', '/auth/me', { token: carol.token });
    assert.equal(again.status, 401);
    assert.equal(again.body.error.code, 'SESSION_REVOKED');

    const logoutEvent = await db.collection('activities').findOne({ action: 'LOGOUT', userId: oid(carol.user.id) });
    assert.ok(logoutEvent, 'LOGOUT activity recorded');
  });

  test('a user can list sessions and revoke another one of their sessions', async () => {
    const dave = await register('dave');
    const second = await api('POST', '/auth/login', { json: { email: dave.email, password: dave.password } });
    const list = await api('GET', '/auth/sessions', { token: dave.token });
    assert.equal(list.status, 200);
    assert.equal(list.body.data.length, 2);
    const other = list.body.data.find((session) => !session.current);

    assert.equal((await api('DELETE', `/auth/sessions/${other.id}`, { token: dave.token })).status, 204);
    assert.equal((await api('GET', '/auth/me', { token: second.body.data.accessToken })).status, 401);
    assert.equal((await api('GET', '/auth/me', { token: dave.token })).status, 200);
  });

  test('non-admin gets 403 on admin routes; unauthenticated gets 401', async () => {
    const erin = await register('erin');
    const res = await api('GET', '/admin/summary', { token: erin.token });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.equal((await api('GET', '/admin/summary')).status, 401);

    const admin = await api('POST', '/auth/login', {
      json: { email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD },
    });
    assert.equal(admin.status, 200, 'seeded admin can log in');
    assert.equal(admin.body.data.user.role, 'admin');
    // Role check passes (the summary endpoint exists since Phase 3).
    assert.equal((await api('GET', '/admin/summary', { token: admin.body.data.accessToken })).status, 200);
  });
});

// ── files ───────────────────────────────────────────────────────────────────────────────

describe('files', () => {
  const v1Content = 'Quarterly notes\nRevenue up, costs flat.\n'.repeat(20);
  const v2Content = 'Quarterly notes (edited)\nRevenue up 4%, costs down 2%.\n'.repeat(20);
  let owner;
  let file;
  let rootFolderId;
  let financeFolderId;
  let versions;

  before(async () => {
    owner = await register('owner');
    rootFolderId = (await api('GET', '/folders', { token: owner.token })).body.data[0].id;
  });

  test('upload creates File + Version 1 + UPLOAD activity with SHA-256 and entropy', async () => {
    const res = await api('POST', '/files', { token: owner.token, form: fileForm('notes.txt', v1Content) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    file = res.body.data.file;
    const expectedHash = sha256(v1Content);
    const expectedEntropy = Math.round(entropyOfBuffer(Buffer.from(v1Content)) * 10000) / 10000;

    assert.equal(file.sha256, expectedHash);
    assert.equal(file.entropy, expectedEntropy);
    assert.equal(file.currentVersion, 1);
    assert.equal(file.folderId, rootFolderId);
    assert.equal(file.mimeType, 'text/plain');
    assert.equal(res.body.data.version.versionNumber, 1);
    assert.equal(res.body.data.version.source, 'UPLOAD');

    const version = await db.collection('versions').findOne({ fileId: oid(file.id), versionNumber: 1 });
    assert.equal(version.sha256, expectedHash);
    assert.equal(version.securityStatus, 'SAFE');
    assert.equal(version.nameAtVersion, 'notes.txt');

    const upload = await db.collection('activities').findOne({ action: 'UPLOAD', fileId: oid(file.id) });
    assert.equal(upload.hashAfter, expectedHash);
    assert.equal(upload.entropyAfter, expectedEntropy);
    assert.equal(upload.sizeAfter, Buffer.byteLength(v1Content));
    assert.equal(upload.nameAfter, 'notes.txt');
    assert.equal(String(upload.directory), rootFolderId);
    assert.ok(upload.sessionId, 'UPLOAD activity has the session');
    assert.ok(upload.ip, 'UPLOAD activity has the IP');
  });

  test('modify content creates Version 2 with a different hash + MODIFY + INTEGRITY_CHANGE', async () => {
    const res = await api('PUT', `/files/${file.id}/content`, { token: owner.token, form: fileForm('ignored.txt', v2Content) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.file.currentVersion, 2);
    assert.equal(res.body.data.version.source, 'MODIFY');
    assert.equal(res.body.data.file.sha256, sha256(v2Content));
    assert.notEqual(res.body.data.file.sha256, file.sha256);
    assert.equal(res.body.data.file.name, 'notes.txt', 'modify keeps the name');

    const modify = await db.collection('activities').findOne({ action: 'MODIFY', fileId: oid(file.id) });
    assert.equal(modify.hashBefore, sha256(v1Content));
    assert.equal(modify.hashAfter, sha256(v2Content));
    assert.equal(typeof modify.entropyBefore, 'number');
    assert.equal(typeof modify.entropyAfter, 'number');
    assert.equal(modify.sizeBefore, Buffer.byteLength(v1Content));
    assert.equal(modify.sizeAfter, Buffer.byteLength(v2Content));

    const integrity = await db.collection('activities').findOne({ action: 'INTEGRITY_CHANGE', fileId: oid(file.id) });
    assert.ok(integrity, 'INTEGRITY_CHANGE recorded');
    assert.equal(integrity.hashBefore, sha256(v1Content));
    assert.equal(integrity.hashAfter, sha256(v2Content));

    // Both version blobs exist; the first was not overwritten.
    const stored = await db.collection('versions').find({ fileId: oid(file.id) }).toArray();
    assert.equal(stored.length, 2);
    assert.notEqual(stored[0].storageKey, stored[1].storageKey);
  });

  test('rename and move create activity with before/after values', async () => {
    const renamed = await api('PATCH', `/files/${file.id}`, { token: owner.token, json: { name: 'notes.txt.locked' } });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.data.name, 'notes.txt.locked');
    const rename = await db.collection('activities').findOne({ action: 'RENAME', fileId: oid(file.id) });
    assert.equal(rename.nameBefore, 'notes.txt');
    assert.equal(rename.nameAfter, 'notes.txt.locked');

    const folder = await api('POST', '/folders', { token: owner.token, json: { name: 'Finance' } });
    assert.equal(folder.status, 201);
    financeFolderId = folder.body.data.id;

    const moved = await api('PATCH', `/files/${file.id}`, { token: owner.token, json: { folderId: financeFolderId } });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.data.folderId, financeFolderId);
    const move = await db.collection('activities').findOne({ action: 'MOVE', fileId: oid(file.id) });
    assert.equal(String(move.directory), financeFolderId);
    assert.equal(String(move.metadata.fromFolderId), rootFolderId);
    assert.equal(String(move.metadata.toFolderId), financeFolderId);

    const notEmpty = await api('DELETE', `/folders/${financeFolderId}`, { token: owner.token });
    assert.equal(notEmpty.status, 409);
    assert.equal(notEmpty.body.error.code, 'FOLDER_NOT_EMPTY');
  });

  test('verify passes for an untouched version and records lastVerifiedAt', async () => {
    const current = await api('POST', `/files/${file.id}/verify`, { token: owner.token, json: {} });
    assert.equal(current.status, 200);
    assert.equal(current.body.data.passed, true);
    assert.equal(current.body.data.expected, current.body.data.actual);
    assert.equal(current.body.data.versionNumber, 2);

    versions = (await api('GET', `/files/${file.id}/versions`, { token: owner.token })).body.data;
    const v1 = versions.find((v) => v.versionNumber === 1);
    const old = await api('POST', `/files/${file.id}/verify`, { token: owner.token, json: { versionId: v1.id } });
    assert.equal(old.body.data.passed, true);
    assert.equal(old.body.data.actual, sha256(v1Content));

    const detail = await api('GET', `/files/${file.id}`, { token: owner.token });
    assert.ok(detail.body.data.lastVerifiedAt, 'lastVerifiedAt set after a passing verification');
  });

  test('restore creates a new RESTORED version and a RESTORE activity, bringing the name back', async () => {
    const v1 = versions.find((v) => v.versionNumber === 1);
    const res = await api('POST', `/files/${file.id}/versions/${v1.id}/restore`, { token: owner.token });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { file: restored, newVersion, verification } = res.body.data;
    assert.equal(newVersion.versionNumber, 3);
    assert.equal(newVersion.source, 'RESTORE');
    assert.equal(newVersion.securityStatus, 'RESTORED');
    assert.equal(newVersion.restoredFromVersion, 1);
    assert.equal(verification.passed, true);
    assert.equal(restored.name, 'notes.txt');
    assert.equal(restored.sha256, sha256(v1Content));
    assert.equal(restored.currentVersion, 3);

    const event = await db.collection('activities').findOne({ action: 'RESTORE', fileId: oid(file.id) });
    assert.equal(event.nameBefore, 'notes.txt.locked');
    assert.equal(event.nameAfter, 'notes.txt');
    assert.equal(event.metadata.restoredFromVersion, 1);

    const current = await api('GET', `/files/${file.id}/download`, { token: owner.token });
    assert.equal(current.status, 200);
    assert.equal(sha256(current.buffer), sha256(v1Content));
    const v2 = versions.find((v) => v.versionNumber === 2);
    const older = await api('GET', `/files/${file.id}/download?versionId=${v2.id}`, { token: owner.token });
    assert.equal(sha256(older.buffer), sha256(v2Content));
    assert.match(older.headers.get('content-disposition'), /attachment/);
  });

  test('a tampered blob fails verification and cannot be restored', async () => {
    const res = await api('POST', '/files', { token: owner.token, form: fileForm('tamper.csv', 'a,b\n1,2\n', 'text/csv') });
    const tampered = res.body.data.file;
    await api('PUT', `/files/${tampered.id}/content`, { token: owner.token, form: fileForm('x.csv', 'a,b\n3,4\n', 'text/csv') });
    const v1 = await db.collection('versions').findOne({ fileId: oid(tampered.id), versionNumber: 1 });
    fs.writeFileSync(path.join(BLOB_DIR, v1.storageKey), 'a,b\n9,9\n');

    const verify = await api('POST', `/files/${tampered.id}/verify`, { token: owner.token, json: { versionId: String(v1._id) } });
    assert.equal(verify.body.data.passed, false);
    assert.notEqual(verify.body.data.actual, verify.body.data.expected);

    const restore = await api('POST', `/files/${tampered.id}/versions/${v1._id}/restore`, { token: owner.token });
    assert.equal(restore.status, 409);
    assert.equal(restore.body.error.code, 'INTEGRITY_CHECK_FAILED');
    const still = await api('GET', `/files/${tampered.id}`, { token: owner.token });
    assert.equal(still.body.data.currentVersion, 2, 'failed restore leaves the file unchanged');
  });

  test('a user cannot access another user\'s file (404 everywhere)', async () => {
    const mallory = await register('mallory');
    const token = mallory.token;
    const v1 = versions.find((v) => v.versionNumber === 1);
    const checks = [
      await api('GET', `/files/${file.id}`, { token }),
      await api('GET', `/files/${file.id}/download`, { token }),
      await api('GET', `/files/${file.id}/versions`, { token }),
      await api('GET', `/files/${file.id}/activity`, { token }),
      await api('POST', `/files/${file.id}/verify`, { token, json: {} }),
      await api('PATCH', `/files/${file.id}`, { token, json: { name: 'pwned.txt' } }),
      await api('PUT', `/files/${file.id}/content`, { token, form: fileForm('x.txt', 'x') }),
      await api('POST', `/files/${file.id}/versions/${v1.id}/restore`, { token }),
      await api('DELETE', `/files/${file.id}`, { token }),
      await api('DELETE', `/folders/${financeFolderId}`, { token }),
    ];
    for (const res of checks) {
      assert.equal(res.status, 404, JSON.stringify(res.body));
    }
    // ?all=true returns only mallory's own files (her canaries), never the owner's.
    const list = await api('GET', '/files?all=true', { token });
    const ownerFiles = await db.collection('files').find({ ownerId: oid(owner.user.id) }).toArray();
    const ownerIds = new Set(ownerFiles.map((f) => String(f._id)));
    assert.ok(list.body.data.every((f) => !ownerIds.has(f.id)));
  });

  test('delete is soft: hidden from the list, 404 on read, record DELETED, blobs kept', async () => {
    const res = await api('DELETE', `/files/${file.id}`, { token: owner.token });
    assert.equal(res.status, 204);

    const list = await api('GET', '/files', { token: owner.token });
    assert.ok(!list.body.data.some((f) => f.id === file.id), 'hidden from the list');
    assert.equal((await api('GET', `/files/${file.id}`, { token: owner.token })).status, 404);

    const record = await db.collection('files').findOne({ _id: oid(file.id) });
    assert.equal(record.status, 'DELETED');
    assert.ok(record.deletedAt);
    const stored = await db.collection('versions').find({ fileId: oid(file.id) }).toArray();
    assert.equal(stored.length, 3);
    for (const version of stored) {
      assert.ok(fs.existsSync(path.join(BLOB_DIR, version.storageKey)), `blob of v${version.versionNumber} still exists`);
    }
    const event = await db.collection('activities').findOne({ action: 'DELETE', fileId: oid(file.id) });
    assert.equal(event.nameBefore, 'notes.txt');

    const folderDelete = await api('DELETE', `/folders/${financeFolderId}`, { token: owner.token });
    assert.equal(folderDelete.status, 409, 'a folder holding soft-deleted files is kept');
  });

  test('path traversal names, blocked types and oversized files are rejected without leaving blobs', async () => {
    const before = blobCount();
    const traversal = await api('POST', '/files', { token: owner.token, form: fileForm('../../evil.txt', 'x') });
    assert.equal(traversal.status, 422, JSON.stringify(traversal.body));
    assert.match(traversal.body.error.message, /path separators/);
    const backslash = await rawUpload(owner.token, '..\\..\\evil.txt', 'x');
    assert.equal(backslash.status, 422, JSON.stringify(backslash.body));
    assert.match(backslash.body.error.message, /path separators/);
    const dotdot = await rawUpload(owner.token, '..', 'x');
    assert.equal(dotdot.status, 422, JSON.stringify(dotdot.body));

    const exe = await api('POST', '/files', { token: owner.token, form: fileForm('setup.exe', 'MZ', 'application/x-msdownload') });
    assert.equal(exe.status, 415);
    assert.equal(exe.body.error.code, 'UNSUPPORTED_TYPE');
    const mismatch = await api('POST', '/files', { token: owner.token, form: fileForm('report.pdf', '<html>', 'text/html') });
    assert.equal(mismatch.status, 415);

    const big = await api('POST', '/files', { token: owner.token, form: fileForm('big.txt', Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x61)) });
    assert.equal(big.status, 413);
    assert.equal(big.body.error.code, 'FILE_TOO_LARGE');

    const renameTraversal = await api('POST', '/files', { token: owner.token, form: fileForm('ok.txt', 'fine') });
    const badRename = await api('PATCH', `/files/${renameTraversal.body.data.file.id}`, { token: owner.token, json: { name: '../etc/passwd' } });
    assert.equal(badRename.status, 422);

    assert.equal(blobCount(), before + 1, 'only the one accepted upload left a blob');
  });

  test('non-ASCII file names are stored exactly', async () => {
    const res = await api('POST', '/files', { token: owner.token, form: fileForm('Ünïcødé 報告 2026.txt', 'ok') });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.file.name, 'Ünïcødé 報告 2026.txt');
    const download = await api('GET', `/files/${res.body.data.file.id}/download`, { token: owner.token });
    assert.match(download.headers.get('content-disposition'), /filename\*=UTF-8''%C3%9Cn/);
  });

  test('a user FROZEN in Mongo gets 423 on writes with an already-issued token, reads still work', async () => {
    const res = await api('POST', '/files', { token: owner.token, form: fileForm('before-freeze.md', '# hi\n', 'text/markdown') });
    const target = res.body.data.file;
    const { data: targetVersions } = (await api('GET', `/files/${target.id}/versions`, { token: owner.token })).body;

    await db.collection('users').updateOne({ _id: oid(owner.user.id) }, { $set: { status: 'FROZEN' } });

    const writes = [
      await api('POST', '/files', { token: owner.token, form: fileForm('after.txt', 'x') }),
      await api('PUT', `/files/${target.id}/content`, { token: owner.token, form: fileForm('x.md', 'y') }),
      await api('PATCH', `/files/${target.id}`, { token: owner.token, json: { name: 'renamed.md' } }),
      await api('DELETE', `/files/${target.id}`, { token: owner.token }),
      await api('POST', `/files/${target.id}/versions/${targetVersions[0].id}/restore`, { token: owner.token }),
      await api('POST', '/folders', { token: owner.token, json: { name: 'Blocked' } }),
    ];
    for (const write of writes) {
      assert.equal(write.status, 423, JSON.stringify(write.body));
      assert.equal(write.body.error.code, 'USER_FROZEN');
    }

    assert.equal((await api('GET', '/files', { token: owner.token })).status, 200);
    assert.equal((await api('GET', `/files/${target.id}/download`, { token: owner.token })).status, 200);
    const me = await api('GET', '/auth/me', { token: owner.token });
    assert.equal(me.body.data.user.status, 'FROZEN', 'the client learns the status (drives the banner)');
    const security = await api('GET', '/me/security', { token: owner.token });
    assert.equal(security.body.data.status, 'FROZEN');
    assert.match(security.body.data.notice, /File changes are paused/);

    await db.collection('users').updateOne({ _id: oid(owner.user.id) }, { $set: { status: 'ACTIVE' } });
  });

  test('dashboard and own activity return real data and hide internal security events', async () => {
    const dashboard = await api('GET', '/me/dashboard', { token: owner.token });
    assert.equal(dashboard.status, 200);
    const live = await db.collection('files').find({ ownerId: oid(owner.user.id), status: { $ne: 'DELETED' }, isCanary: { $ne: true } }).toArray();
    assert.equal(dashboard.body.data.fileCount, live.length);
    assert.equal(dashboard.body.data.storageBytes, live.reduce((sum, f) => sum + f.size, 0));

    const activity = await api('GET', '/me/activity?limit=100', { token: owner.token });
    const actions = new Set(activity.body.data.map((a) => a.action));
    assert.ok(actions.has('UPLOAD') && actions.has('MODIFY') && actions.has('RESTORE'));
    assert.ok(!actions.has('INTEGRITY_CHANGE'), 'integrity signals are not listed to the user');
  });
});

// ── response hygiene ────────────────────────────────────────────────────────────────────

describe('no internal data in responses', () => {
  test('no storage path, passwordHash, tokenHash, tokenVersion or storageKey in any API response', async () => {
    // Every real storage key and password hash in the database must be absent from responses.
    const { secrets } = await harness.assertNoLeaks({ minimum: 50 });
    assert.ok(secrets > 5);
  });
});
