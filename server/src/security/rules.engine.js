// Behavioral rules, integrity and deception signals (spec §11, §12, §14). Pure functions:
// no database, no clock, no I/O. Input is the user's sliding window (window.store.js entries),
// output is a list of signals shaped exactly like SignalSchema (api-contract §3.8).
//
// Counts are of DISTINCT files. A rule is `partial` at ≥ 50% of its threshold (half points)
// and `full` at ≥ threshold (full points).

export const OPERATION_ACTIONS = Object.freeze(['UPLOAD', 'MODIFY', 'RENAME', 'MOVE', 'DELETE']);
const EVIDENCE_LIMIT = 100;

export const round1 = (value) => Math.round(value * 10) / 10;

export function levelFor(count, threshold) {
  if (count >= threshold) return 'full';
  if (count >= threshold * 0.5) return 'partial';
  return 'none';
}

export function pointsFor(level, weight) {
  if (level === 'full') return weight;
  if (level === 'partial') return round1(weight / 2);
  return 0;
}

const LEVEL_RANK = { none: 0, partial: 1, full: 2 };
const higherLevel = (a, b) => (LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b);

// ".locked" for "report.pdf.locked", "" for "README". Case-insensitive.
export function extensionOf(name) {
  if (typeof name !== 'string') return '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot).toLowerCase() : '';
}

function distinctFiles(entries) {
  return new Set(entries.map((entry) => entry.fileId).filter(Boolean).map(String));
}

function signal({ key, category, label, level, observed, threshold, maxPoints, points, evidence }) {
  return {
    key,
    category,
    label,
    level,
    observed,
    threshold,
    points: round1(points ?? pointsFor(level, maxPoints)),
    maxPoints,
    evidence: evidence.slice(0, EVIDENCE_LIMIT).map((entry) => entry.id),
  };
}

function countRule({ key, label, entries, threshold, weight, observedKey }) {
  const files = distinctFiles(entries);
  const level = levelFor(files.size, threshold);
  return signal({
    key,
    category: 'BEHAVIOR',
    label,
    level,
    observed: { [observedKey]: files.size },
    threshold: { [observedKey]: threshold },
    maxPoints: weight,
    evidence: level === 'none' ? [] : entries,
  });
}

/**
 * @param {Array} entries window entries: { id, action, fileId, directory, fromDirectory,
 *   timestamp, isCanary, nameBefore, nameAfter, hashBefore, hashAfter }
 * @param {object} config active DetectionConfig (thresholds, weights, entropy)
 * @returns {Array} signals, in a stable order
 */
