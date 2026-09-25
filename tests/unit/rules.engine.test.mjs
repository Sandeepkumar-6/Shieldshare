// Unit tests for server/src/security/rules.engine.js (spec §11, §12, §14). Pure functions:
// no database or server needed.
//
//   cd server && npm run test:detection

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { evaluateRules, levelFor, pointsFor, extensionOf } = await import(
  new URL('../../server/src/security/rules.engine.js', import.meta.url)
);
const { DEFAULT_DETECTION_CONFIG } = await import(new URL('../../server/src/security/config.service.js', import.meta.url));

const config = structuredClone(DEFAULT_DETECTION_CONFIG);
let seq = 0;
const at = new Date('2026-09-25T10:00:00Z');

function entry(action, fields = {}) {
  seq += 1;
  return {
    id: `a${seq}`,
    action,
    fileId: fields.fileId ?? `f${seq}`,
    directory: fields.directory ?? 'd1',
    fromDirectory: fields.fromDirectory ?? null,
    timestamp: new Date(at.getTime() + seq),
    isCanary: false,
    nameBefore: null,
    nameAfter: null,
    hashBefore: null,
    hashAfter: null,
    ...fields,
  };
}
const modify = (fileId, fields = {}) => entry('MODIFY', { fileId, hashBefore: `h-${fileId}-old`, hashAfter: `h-${fileId}-new-${seq}`, ...fields });
const rename = (fileId, nameBefore, nameAfter, fields = {}) => entry('RENAME', { fileId, nameBefore, nameAfter, ...fields });
const signalsOf = (entries) => Object.fromEntries(evaluateRules(entries, config).map((signal) => [signal.key, signal]));
const range = (count) => Array.from({ length: count }, (_, index) => index);

describe('levels and points', () => {
  test('partial at 50% of the threshold scores half, full at the threshold scores all', () => {
    assert.equal(levelFor(4, 10), 'none');
    assert.equal(levelFor(5, 10), 'partial');
    assert.equal(levelFor(9, 10), 'partial');
    assert.equal(levelFor(10, 10), 'full');
    assert.equal(levelFor(2, 3), 'partial', '50% of 3 is 1.5, so 2 is partial');
    assert.equal(pointsFor('none', 20), 0);
    assert.equal(pointsFor('partial', 15), 7.5);
    assert.equal(pointsFor('full', 20), 20);
  });

  test('extensions are compared case-insensitively; a name without one has none', () => {
    assert.equal(extensionOf('report.pdf.locked'), '.locked');
    assert.equal(extensionOf('Report.PDF'), '.pdf');
    assert.equal(extensionOf('README'), '');
    assert.equal(extensionOf('.env'), '');
  });
});

describe('behavior rules', () => {
  test('signals have exactly the SignalSchema shape', () => {
    const signals = evaluateRules([modify('x')], config);
    assert.deepEqual(signals.map((signal) => signal.key), [
      'rapidActivity', 'massModification', 'massRename', 'massDelete', 'directorySpread',
      'extensionChanges', 'hashChangeRatio', 'entropyChange', 'canaryTrigger',
    ]);
    for (const signal of signals) {
      assert.deepEqual(Object.keys(signal).sort(), ['category', 'evidence', 'key', 'label', 'level', 'maxPoints', 'observed', 'points', 'threshold']);
      assert.ok(['none', 'partial', 'full'].includes(signal.level));
      assert.ok(['BEHAVIOR', 'INTEGRITY', 'CONTENT', 'DECEPTION', 'ANOMALY'].includes(signal.category));
    }
  });

  test('mass modification counts DISTINCT files; rapid activity counts operations', () => {
    const sameFile = range(30).map(() => modify('only'));
    const s = signalsOf(sameFile);
    assert.equal(s.massModification.observed.files, 1);
    assert.equal(s.massModification.level, 'none');
    assert.equal(s.rapidActivity.observed.operations, 30);
    assert.equal(s.rapidActivity.level, 'full');
    assert.equal(s.rapidActivity.points, 15);

    const tenFiles = signalsOf(range(10).map((i) => modify(`m${i}`)));
    assert.equal(tenFiles.massModification.level, 'full');
    assert.equal(tenFiles.massModification.points, 20);
    const fiveFiles = signalsOf(range(5).map((i) => modify(`p${i}`)));
    assert.equal(fiveFiles.massModification.level, 'partial');
    assert.equal(fiveFiles.massModification.points, 10);
  });

  test('mass rename and mass delete use their own thresholds (8 files)', () => {
    const renames = signalsOf(range(8).map((i) => rename(`r${i}`, `doc${i}.txt`, `doc${i}-final.txt`)));
    assert.equal(renames.massRename.level, 'full');
    assert.equal(renames.massRename.points, 15);
    assert.equal(renames.extensionChanges.level, 'none', 'same extension, so no extension change');

    const deletes = signalsOf(range(4).map((i) => entry('DELETE', { fileId: `x${i}` })));
    assert.equal(deletes.massDelete.level, 'partial');
    assert.equal(deletes.massDelete.points, 7.5);
  });

  test('directory spread counts both folders of a move', () => {
    const s = signalsOf([
      entry('MOVE', { fileId: 'a', directory: 'd2', fromDirectory: 'd1' }),
      entry('MODIFY', { fileId: 'b', directory: 'd3' }),
    ]);
    assert.equal(s.directorySpread.observed.folders, 3);
    assert.equal(s.directorySpread.level, 'full');
    assert.equal(s.directorySpread.points, 10);
  });

  test('extension changes: ≥ 5 files changing extension, or ≥ 3 to the same one', () => {
    const mixed = signalsOf(range(5).map((i) => rename(`e${i}`, `f${i}.txt`, `f${i}.${['a', 'b', 'c', 'd', 'e'][i]}`)));
    assert.equal(mixed.extensionChanges.observed.files, 5);
    assert.equal(mixed.extensionChanges.level, 'full');

    const locked = signalsOf(range(3).map((i) => rename(`l${i}`, `q${i}.CSV`, `q${i}.csv.LOCKED`)));
    assert.equal(locked.extensionChanges.observed.sameExtension, 3);
    assert.equal(locked.extensionChanges.observed.extension, '.locked');
    assert.equal(locked.extensionChanges.level, 'full');
    assert.equal(locked.extensionChanges.points, 15);

    const two = signalsOf(range(2).map((i) => rename(`t${i}`, `t${i}.txt`, `t${i}.txt.enc`)));
    assert.equal(two.extensionChanges.level, 'partial', '2 of 3 to the same extension');

    const noExtension = signalsOf([rename('n', 'notes', 'notes.locked')]);
    assert.equal(noExtension.extensionChanges.observed.files, 1, 'adding an extension is a change');
  });
});

