import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

const originalFetch = globalThis.fetch;
const { scoreWindow } = await import('../../server/src/security/ml.client.js');
afterEach(() => { globalThis.fetch = originalFetch; });

describe('ML client fallback', () => {
  test('accepts a valid score response', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ anomalyScore: 0.8, isAnomaly: true, raw: -0.7, modelVersion: 'test-model' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
    const result = await scoreWindow({ features: {} }, { timeoutMs: 100, enabled: true });
    assert.equal(result.status, 'OK');
    assert.equal(result.anomalyScore, 0.8);
  });

  test('invalid responses and timeouts become UNAVAILABLE with zero contribution', async () => {
    globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    assert.equal((await scoreWindow({ features: {} }, { timeoutMs: 100, enabled: true })).status, 'UNAVAILABLE');

    globalThis.fetch = async (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const timed = await scoreWindow({ features: {} }, { timeoutMs: 20, enabled: true });
    assert.equal(timed.status, 'UNAVAILABLE');
    assert.equal(timed.contribution, 0);
  });
});