export function evaluateRules(entries, config) {
  const { thresholds: t, weights: w } = config;
  const operations = entries.filter((entry) => OPERATION_ACTIONS.includes(entry.action));
  const byAction = (action) => operations.filter((entry) => entry.action === action);
  const modifications = byAction('MODIFY');
  const renames = byAction('RENAME');
  const deletions = byAction('DELETE');

  // Rapid activity counts operations, not files.
  const rapidLevel = levelFor(operations.length, t.rapidActivity);
  const rapid = signal({
    key: 'rapidActivity',
    category: 'BEHAVIOR',
    label: 'Rapid activity',
    level: rapidLevel,
    observed: { operations: operations.length },
    threshold: { operations: t.rapidActivity },
    maxPoints: w.rapidActivity,
    evidence: rapidLevel === 'none' ? [] : operations,
  });

  const massModification = countRule({
    key: 'massModification', label: 'Mass modification', entries: modifications,
    threshold: t.massModification, weight: w.massModification, observedKey: 'files',
  });
  const massRename = countRule({
    key: 'massRename', label: 'Mass rename', entries: renames,
    threshold: t.massRename, weight: w.massRename, observedKey: 'files',
  });
  const massDelete = countRule({
    key: 'massDelete', label: 'Mass delete', entries: deletions,
    threshold: t.massDelete, weight: w.massDelete, observedKey: 'files',
  });

  // Directory spread: distinct folders written (a move writes to both folders).
  const folders = new Set(
    operations.flatMap((entry) => [entry.directory, entry.fromDirectory]).filter(Boolean).map(String),
  );
  const spreadLevel = levelFor(folders.size, t.directorySpread);
  const directorySpread = signal({
    key: 'directorySpread',
    category: 'BEHAVIOR',
    label: 'Directory spread',
    level: spreadLevel,
    observed: { folders: folders.size },
    threshold: { folders: t.directorySpread },
    maxPoints: w.directorySpread,
    evidence: spreadLevel === 'none' ? [] : operations,
  });

  // Extension changes: ≥ N renames that change the extension, or ≥ M to the same new one.
  const extensionRenames = renames.filter((entry) => extensionOf(entry.nameBefore) !== extensionOf(entry.nameAfter));
  const changedFiles = distinctFiles(extensionRenames).size;
  const byNewExtension = new Map();
  for (const entry of extensionRenames) {
    const ext = extensionOf(entry.nameAfter) || '(none)';
    if (!byNewExtension.has(ext)) byNewExtension.set(ext, new Set());
    byNewExtension.get(ext).add(String(entry.fileId));
  }
  let topExtension = null;
  let sameExtension = 0;
  for (const [ext, files] of byNewExtension) {
    if (files.size > sameExtension) {
      sameExtension = files.size;
      topExtension = ext;
    }
  }
  const extensionLevel = higherLevel(levelFor(changedFiles, t.extensionChanges), levelFor(sameExtension, t.sameExtension));
  const extensionChanges = signal({
    key: 'extensionChanges',
    category: 'BEHAVIOR',
    label: 'Extension changes',
    level: extensionLevel,
    observed: { files: changedFiles, sameExtension, extension: topExtension },
    threshold: { files: t.extensionChanges, sameExtension: t.sameExtension },
    maxPoints: w.extensionChanges,
    evidence: extensionLevel === 'none' ? [] : extensionRenames,
  });

  // Integrity (spec §12): share of touched files whose hash changed, scored only when mass
  // modification is at least partial, so one document edited repeatedly never scores.
  const touchedFiles = distinctFiles(operations).size;
  const hashChanges = modifications.filter((entry) => entry.hashBefore && entry.hashAfter && entry.hashBefore !== entry.hashAfter);
  const changedHashFiles = distinctFiles(hashChanges).size;
  const ratio = touchedFiles ? changedHashFiles / touchedFiles : 0;
  const gateMet = massModification.level !== 'none';
  const hashPoints = gateMet ? ratio * w.hashChangeRatio : 0;
  const hashChangeRatio = signal({
    key: 'hashChangeRatio',
    category: 'INTEGRITY',
    label: 'Hash-change ratio',
    level: hashPoints === 0 ? 'none' : ratio >= 0.5 ? 'full' : 'partial',
    observed: { changedFiles: changedHashFiles, touchedFiles, ratio: Math.round(ratio * 100) / 100 },
    threshold: { gate: 'Mass modification at least partial', gateMet },
    maxPoints: w.hashChangeRatio,
    points: hashPoints,
    evidence: hashPoints === 0 ? [] : hashChanges,
  });

  // Content (spec §13): score the share of distinct modified files whose low-entropy
  // baseline increased by the configured minimum. Already-compressed/high-baseline files
  // remain visible as weak evidence but do not contribute points.
  const entropyByFile = new Map();
  for (const entry of modifications) {
    if (!entry.fileId || !Number.isFinite(entry.entropyBefore) || !Number.isFinite(entry.entropyAfter)) continue;
    const delta = entry.entropyAfter - entry.entropyBefore;
    const candidate = {
      fileId: String(entry.fileId),
      name: entry.fileName,
      before: round1(entry.entropyBefore),
      after: round1(entry.entropyAfter),
      delta: round1(delta),
      highBaseline: entry.entropyBefore >= t.entropyBaselineMax,
      qualifies: entry.entropyBefore < t.entropyBaselineMax && delta >= t.entropyDeltaMin,
      entry,
    };
    const previous = entropyByFile.get(candidate.fileId);
    if (!previous || candidate.delta > previous.delta) entropyByFile.set(candidate.fileId, candidate);
  }
  const entropyFiles = [...entropyByFile.values()];
  const qualifying = entropyFiles.filter((item) => item.qualifies);
  const entropyRatio = entropyFiles.length ? qualifying.length / entropyFiles.length : 0;
  const entropyEnabled = Boolean(config.entropy?.enabled);
  const partialRatio = config.entropy?.partialRatio ?? 0.25;
  const fullRatio = config.entropy?.fullRatio ?? 0.5;
  const entropyLevel = !entropyEnabled || entropyRatio < partialRatio
    ? 'none'
    : entropyRatio >= fullRatio ? 'full' : 'partial';
  const entropyChange = signal({
    key: 'entropyChange',
    category: 'CONTENT',
    label: 'Entropy change',
    level: entropyLevel,
    observed: {
      enabled: entropyEnabled,
      qualifyingFiles: qualifying.length,
      modifiedFiles: entropyFiles.length,
      ratio: round1(entropyRatio),
      files: entropyFiles.slice(0, 20).map(({ entry, ...item }) => item),
      ...(!entropyEnabled ? { note: 'not enabled' } : {}),
    },
    threshold: {
      baselineMax: t.entropyBaselineMax,
      deltaMin: t.entropyDeltaMin,
      partialRatio,
      fullRatio,
    },
    maxPoints: w.entropyChange,
    points: entropyEnabled ? entropyRatio * w.entropyChange : 0,
    evidence: entropyEnabled ? qualifying.map((item) => item.entry) : [],
  });

  // Deception (spec §14): any canary touched in the window scores in full.
  const canaryEvents = entries.filter((entry) => entry.action === 'CANARY_TRIGGER');
  const canaryFiles = distinctFiles(canaryEvents).size;
  const canaryTrigger = signal({
    key: 'canaryTrigger',
    category: 'DECEPTION',
    label: 'Canary trigger',
    level: canaryEvents.length ? 'full' : 'none',
    observed: { canaryFiles, triggers: canaryEvents.length },
    threshold: { canaryFiles: 1 },
    maxPoints: w.canaryTrigger,
    evidence: canaryEvents,
  });

  return [
    rapid, massModification, massRename, massDelete, directorySpread, extensionChanges,
    hashChangeRatio, entropyChange, canaryTrigger,
  ];
}
