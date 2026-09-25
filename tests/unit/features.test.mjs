import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { computeFeatures, ML_FEATURES } = await import('../../server/src/security/features.js');

describe('ML feature vector', () => {
  test('uses the fixed model order and documented window-level definitions', () => {
    const at = Date.parse('2026-09-25T10:00:00Z');
    const features = computeFeatures([
      { action: 'MODIFY', fileId: 'a', directory: 'd1', timestamp: new Date(at), hashBefore: 'x', hashAfter: 'y', entropyBefore: 4, entropyAfter: 7 },
      { action: 'RENAME', fileId: 'a', directory: 'd2', fromDirectory: 'd1', timestamp: new Date(at + 200), nameBefore: 'a.txt', nameAfter: 'a.txt.locked' },
      { action: 'DELETE', fileId: 'b', directory: 'd2', timestamp: new Date(at + 500) },
      { action: 'CANARY_TRIGGER', fileId: 'c', directory: 'd3', timestamp: new Date(at + 600) },
    ], 60);
    assert.deepEqual(Object.keys(features), ML_FEATURES);
    assert.equal(features.ops_per_min, 3);
    assert.equal(features.mods_per_min, 1);
    assert.equal(features.renames_per_min, 1);
    assert.equal(features.deletes_per_min, 1);
    assert.equal(features.dirs_affected, 2);
    assert.equal(features.ext_changes, 1);
    assert.equal(features.entropy_delta_mean, 3);
    assert.equal(features.entropy_delta_max, 3);
    assert.equal(features.hash_change_ratio, 0.5);
    assert.equal(features.mean_interarrival_ms, 250);
  });
});
