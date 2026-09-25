import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_PROFILES, fixtureContent, mimeTypeFor } from '../../server/src/seeding/demoFixtures.js';

describe('realistic demo fixtures', () => {
  it('covers the documented user states without duplicate accounts', () => {
    assert.equal(DEMO_PROFILES.length, 8);
    assert.equal(new Set(DEMO_PROFILES.map((profile) => profile.email)).size, DEMO_PROFILES.length);
    assert.ok(DEMO_PROFILES.some((profile) => profile.incident === 'contained'));
    assert.ok(DEMO_PROFILES.some((profile) => profile.incident === 'recovered'));
    assert.ok(DEMO_PROFILES.some((profile) => profile.securityEvent));
    assert.ok(DEMO_PROFILES.some((profile) => profile.shares));
  });

  it('includes every supported demonstration format requested by the seed dataset', () => {
    const extensions = new Set(DEMO_PROFILES.flatMap((profile) => profile.files.map(([, name]) => name.slice(name.lastIndexOf('.')))));
    for (const extension of ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.csv', '.zip', '.png']) {
      assert.ok(extensions.has(extension), `missing ${extension}`);
    }
  });

  it('generates recognizable PDF, Office, ZIP and PNG payloads with canonical MIME types', () => {
    assert.equal(fixtureContent('brief.pdf').subarray(0, 4).toString(), '%PDF');
    for (const name of ['contract.docx', 'budget.xlsx', 'roadmap.pptx', 'assets.zip']) {
      assert.equal(fixtureContent(name).subarray(0, 4).toString('hex'), '504b0304');
    }
    assert.equal(fixtureContent('map.png').subarray(0, 4).toString('hex'), '89504e47');
    assert.equal(mimeTypeFor('budget.xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  });
});