describe('integrity (hash-change ratio)', () => {
  test('one document edited many times does not score: gated on mass modification', () => {
    const s = signalsOf(range(12).map(() => modify('same-doc')));
    assert.equal(s.hashChangeRatio.observed.ratio, 1);
    assert.equal(s.hashChangeRatio.threshold.gateMet, false);
    assert.equal(s.hashChangeRatio.points, 0);
  });

  test('ratio of changed files to touched files, times the weight, once the gate is met', () => {
    const all = signalsOf(range(10).map((i) => modify(`c${i}`)));
    assert.equal(all.hashChangeRatio.observed.ratio, 1);
    assert.equal(all.hashChangeRatio.points, 10);

    const half = signalsOf([
      ...range(10).map((i) => modify(`h${i}`)),
      ...range(10).map((i) => rename(`other${i}`, `o${i}.txt`, `o${i}-2.txt`)),
    ]);
    assert.equal(half.hashChangeRatio.observed.touchedFiles, 20);
    assert.equal(half.hashChangeRatio.observed.changedFiles, 10);
    assert.equal(half.hashChangeRatio.points, 5);

    const unchanged = signalsOf(range(10).map((i) => modify(`u${i}`, { hashAfter: `h-u${i}-old` })));
    assert.equal(unchanged.hashChangeRatio.points, 0, 'identical content re-uploaded changes no hash');
  });
});

describe('content and deception', () => {
  test('entropy disabled preserves the Phase 4 score and explains why', () => {
    const s = signalsOf(range(10).map((i) => modify(`z${i}`)));
    assert.equal(s.entropyChange.points, 0);
    assert.equal(s.entropyChange.observed.enabled, false);
    assert.equal(s.entropyChange.observed.note, 'not enabled');
    assert.equal(s.entropyChange.category, 'CONTENT');
  });

  test('entropy scores the qualifying share of distinct modified files', () => {
    const enabled = structuredClone(config);
    enabled.entropy.enabled = true;
    const signals = Object.fromEntries(evaluateRules([
      modify('text-1', { fileName: 'notes.txt', entropyBefore: 4.1, entropyAfter: 7.7 }),
      modify('text-2', { fileName: 'budget.csv', entropyBefore: 4.8, entropyAfter: 6.5 }),
      modify('normal', { fileName: 'draft.md', entropyBefore: 4.2, entropyAfter: 4.5 }),
      modify('compressed', { fileName: 'report.pdf', entropyBefore: 7.8, entropyAfter: 7.95 }),
    ], enabled).map((signal) => [signal.key, signal]));
    const entropy = signals.entropyChange;
    assert.equal(entropy.observed.qualifyingFiles, 2);
    assert.equal(entropy.observed.modifiedFiles, 4);
    assert.equal(entropy.observed.ratio, 0.5);
    assert.equal(entropy.level, 'full');
    assert.equal(entropy.points, 5);
    assert.equal(entropy.evidence.length, 2);
    assert.equal(entropy.observed.files.find((file) => file.name === 'report.pdf').highBaseline, true);
  });

  test('normal text edits and already-compressed baselines are low evidence', () => {
    const enabled = structuredClone(config);
    enabled.entropy.enabled = true;
    const signals = Object.fromEntries(evaluateRules([
      modify('text', { entropyBefore: 4.3, entropyAfter: 4.8 }),
      modify('docx', { entropyBefore: 7.9, entropyAfter: 8 }),
    ], enabled).map((signal) => [signal.key, signal]));
    assert.equal(signals.entropyChange.points, 0);
    assert.equal(signals.entropyChange.level, 'none');
    assert.equal(signals.entropyChange.observed.qualifyingFiles, 0);
  });

  test('any canary trigger in the window scores in full, with the activity as evidence', () => {
    const canary = entry('CANARY_TRIGGER', { fileId: 'canary', isCanary: true });
    const s = signalsOf([modify('canary', { isCanary: true }), canary]);
    assert.equal(s.canaryTrigger.level, 'full');
    assert.equal(s.canaryTrigger.points, 20);
    assert.deepEqual(s.canaryTrigger.evidence, [canary.id]);
    assert.equal(s.canaryTrigger.category, 'DECEPTION');
    assert.equal(signalsOf([modify('plain')]).canaryTrigger.points, 0);
  });
});
