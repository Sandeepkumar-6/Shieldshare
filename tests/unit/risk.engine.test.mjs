// Unit tests for server/src/security/risk.engine.js (spec §16): clamp, partial points, the
// multi-signal gate, the canary floor and severity bands.
//
//   cd server && npm run test:detection

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { computeRisk, severityFor } = await import(new URL('../../server/src/security/risk.engine.js', import.meta.url));
const { evaluateRules } = await import(new URL('../../server/src/security/rules.engine.js', import.meta.url));
const { DEFAULT_DETECTION_CONFIG } = await import(new URL('../../server/src/security/config.service.js', import.meta.url));

const config = structuredClone(DEFAULT_DETECTION_CONFIG);
const signal = (key, category, points) => ({ key, category, label: key, level: points ? 'full' : 'none', points, maxPoints: points });

describe('risk engine', () => {
  test('score is the sum of points, clamped to 100; the raw sum is kept', () => {
    const result = computeRisk([
      signal('massModification', 'BEHAVIOR', 50),
      signal('massRename', 'BEHAVIOR', 50),
      signal('hashChangeRatio', 'INTEGRITY', 10),
      signal('canaryTrigger', 'DECEPTION', 20),
    ], config);
    assert.equal(result.rawScore, 130);
    assert.equal(result.score, 100);
    assert.equal(result.severity, 'CRITICAL');
    assert.equal(result.capApplied, false);
    assert.deepEqual(result.categories.sort(), ['BEHAVIOR', 'DECEPTION', 'INTEGRITY']);
    assert.ok(result.reasons.some((reason) => reason.includes('clamped')));
  });

  test('partial rules contribute half their weight through the rules engine', () => {
    const entries = Array.from({ length: 5 }, (_, i) => ({
      id: `m${i}`, action: 'MODIFY', fileId: `f${i}`, directory: 'd', timestamp: new Date(), hashBefore: 'a', hashAfter: `b${i}`,
    }));
    const result = computeRisk(evaluateRules(entries, config), config);
    // mass modification partial (10) + hash-change ratio 1.0 × 10
    assert.equal(result.rawScore, 20);
    assert.equal(result.severity, 'SAFE');
  });

  test('multi-signal gate: one category cannot reach CRITICAL; capped at 79 with a reason', () => {
    const result = computeRisk([
      signal('massRename', 'BEHAVIOR', 45),
      signal('extensionChanges', 'BEHAVIOR', 45),
    ], config);
    assert.equal(result.rawScore, 90);
    assert.equal(result.score, 79);
    assert.equal(result.severity, 'HIGH');
    assert.equal(result.capApplied, true);
    assert.ok(result.reasons.some((reason) => reason.startsWith('Single-category cap applied')));
  });

  test('two categories may reach CRITICAL; the minimum is configurable', () => {
    const signals = [signal('massRename', 'BEHAVIOR', 60), signal('canaryTrigger', 'DECEPTION', 20)];
    assert.equal(computeRisk(signals, config).severity, 'CRITICAL');
    const stricter = { ...config, minCategoriesForCritical: 3 };
    const capped = computeRisk(signals, stricter);
    assert.equal(capped.score, 79);
    assert.equal(capped.capApplied, true);
  });

  test('below the critical band the gate never applies', () => {
    const result = computeRisk([signal('massRename', 'BEHAVIOR', 70)], config);
    assert.equal(result.score, 70);
    assert.equal(result.capApplied, false);
    assert.equal(result.severity, 'HIGH');
  });

  test('canary floor: a canary alone is at least SUSPICIOUS, with a reason', () => {
    const result = computeRisk([signal('canaryTrigger', 'DECEPTION', 20)], config);
    assert.equal(result.score, 20);
    assert.equal(result.severity, 'SUSPICIOUS');
    assert.ok(result.reasons.some((reason) => reason.startsWith('Canary floor')));
    assert.equal(computeRisk([signal('massRename', 'BEHAVIOR', 20)], config).severity, 'SAFE');
  });

  test('severity bands (default and custom)', () => {
    const bands = config.severityBands;
    assert.equal(severityFor(0, bands), 'SAFE');
    assert.equal(severityFor(29.9, bands), 'SAFE');
    assert.equal(severityFor(30, bands), 'SUSPICIOUS');
    assert.equal(severityFor(59.9, bands), 'SUSPICIOUS');
    assert.equal(severityFor(60, bands), 'HIGH');
    assert.equal(severityFor(79.9, bands), 'HIGH');
    assert.equal(severityFor(80, bands), 'CRITICAL');
    assert.equal(severityFor(100, bands), 'CRITICAL');
    const custom = { suspicious: 20, high: 40, critical: 70 };
    assert.equal(severityFor(45, custom), 'HIGH');
    const capped = computeRisk([signal('x', 'BEHAVIOR', 90)], { ...config, severityBands: custom });
    assert.equal(capped.score, 69, 'cap sits just below the configured critical band');
  });

  test('no signals: SAFE, score 0', () => {
    const result = computeRisk(evaluateRules([], config), config);
    assert.deepEqual([result.score, result.rawScore, result.severity, result.categories.length], [0, 0, 'SAFE', 0]);
  });
});
