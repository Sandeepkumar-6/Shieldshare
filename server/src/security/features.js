import { extensionOf, OPERATION_ACTIONS } from './rules.engine.js';

export const ML_FEATURES = Object.freeze([
  'ops_per_min',
  'mods_per_min',
  'renames_per_min',
  'deletes_per_min',
  'dirs_affected',
  'ext_changes',
  'entropy_delta_mean',
  'entropy_delta_max',
  'hash_change_ratio',
  'mean_interarrival_ms',
]);

const round = (value, places = 6) => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

export function computeFeatures(entries, windowSeconds) {
  const operations = entries.filter((entry) => OPERATION_ACTIONS.includes(entry.action));
  const modifications = operations.filter((entry) => entry.action === 'MODIFY');
  const renames = operations.filter((entry) => entry.action === 'RENAME');
  const deletions = operations.filter((entry) => entry.action === 'DELETE');
  const minutes = Math.max(Number(windowSeconds) / 60, 1 / 60);
  const rate = (count) => round(count / minutes);

  const directories = new Set(
    operations.flatMap((entry) => [entry.directory, entry.fromDirectory]).filter(Boolean).map(String),
  );
  const extensionFiles = new Set(
    renames
      .filter((entry) => extensionOf(entry.nameBefore) !== extensionOf(entry.nameAfter))
      .map((entry) => String(entry.fileId)),
  );
  const entropyDeltas = modifications
    .filter((entry) => Number.isFinite(entry.entropyBefore) && Number.isFinite(entry.entropyAfter))
    .map((entry) => Math.max(0, entry.entropyAfter - entry.entropyBefore));

  const touched = new Set(operations.map((entry) => entry.fileId).filter(Boolean).map(String));
  const changed = new Set(
    modifications
      .filter((entry) => entry.hashBefore && entry.hashAfter && entry.hashBefore !== entry.hashAfter)
      .map((entry) => String(entry.fileId)),
  );
  const times = operations.map((entry) => new Date(entry.timestamp).getTime()).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = times.slice(1).map((time, index) => Math.max(0, time - times[index]));

  const features = {
    ops_per_min: rate(operations.length),
    mods_per_min: rate(modifications.length),
    renames_per_min: rate(renames.length),
    deletes_per_min: rate(deletions.length),
    dirs_affected: directories.size,
    ext_changes: extensionFiles.size,
    entropy_delta_mean: round(entropyDeltas.length ? entropyDeltas.reduce((sum, value) => sum + value, 0) / entropyDeltas.length : 0),
    entropy_delta_max: round(entropyDeltas.length ? Math.max(...entropyDeltas) : 0),
    hash_change_ratio: round(touched.size ? changed.size / touched.size : 0),
    mean_interarrival_ms: round(gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : 0),
  };
  return Object.fromEntries(ML_FEATURES.map((name) => [name, features[name]]));
}
