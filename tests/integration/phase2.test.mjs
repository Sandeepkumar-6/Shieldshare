// Phase 2 acceptance tests: secure sharing, public link access, quarantine, admin
// containment (freeze/unfreeze), forensic download and the admin audit log.
// Runs its own API server on port 5056 against the shieldshare_test_p2 database.
//
//   cd server && npm test

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createHarness, fileForm, oid, sha256 } from './helpers.mjs';

const harness = createHarness({ port: 5056, dbName: 'shieldshare_test_p2', storageName: 'shieldshare-test-storage-p2' });
const { api, register } = harness;
let db;

const HOUR = 60 * 60 * 1000;
const inHours = (hours) => new Date(Date.now() + hours * HOUR).toISOString();
const GENERIC_410 = { error: { code: 'LINK_UNAVAILABLE', message: 'This link is no longer available.', details: null } };

// Raw tokens handed out by create responses; they must never appear anywhere else.
const issuedTokens = [];
// Admin actions performed through the API, to reconcile with the audit log at the end.
const adminCalls = [];

let owner;
let admin;

async function upload(token, name, content, type = 'text/plain') {
  const res = await api('POST', '/files', { token, form: fileForm(name, content, type) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data.file;
}

async function share(token, fileId, body) {
  const res = await api('POST', `/files/${fileId}/shares`, { token, json: body });
  if (res.status === 201) issuedTokens.push({ token: res.body.data.token, createRoute: `POST /files/${fileId}/shares` });
  return res;
}

async function adminCall(method, route, options = {}, expected = {}) {
  const res = await api(method, route, { token: admin.token, ...options });
  adminCalls.push({ route, status: res.status, ...expected });
  return res;
}

const linkDoc = (token) => db.collection('sharelinks').findOne({ tokenHash: sha256(token) });

before(async () => {
  await harness.start();
  db = harness.db;
  owner = await register('owner');
  admin = await harness.loginAdmin();
});

after(() => harness.stop());

// ── Sharing ─────────────────────────────────────────────────────────────────────────────

describe('sharing', () => {
  let file;
  let downloadLink;
  let viewLink;
  const v1 = 'Board pack, draft one\n'.repeat(30);
  const v2 = 'Board pack, final version\n'.repeat(30);

  before(async () => {
    file = await upload(owner.token, 'board-pack.txt', v1);
  });

  test('share link created; DB stores only tokenHash; raw token not retrievable later', async () => {
    const res = await share(owner.token, file.id, {
      permission: 'DOWNLOAD', expiresAt: inHours(48), recipientLabel: 'bob@example.com',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { share: created, token, url } = res.body.data;
    assert.match(token, /^[A-Za-z0-9_-]{43}$/, '32 random bytes, base64url');
    assert.ok(url.endsWith(`/s/${token}`));
    assert.equal(created.status, 'ACTIVE');
    assert.equal(created.recipientLabel, 'bob@example.com');
    assert.equal(created.passwordProtected, false);
    downloadLink = { ...created, token };

    const doc = await linkDoc(token);
    assert.ok(doc, 'stored under the SHA-256 of the token');
    assert.equal(doc.tokenHash, sha256(token));
    assert.ok(!JSON.stringify(doc).includes(token), 'raw token not stored anywhere in the document');

    const list = await api('GET', '/shares', { token: owner.token });
    assert.equal(list.status, 200);
    const listed = list.body.data.find((link) => link.id === created.id);
    assert.ok(listed);
    assert.equal(listed.token, undefined);
    assert.equal(listed.url, undefined);
    assert.ok(!JSON.stringify(list.body).includes(token), 'list never returns the raw token');

    const detail = await api('GET', `/files/${file.id}`, { token: owner.token });
    assert.equal(detail.body.data.shareCount, 1);
  });

  test('expiry is required, must be in the future and within the configured maximum', async () => {
    const missing = await share(owner.token, file.id, { permission: 'VIEW' });
    assert.equal(missing.status, 422);
    const past = await share(owner.token, file.id, { permission: 'VIEW', expiresAt: new Date(Date.now() - 1000).toISOString() });
    assert.equal(past.status, 422);
    assert.match(past.body.error.message, /future/);
    const tooLong = await share(owner.token, file.id, { permission: 'VIEW', expiresAt: inHours(24 * 31) });
    assert.equal(tooLong.status, 422);
    assert.match(tooLong.body.error.message, /30 days/);
  });

  test('VIEW link cannot download; DOWNLOAD link can, and serves the current version', async () => {
    const res = await share(owner.token, file.id, { permission: 'VIEW', expiresAt: inHours(2) });
    viewLink = { ...res.body.data.share, token: res.body.data.token };

    const meta = await api('GET', `/s/${viewLink.token}`);
    assert.equal(meta.status, 200);
    assert.deepEqual(Object.keys(meta.body.data).sort(), ['expiresAt', 'fileName', 'permission', 'requiresPassword', 'size']);
    assert.equal(meta.body.data.permission, 'VIEW');
    const viewDownload = await api('GET', `/s/${viewLink.token}/download`);
    assert.equal(viewDownload.status, 403);
    assert.equal(viewDownload.body.error.code, 'SHARE_DOWNLOAD_NOT_ALLOWED');

    const first = await api('GET', `/s/${downloadLink.token}/download`);
    assert.equal(first.status, 200);
    assert.equal(sha256(first.buffer), sha256(v1));
    assert.match(first.headers.get('content-disposition'), /attachment; filename="board-pack.txt"/);
    assert.equal(first.headers.get('cache-control'), 'no-store');

    await api('PUT', `/files/${file.id}/content`, { token: owner.token, form: fileForm('x.txt', v2) });
    const second = await api('GET', `/s/${downloadLink.token}/download`);
    assert.equal(sha256(second.buffer), sha256(v2), 'links always serve the current version');
  });

  test('expired link → 410; revoked link → 410; unknown token → 410; identical responses', async () => {
    const expiring = await share(owner.token, file.id, { permission: 'DOWNLOAD', expiresAt: inHours(1) });
    const expiredToken = expiring.body.data.token;
    await db.collection('sharelinks').updateOne({ tokenHash: sha256(expiredToken) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const revoking = await share(owner.token, file.id, { permission: 'DOWNLOAD', expiresAt: inHours(1) });
    const revokedToken = revoking.body.data.token;
    assert.equal((await api('DELETE', `/shares/${revoking.body.data.share.id}`, { token: owner.token })).status, 204);
    const again = await api('DELETE', `/shares/${revoking.body.data.share.id}`, { token: owner.token });
    assert.equal(again.status, 409);

    const responses = [
      await api('GET', `/s/${expiredToken}`),
      await api('GET', `/s/${expiredToken}/download`),
      await api('GET', `/s/${revokedToken}`),
      await api('GET', `/s/${revokedToken}/download`),
      await api('GET', `/s/${'A'.repeat(43)}`),
      await api('GET', '/s/not-even-a-token'),
    ];
    for (const res of responses) {
      assert.equal(res.status, 410);
      assert.deepEqual(res.body, GENERIC_410, 'no hint about why the link is unusable');
    }

    // The owner sees the real reason.
    const expired = await api('GET', '/shares?status=EXPIRED', { token: owner.token });
    assert.ok(expired.body.data.some((link) => link.id === expiring.body.data.share.id && link.status === 'EXPIRED'),
      'computed EXPIRED although the stored status is ACTIVE');
    const revoked = await api('GET', '/shares?status=REVOKED', { token: owner.token });
    assert.ok(revoked.body.data.some((link) => link.id === revoking.body.data.share.id));
    const active = await api('GET', '/shares?status=ACTIVE', { token: owner.token });
    assert.ok(!active.body.data.some((link) => link.id === expiring.body.data.share.id));
  });

  test('password link: wrong password rejected and rate-limited; correct password → download works', async () => {
    const locked = await share(owner.token, file.id, { permission: 'DOWNLOAD', expiresAt: inHours(2), password: 'open sesame 42' });
    const lockedToken = locked.body.data.token;
    assert.equal(locked.body.data.share.passwordProtected, true);
    const stored = await db.collection('sharelinks').findOne({ tokenHash: sha256(lockedToken) });
    assert.match(stored.passwordHash, /^\$2[aby]\$12\$/, 'bcrypt hash, never the password');

    const meta = await api('GET', `/s/${lockedToken}`);
    assert.equal(meta.body.data.requiresPassword, true);
    const noUnlock = await api('GET', `/s/${lockedToken}/download`);
    assert.equal(noUnlock.status, 401);
    assert.equal(noUnlock.body.error.code, 'SHARE_PASSWORD_REQUIRED');

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const wrong = await api('POST', `/s/${lockedToken}/unlock`, { json: { password: `guess ${attempt}` } });
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.error.code, 'SHARE_PASSWORD_INVALID');
    }
    const limited = await api('POST', `/s/${lockedToken}/unlock`, { json: { password: 'open sesame 42' } });
    assert.equal(limited.status, 429, 'sixth attempt on this link from this IP is rate limited, even with the right password');
    assert.equal(limited.body.error.code, 'RATE_LIMITED');

    // A different protected link is not affected by the first link's lockout.
    const other = await share(owner.token, file.id, { permission: 'DOWNLOAD', expiresAt: inHours(2), password: 'second secret 7' });
    const otherToken = other.body.data.token;
    const unlocked = await api('POST', `/s/${otherToken}/unlock`, { json: { password: 'second secret 7' } });
    assert.equal(unlocked.status, 200, JSON.stringify(unlocked.body));
    const { accessToken } = unlocked.body.data;
    assert.ok(accessToken);
    assert.ok(!/[a-f0-9]{24}/.test(accessToken), 'the unlock token carries no internal id');

    const ok = await api('GET', `/s/${otherToken}/download`, { headers: { 'X-Share-Access': accessToken } });
    assert.equal(ok.status, 200);
    assert.equal(sha256(ok.buffer), sha256(v2));

    const tampered = await api('GET', `/s/${otherToken}/download`, { headers: { 'X-Share-Access': `${accessToken.slice(0, -2)}xx` } });
    assert.equal(tampered.status, 401);
    // The unlock token is bound to its link.
    const third = await share(owner.token, file.id, { permission: 'DOWNLOAD', expiresAt: inHours(2), password: 'third secret 99' });
    const crossLink = await api('GET', `/s/${third.body.data.token}/download`, { headers: { 'X-Share-Access': accessToken } });
    assert.equal(crossLink.status, 401);
  });

  test('SHARE, SHARE_REVOKE and SHARE_ACCESS activities are recorded; access counts update', async () => {
    const shareEvent = await db.collection('activities').findOne({ action: 'SHARE', fileId: oid(file.id), 'metadata.shareLinkId': oid(downloadLink.id) });
    assert.ok(shareEvent);
    assert.equal(String(shareEvent.userId), owner.user.id);
    assert.equal(shareEvent.metadata.permission, 'DOWNLOAD');

    assert.ok(await db.collection('activities').findOne({ action: 'SHARE_REVOKE', fileId: oid(file.id) }));

    const access = await db.collection('activities').find({ action: 'SHARE_ACCESS', 'metadata.shareLinkId': oid(downloadLink.id) }).toArray();
    assert.equal(access.length, 2, 'two downloads through the link');
    for (const event of access) {
      assert.equal(event.userId, null, 'anonymous recipient');
      assert.equal(event.sessionId, null);
      assert.equal(event.metadata.accessType, 'DOWNLOAD');
      assert.ok(event.ip);
    }
    const viewAccess = await db.collection('activities').findOne({ action: 'SHARE_ACCESS', 'metadata.shareLinkId': oid(viewLink.id) });
    assert.equal(viewAccess.metadata.accessType, 'VIEW', 'viewing the link page is an access too (spec §9)');

    const doc = await linkDoc(downloadLink.token);
    assert.equal(doc.accessCount, 2);
    assert.ok(doc.lastAccessedAt);

    const fileActivity = await api('GET', `/files/${file.id}/activity?limit=100`, { token: owner.token });
    const actions = new Set(fileActivity.body.data.map((event) => event.action));
    assert.ok(actions.has('SHARE') && actions.has('SHARE_REVOKE') && actions.has('SHARE_ACCESS'));
  });

  test('a frozen user cannot create or revoke shares (423)', async () => {
    const res = await share(owner.token, file.id, { permission: 'VIEW', expiresAt: inHours(1) });
    await db.collection('users').updateOne({ _id: oid(owner.user.id) }, { $set: { status: 'FROZEN' } });
    const create = await share(owner.token, file.id, { permission: 'VIEW', expiresAt: inHours(1) });
    assert.equal(create.status, 423);
    assert.equal(create.body.error.code, 'USER_FROZEN');
    const revoke = await api('DELETE', `/shares/${res.body.data.share.id}`, { token: owner.token });
    assert.equal(revoke.status, 423);
    assert.equal((await api('GET', '/shares', { token: owner.token })).status, 200, 'reading links still works');
    await db.collection('users').updateOne({ _id: oid(owner.user.id) }, { $set: { status: 'ACTIVE' } });
  });

  test('another user cannot see, create or revoke links on someone else\'s file', async () => {
    const mallory = await register('mallory');
    assert.equal((await share(mallory.token, file.id, { permission: 'VIEW', expiresAt: inHours(1) })).status, 404);
    assert.equal((await api('DELETE', `/shares/${downloadLink.id}`, { token: mallory.token })).status, 404);
    assert.equal((await api('GET', `/shares?fileId=${file.id}`, { token: mallory.token })).status, 404);
    assert.equal((await api('GET', '/shares', { token: mallory.token })).body.data.length, 0);
  });
});

// ── Quarantine ──────────────────────────────────────────────────────────────────────────

describe('quarantine', () => {
  let file;
  let other;
  let item;
  const links = {};
  const q1 = 'Quarterly numbers v1\n'.repeat(20);
  const q2 = 'Quarterly numbers v2\n'.repeat(20);

  before(async () => {
    file = await upload(owner.token, 'numbers.csv', q1, 'text/csv');
    await api('PUT', `/files/${file.id}/content`, { token: owner.token, form: fileForm('x.csv', q2, 'text/csv') });
    for (const name of ['active', 'expiresDuringQuarantine', 'revoked']) {
      const res = await share(owner.token, file.id, { permission: 'DOWNLOAD', expiresAt: inHours(3) });
      links[name] = { id: res.body.data.share.id, token: res.body.data.token };
    }
    await api('DELETE', `/shares/${links.revoked.id}`, { token: owner.token });

    other = await upload(owner.token, 'other.txt', 'unrelated file');
    const otherLink = await share(owner.token, other.id, { permission: 'DOWNLOAD', expiresAt: inHours(3) });
    links.otherFile = { id: otherLink.body.data.share.id, token: otherLink.body.data.token };
  });

  test('admin quarantines a file: owner gets 409 everywhere; its active links become SUSPENDED → public 410', async () => {
    const res = await adminCall('POST', `/admin/files/${file.id}/quarantine`, { json: { reason: 'Manual review of unexpected edits' } }, { action: 'QUARANTINE_FILE', result: 'SUCCESS' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    item = res.body.data.quarantine;
    assert.equal(res.body.data.suspendedLinks, 2);
    assert.deepEqual(item.versions.map((version) => version.versionNumber), [2], 'manual quarantine covers the current version');

    const versions = (await api('GET', `/files/${file.id}/versions`, { token: owner.token })).body.data;
    const v1 = versions.find((version) => version.versionNumber === 1);
    const blocked = {
      download: await api('GET', `/files/${file.id}/download`, { token: owner.token }),
      modify: await api('PUT', `/files/${file.id}/content`, { token: owner.token, form: fileForm('x.csv', 'x', 'text/csv') }),
      rename: await api('PATCH', `/files/${file.id}`, { token: owner.token, json: { name: 'renamed.csv' } }),
      delete: await api('DELETE', `/files/${file.id}`, { token: owner.token }),
      share: await share(owner.token, file.id, { permission: 'VIEW', expiresAt: inHours(1) }),
      restore: await api('POST', `/files/${file.id}/versions/${v1.id}/restore`, { token: owner.token }),
      versionDownload: await api('GET', `/files/${file.id}/download?versionId=${versions[0].id}`, { token: owner.token }),
    };
    for (const [operation, response] of Object.entries(blocked)) {
      assert.equal(response.status, 409, `${operation}: ${JSON.stringify(response.body)}`);
      assert.equal(response.body.error.code, 'FILE_QUARANTINED', operation);
    }
    const folder = await api('POST', '/folders', { token: owner.token, json: { name: 'Elsewhere' } });
    const move = await api('PATCH', `/files/${file.id}`, { token: owner.token, json: { folderId: folder.body.data.id } });
    assert.equal(move.status, 409);

    const view = await api('GET', `/files/${file.id}`, { token: owner.token });
    assert.equal(view.body.data.status, 'QUARANTINED', 'the owner can still see the file');
    assert.equal(view.body.data.shareCount, 0);

    const active = await linkDoc(links.active.token);
    assert.equal(active.status, 'SUSPENDED');
    assert.equal(String(active.suspendedByQuarantineId), item.id);
    assert.equal((await linkDoc(links.revoked.token)).status, 'REVOKED', 'revoked links are left alone');
    assert.deepEqual((await api('GET', `/s/${links.active.token}`)).body, GENERIC_410);
    assert.deepEqual((await api('GET', `/s/${links.active.token}/download`)).body, GENERIC_410);

    const ownerList = await api('GET', `/shares?fileId=${file.id}`, { token: owner.token });
    assert.equal(ownerList.body.data.find((link) => link.id === links.active.id).status, 'SUSPENDED');

    const current = await db.collection('versions').findOne({ fileId: oid(file.id), versionNumber: 2 });
    assert.equal(current.securityStatus, 'QUARANTINED');
    assert.equal((await db.collection('versions').findOne({ fileId: oid(file.id), versionNumber: 1 })).securityStatus, 'SAFE');

    const event = await db.collection('activities').findOne({ action: 'QUARANTINE', fileId: oid(file.id) });
    assert.equal(String(event.userId), owner.user.id, 'recorded on the owner\'s timeline');
    assert.equal(event.metadata.actor, 'ADMIN');
    assert.equal(String(event.metadata.adminId), admin.user.id);

    const ownerActivity = await api('GET', '/me/activity?limit=100', { token: owner.token });
    assert.ok(!ownerActivity.body.data.some((entry) => entry.action === 'QUARANTINE'), 'internal event hidden from the user');

    const repeat = await adminCall('POST', `/admin/files/${file.id}/quarantine`, { json: { reason: 'again' } }, { action: 'QUARANTINE_FILE', result: 'FAILURE' });
    assert.equal(repeat.status, 409);
    assert.equal(repeat.body.error.code, 'INVALID_TRANSITION');

    // A second, independent quarantine on another file.
    const otherQuarantine = await adminCall('POST', `/admin/files/${other.id}/quarantine`, { json: { reason: 'Separate review' } }, { action: 'QUARANTINE_FILE', result: 'SUCCESS' });
    assert.equal(otherQuarantine.status, 201);
  });

  test('file contents require owner approval for one specific download and every attempt is audited', async () => {
    const missingReason = await adminCall('POST', `/admin/files/${file.id}/access-requests`, { json: {} }, { action: 'REQUEST_FILE_ACCESS', result: 'FAILURE' });
    assert.equal(missingReason.status, 422);

    const requested = await adminCall('POST', `/admin/files/${file.id}/access-requests`, {
      json: { reason: 'Validate the quarantined version during the security investigation' },
    }, { action: 'REQUEST_FILE_ACCESS', result: 'SUCCESS' });
    assert.equal(requested.status, 201, JSON.stringify(requested.body));
    const currentRequest = requested.body.data.request;

    const pending = await adminCall('POST', `/admin/file-access-requests/${currentRequest.id}/download`, {}, { action: 'FORENSIC_DOWNLOAD', result: 'FAILURE' });
    assert.equal(pending.status, 409);
    assert.equal(pending.body.error.code, 'FILE_ACCESS_NOT_APPROVED');

    const ownerRequests = await api('GET', '/me/file-access-requests', { token: owner.token });
    assert.equal(ownerRequests.status, 200);
    assert.equal(ownerRequests.body.data[0].file.name, 'numbers.csv');
    assert.equal(ownerRequests.body.data[0].versionNumber, 2);
    assert.equal(ownerRequests.body.data[0].status, 'PENDING');
    assert.equal(ownerRequests.body.data[0].reason, 'Validate the quarantined version during the security investigation');

    const stranger = await register('access-stranger');
    assert.equal((await api('POST', `/me/file-access-requests/${currentRequest.id}/respond`, {
      token: stranger.token, json: { decision: 'APPROVE' },
    })).status, 404, 'only the file owner can decide');
    assert.equal((await api('POST', `/me/file-access-requests/${currentRequest.id}/respond`, {
      token: owner.token, json: { decision: 'APPROVE' },
    })).body.data.status, 'APPROVED');

    const current = await adminCall('POST', `/admin/file-access-requests/${currentRequest.id}/download`, {}, { action: 'FORENSIC_DOWNLOAD', result: 'SUCCESS' });
    assert.equal(current.status, 200);
    assert.equal(sha256(current.buffer), sha256(q2));
    const reused = await adminCall('POST', `/admin/file-access-requests/${currentRequest.id}/download`, {}, { action: 'FORENSIC_DOWNLOAD', result: 'FAILURE' });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error.code, 'FILE_ACCESS_NOT_APPROVED');

    const security = await api('GET', '/me/security', { token: owner.token });
    const accessNotice = security.body.data.recentNotifications.find((notice) => notice.type === 'ADMIN_FILE_ACCESS');
    assert.ok(accessNotice);
    assert.match(accessNotice.message, /numbers\.csv.*v2.*recorded/i);
    assert.doesNotMatch(accessNotice.message, /Validate|admin@test|risk|incident/i, 'owner notice contains no investigation details');

    const v1 = await db.collection('versions').findOne({ fileId: oid(file.id), versionNumber: 1 });
    const olderRequested = await adminCall('POST', `/admin/files/${file.id}/access-requests`, {
      json: { reason: 'Compare with the original upload', versionId: String(v1._id) },
    }, { action: 'REQUEST_FILE_ACCESS', result: 'SUCCESS' });
    const olderRequestId = olderRequested.body.data.request.id;
    await api('POST', `/me/file-access-requests/${olderRequestId}/respond`, { token: owner.token, json: { decision: 'APPROVE' } });
    const older = await adminCall('POST', `/admin/file-access-requests/${olderRequestId}/download`, {}, { action: 'FORENSIC_DOWNLOAD', result: 'SUCCESS' });
    assert.equal(sha256(older.buffer), sha256(q1));

    const entries = await db.collection('adminauditlogs').find({ action: 'FORENSIC_DOWNLOAD', 'target.id': oid(file.id) }).toArray();
    assert.equal(entries.length, 0, 'download audits target the consent request, not the underlying file');
    const accessEntries = await db.collection('adminauditlogs').find({ action: 'FORENSIC_DOWNLOAD', 'target.kind': 'FileAccessRequest' }).toArray();
    assert.equal(accessEntries.filter((entry) => entry.result === 'SUCCESS').length, 2);
    assert.equal(accessEntries.filter((entry) => entry.result === 'FAILURE').length, 2);
    assert.ok(accessEntries.every((entry) => String(entry.adminId) === admin.user.id));
    assert.deepEqual(accessEntries.filter((entry) => entry.result === 'SUCCESS').map((entry) => entry.after.versionNumber).sort(), [1, 2]);
  });

  test('release: file ACTIVE, versions SAFE, only links suspended by that quarantine (and not expired) reactivated', async () => {
    // One suspended link expires while the file is under review.
    await db.collection('sharelinks').updateOne({ tokenHash: sha256(links.expiresDuringQuarantine.token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const missingNote = await adminCall('POST', `/admin/quarantine/${item.id}/release`, { json: {} }, { action: 'RELEASE_QUARANTINE', result: 'FAILURE' });
    assert.equal(missingNote.status, 422);

    const res = await adminCall('POST', `/admin/quarantine/${item.id}/release`, { json: { note: 'Edits confirmed with the owner' } }, { action: 'RELEASE_QUARANTINE', result: 'SUCCESS' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.reactivatedLinks, 1);
    assert.equal(res.body.data.expiredLinks, 1);

    const fileDoc = await db.collection('files').findOne({ _id: oid(file.id) });
    assert.equal(fileDoc.status, 'ACTIVE');
    assert.equal(fileDoc.quarantinedAt, undefined);
    assert.equal(fileDoc.currentVersion, 2, 'release does not restore: the current version stays');
    const version = await db.collection('versions').findOne({ fileId: oid(file.id), versionNumber: 2 });
    assert.equal(version.securityStatus, 'SAFE');

    const itemDoc = await db.collection('quarantineitems').findOne({ _id: oid(item.id) });
    assert.equal(itemDoc.status, 'RELEASED');
    assert.equal(itemDoc.releaseNote, 'Edits confirmed with the owner');
    assert.equal(String(itemDoc.releasedBy), admin.user.id);

    const reactivated = await linkDoc(links.active.token);
    assert.equal(reactivated.status, 'ACTIVE');
    assert.equal(reactivated.suspendedByQuarantineId, undefined);
    assert.equal((await linkDoc(links.expiresDuringQuarantine.token)).status, 'EXPIRED', 'expired while suspended: not reactivated');
    assert.equal((await linkDoc(links.revoked.token)).status, 'REVOKED');
    assert.equal((await linkDoc(links.otherFile.token)).status, 'SUSPENDED', 'links suspended by another quarantine stay suspended');

    assert.equal((await api('GET', `/s/${links.active.token}`)).status, 200);
    assert.equal((await api('GET', `/s/${links.expiresDuringQuarantine.token}`)).status, 410);
    assert.equal((await api('GET', `/files/${file.id}/download`, { token: owner.token })).status, 200);
    assert.ok(await db.collection('activities').findOne({ action: 'QUARANTINE_RELEASE', fileId: oid(file.id) }));

    const again = await adminCall('POST', `/admin/quarantine/${item.id}/release`, { json: { note: 'twice' } }, { action: 'RELEASE_QUARANTINE', result: 'FAILURE' });
    assert.equal(again.status, 409);
  });

  test('quarantine list shows items with file, owner, reason and status', async () => {
    const res = await api('GET', '/admin/quarantine', { token: admin.token });
    assert.equal(res.status, 200);
    const released = res.body.data.find((entry) => entry.id === item.id);
    assert.equal(released.status, 'RELEASED');
    assert.equal(released.file.name, 'numbers.csv');
    assert.equal(released.owner.email, owner.email);
    assert.equal(released.admin.id, admin.user.id);
    const open = await api('GET', '/admin/quarantine?status=QUARANTINED', { token: admin.token });
    assert.deepEqual(open.body.data.map((entry) => entry.file.name), ['other.txt']);
    assert.equal(open.body.data[0].suspendedLinks, 1);
  });

  test('deleting a file suspends its links (spec §7)', async () => {
    const doomed = await upload(owner.token, 'doomed.txt', 'bye');
    const link = await share(owner.token, doomed.id, { permission: 'DOWNLOAD', expiresAt: inHours(1) });
    assert.equal((await api('DELETE', `/files/${doomed.id}`, { token: owner.token })).status, 204);
    assert.equal((await linkDoc(link.body.data.token)).status, 'SUSPENDED');
    assert.deepEqual((await api('GET', `/s/${link.body.data.token}`)).body, GENERIC_410);
  });
});

// ── Admin: users, files, audit ──────────────────────────────────────────────────────────

describe('admin', () => {
  test('freeze/unfreeze works; signOut revokes the old token (401)', async () => {
    const target = await register('target');
    const secondSession = (await api('POST', '/auth/login', { json: { email: target.email, password: target.password } })).body.data.accessToken;

    const freeze = await adminCall('POST', `/admin/users/${target.user.id}/freeze`, { json: { reason: 'Reviewing bulk edits from last night' } }, { action: 'FREEZE_USER', result: 'SUCCESS' });
    assert.equal(freeze.status, 200, JSON.stringify(freeze.body));
    assert.equal(freeze.body.data.user.status, 'FROZEN');
    const me = await api('GET', '/auth/me', { token: target.token });
    assert.equal(me.status, 200, 'without signOut the session stays, read-only');
    assert.equal(me.body.data.user.status, 'FROZEN');
    assert.equal((await api('POST', '/folders', { token: target.token, json: { name: 'Blocked' } })).status, 423);

    const freezeEvent = await db.collection('activities').findOne({ action: 'FREEZE', userId: oid(target.user.id) });
    assert.equal(String(freezeEvent.metadata.adminId), admin.user.id);

    const security = await api('GET', '/me/security', { token: target.token });
    assert.equal(security.body.data.recentNotifications[0].type, 'ACCOUNT_PAUSED');
    assert.ok(!JSON.stringify(security.body).includes('Reviewing bulk edits'), 'the admin\'s reason is never shown to the user');

    const unfreeze = await adminCall('POST', `/admin/users/${target.user.id}/unfreeze`, { json: { reason: 'Owner confirmed the edits' } }, { action: 'UNFREEZE_USER', result: 'SUCCESS' });
    assert.equal(unfreeze.status, 200);
    assert.equal((await api('POST', '/folders', { token: target.token, json: { name: 'Allowed' } })).status, 201);
    assert.ok(await db.collection('activities').findOne({ action: 'UNFREEZE', userId: oid(target.user.id) }));

    const withSignOut = await adminCall('POST', `/admin/users/${target.user.id}/freeze`, { json: { reason: 'Lock the account now', signOut: true } }, { action: 'FREEZE_USER', result: 'SUCCESS' });
    assert.equal(withSignOut.status, 200);
    assert.equal(withSignOut.body.data.revokedSessions, 2);
    for (const token of [target.token, secondSession]) {
      const old = await api('GET', '/auth/me', { token });
      assert.equal(old.status, 401);
      assert.equal(old.body.error.code, 'SESSION_REVOKED');
    }
    const sessions = await db.collection('sessions').find({ userId: oid(target.user.id) }).toArray();
    assert.ok(sessions.every((session) => session.status === 'REVOKED' && session.revokedReason === 'FREEZE_SIGNOUT'));

    // They can sign in again, still frozen.
    const relog = await api('POST', '/auth/login', { json: { email: target.email, password: target.password } });
    assert.equal(relog.body.data.user.status, 'FROZEN');
    assert.equal((await api('POST', '/folders', { token: relog.body.data.accessToken, json: { name: 'Nope' } })).status, 423);

    const duplicate = await adminCall('POST', `/admin/users/${target.user.id}/freeze`, { json: { reason: 'again' } }, { action: 'FREEZE_USER', result: 'FAILURE' });
    assert.equal(duplicate.status, 409);
    await adminCall('POST', `/admin/users/${target.user.id}/unfreeze`, { json: { reason: 'done' } }, { action: 'UNFREEZE_USER', result: 'SUCCESS' });
  });

  test('admin cannot freeze self', async () => {
    const res = await adminCall('POST', `/admin/users/${admin.user.id}/freeze`, { json: { reason: 'test' } }, { action: 'FREEZE_USER', result: 'FAILURE' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'CANNOT_FREEZE_SELF');
    const doc = await db.collection('users').findOne({ _id: oid(admin.user.id) });
    assert.equal(doc.status, 'ACTIVE');
  });

  test('users and files lists return real data, including deleted and quarantined files', async () => {
    const users = await api('GET', '/admin/users?limit=100', { token: admin.token });
    assert.equal(users.status, 200);
    const ownerRow = users.body.data.find((user) => user.id === owner.user.id);
    assert.ok(ownerRow.lastActivityAt);
    assert.equal((await api('GET', `/admin/users?q=${encodeURIComponent(owner.email)}`, { token: admin.token })).body.data.length, 1);

    const detail = await api('GET', `/admin/users/${owner.user.id}`, { token: admin.token });
    assert.ok(detail.body.data.fileCount > 0);
    assert.ok(detail.body.data.recentActivity.length > 0);

    const all = await api('GET', '/admin/files?limit=100', { token: admin.token });
    const statuses = new Set(all.body.data.map((file) => file.status));
    assert.ok(statuses.has('DELETED') && statuses.has('QUARANTINED') && statuses.has('ACTIVE'));
    const deleted = await api('GET', '/admin/files?status=DELETED', { token: admin.token });
    assert.ok(deleted.body.data.every((file) => file.status === 'DELETED' && file.deletedAt));
    const byOwner = await api('GET', `/admin/files?owner=${encodeURIComponent(owner.email)}&q=numbers`, { token: admin.token });
    assert.deepEqual(byOwner.body.data.map((file) => file.name), ['numbers.csv']);
    assert.equal(byOwner.body.data[0].owner.email, owner.email);
  });

  test('non-admin gets 403 on every /api/admin route (401 without a token)', async () => {
    const someone = await register('someone');
    const fileId = (await db.collection('files').findOne({}))._id;
    const itemId = (await db.collection('quarantineitems').findOne({}))._id;
    const routes = [
      ['GET', '/admin/users'],
      ['GET', `/admin/users/${owner.user.id}`],
      ['POST', `/admin/users/${owner.user.id}/freeze`, { reason: 'x' }],
      ['POST', `/admin/users/${owner.user.id}/unfreeze`, { reason: 'x' }],
      ['GET', '/admin/files'],
      ['POST', `/admin/files/${fileId}/quarantine`, { reason: 'x' }],
      ['POST', `/admin/files/${fileId}/access-requests`, { reason: 'x' }],
      ['POST', `/admin/file-access-requests/${fileId}/download`],
      ['GET', '/admin/quarantine'],
      ['POST', `/admin/quarantine/${itemId}/release`, { note: 'x' }],
      ['GET', '/admin/audit'],
      ['GET', '/admin/summary'],
    ];
    const auditBefore = await db.collection('adminauditlogs').countDocuments();
    for (const [method, route, json] of routes) {
      const res = await api(method, route, { token: someone.token, json });
      assert.equal(res.status, 403, `${method} ${route}`);
      const anonymous = await api(method, route, { json });
      assert.equal(anonymous.status, 401, `${method} ${route} without a token`);
    }
    assert.equal(await db.collection('adminauditlogs').countDocuments(), auditBefore, 'rejected before any admin action runs');
    assert.equal((await db.collection('users').findOne({ _id: oid(owner.user.id) })).status, 'ACTIVE');
  });

  test('every admin action appears in the audit log, including failed ones; the log is append-only', async () => {
    const res = await api('GET', '/admin/audit?limit=100', { token: admin.token });
    assert.equal(res.status, 200);
    const entries = res.body.data;
    assert.equal(entries.length, adminCalls.length, `one audit entry per admin action (${adminCalls.length})`);

    const count = (action, result) => entries.filter((entry) => entry.action === action && entry.result === result).length;
    const expected = (action, result) => adminCalls.filter((call) => call.action === action && call.result === result).length;
    for (const [action, result] of [
      ['FREEZE_USER', 'SUCCESS'], ['FREEZE_USER', 'FAILURE'], ['UNFREEZE_USER', 'SUCCESS'],
      ['QUARANTINE_FILE', 'SUCCESS'], ['QUARANTINE_FILE', 'FAILURE'],
      ['REQUEST_FILE_ACCESS', 'SUCCESS'], ['REQUEST_FILE_ACCESS', 'FAILURE'],
      ['FORENSIC_DOWNLOAD', 'SUCCESS'], ['FORENSIC_DOWNLOAD', 'FAILURE'],
      ['RELEASE_QUARANTINE', 'SUCCESS'], ['RELEASE_QUARANTINE', 'FAILURE'],
    ]) {
      assert.equal(count(action, result), expected(action, result), `${action} ${result}`);
      assert.ok(count(action, result) > 0, `${action} ${result} was exercised`);
    }

    const selfFreeze = entries.find((entry) => entry.action === 'FREEZE_USER' && entry.error?.startsWith('CANNOT_FREEZE_SELF'));
    assert.ok(selfFreeze, 'the failed self-freeze is logged with its error');
    assert.equal(selfFreeze.target.label, admin.user.email);
    const release = entries.find((entry) => entry.action === 'RELEASE_QUARANTINE' && entry.result === 'SUCCESS');
    assert.equal(release.note, 'Edits confirmed with the owner');
    assert.equal(release.target.label, 'numbers.csv');
    assert.ok(entries.every((entry) => entry.admin.id === admin.user.id && entry.via === 'UI' && entry.ip));

    const failures = await api('GET', '/admin/audit?result=FAILURE', { token: admin.token });
    assert.ok(failures.body.data.length >= 4 && failures.body.data.every((entry) => entry.result === 'FAILURE'));

    const someId = entries[0].id;
    for (const method of ['PATCH', 'PUT', 'DELETE']) {
      assert.equal((await api(method, `/admin/audit/${someId}`, { token: admin.token, json: {} })).status, 404, `${method} has no route`);
    }
    assert.equal(await db.collection('adminauditlogs').countDocuments(), entries.length);
  });
});

// ── Response hygiene ────────────────────────────────────────────────────────────────────

describe('no internal data in responses', () => {
  test('public share responses contain no internal ids, owner data or paths', () => {
    const publicResponses = harness.responses.filter((entry) => entry.public);
    assert.ok(publicResponses.length > 15, `scanned ${publicResponses.length} public responses`);
    for (const { route, data } of publicResponses) {
      const text = JSON.stringify(data);
      assert.ok(!/[a-f0-9]{24}/i.test(text), `${route} contains something shaped like an internal id`);
      for (const key of ['id', 'fileId', 'ownerId', 'createdBy', 'owner', 'shareLinkId', 'recipientLabel', 'folderId', 'sha256']) {
        assert.ok(!text.includes(`"${key}"`), `${route} exposed ${key}`);
      }
    }
  });

  test('raw share tokens appear only in their creation response; no hashes, keys or paths anywhere', async () => {
    for (const { token, createRoute } of issuedTokens) {
      const leaks = harness.responses.filter(({ route, data }) => !route.startsWith(createRoute) && JSON.stringify(data).includes(token));
      assert.deepEqual(leaks.map((entry) => entry.route), [], 'raw token is not retrievable after creation');
    }
    const links = await db.collection('sharelinks').find({}).toArray();
    await harness.assertNoLeaks({
      minimum: 100,
      extraSecrets: links.flatMap((link) => [link.tokenHash, link.passwordHash].filter(Boolean)),
    });
  });
});
