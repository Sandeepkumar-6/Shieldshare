// DetectionConfig fields for the settings editor (Phase 6). Ranges mirror the server's
// validation (routes/admin.routes.js detectionConfigBody + config.service assertConsistent),
// so most mistakes are caught before saving; the server remains the authority.

export const RULES = [
  { key: 'rapidActivity', label: 'Rapid activity', unit: 'write operations' },
  { key: 'massModification', label: 'Mass modification', unit: 'distinct files modified' },
  { key: 'massRename', label: 'Mass rename', unit: 'distinct files renamed' },
  { key: 'massDelete', label: 'Mass delete', unit: 'distinct files deleted' },
  { key: 'directorySpread', label: 'Directory spread', unit: 'distinct folders written' },
  { key: 'extensionChanges', label: 'Extension changes', unit: 'files changing extension' },
];

const int = (min, max) => ({ kind: 'int', min, max });
const num = (min, max, { exclusiveMin = false } = {}) => ({ kind: 'number', min, max, exclusiveMin });
const bool = () => ({ kind: 'bool' });

export const FIELDS = [
  { path: 'windowSeconds', label: 'Sliding window (seconds)', ...int(10, 3600) },
  ...RULES.flatMap((rule) => [
    { path: `thresholds.${rule.key}`, label: `${rule.label} threshold`, ...int(1) },
    { path: `weights.${rule.key}`, label: `${rule.label} weight`, ...num(0, 50) },
  ]),
  { path: 'thresholds.sameExtension', label: 'Same new extension threshold', ...int(1) },
  { path: 'weights.hashChangeRatio', label: 'Hash-change ratio weight', ...num(0, 50) },
  { path: 'weights.canaryTrigger', label: 'Canary trigger weight', ...num(0, 50) },
  { path: 'entropy.enabled', label: 'Entropy signal enabled', ...bool() },
  { path: 'weights.entropyChange', label: 'Entropy change weight', ...num(0, 50) },
  { path: 'thresholds.entropyBaselineMax', label: 'Entropy baseline maximum (bits/byte)', ...num(0, 8, { exclusiveMin: true }) },
  { path: 'thresholds.entropyDeltaMin', label: 'Entropy minimum increase (bits/byte)', ...num(0, 8, { exclusiveMin: true }) },
  { path: 'entropy.partialRatio', label: 'Entropy partial at (share of modified files)', ...num(0, 1, { exclusiveMin: true }) },
  { path: 'entropy.fullRatio', label: 'Entropy full at (share of modified files)', ...num(0, 1, { exclusiveMin: true }) },
  { path: 'ml.enabled', label: 'ML anomaly signal enabled', ...bool() },
  { path: 'weights.mlAnomaly', label: 'ML anomaly weight', ...num(0, 50) },
  { path: 'ml.timeoutMs', label: 'ML service timeout (ms)', ...int(100, 10000) },
  { path: 'ml.minOperations', label: 'ML minimum operations (SAFE windows)', ...int(1, 1000) },
  { path: 'severityBands.suspicious', label: 'Suspicious from', ...num(0, 100, { exclusiveMin: true }) },
  { path: 'severityBands.high', label: 'High from', ...num(0, 100, { exclusiveMin: true }) },
  { path: 'severityBands.critical', label: 'Critical from', ...num(0, 100, { exclusiveMin: true }) },
  { path: 'minCategoriesForCritical', label: 'Signal categories needed for Critical', ...int(1, 5) },
];

export const FIELD_BY_PATH = Object.fromEntries(FIELDS.map((field) => [field.path, field]));

export function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (const key of keys.slice(0, -1)) target = (target[key] ??= {});
  target[keys.at(-1)] = value;
}

// Form state: every field as the input shows it (strings for numbers, booleans for toggles).
export function toDraft(config) {
  return Object.fromEntries(FIELDS.map((field) => {
    const value = getPath(config, field.path);
    return [field.path, field.kind === 'bool' ? Boolean(value) : String(value ?? '')];
  }));
}

function parse(field, raw) {
  if (field.kind === 'bool') return Boolean(raw);
  if (typeof raw === 'string' && raw.trim() === '') return Number.NaN;
  return Number(raw);
}

// { errors: { path: message }, values: { path: parsedValue } }
export function validateDraft(draft) {
  const errors = {};
  const values = {};
  for (const field of FIELDS) {
    const value = parse(field, draft[field.path]);
    values[field.path] = value;
    if (field.kind === 'bool') continue;
    if (!Number.isFinite(value)) errors[field.path] = 'Enter a number.';
    else if (field.kind === 'int' && !Number.isInteger(value)) errors[field.path] = 'Use a whole number.';
    else if (field.exclusiveMin ? value <= field.min : value < field.min) errors[field.path] = field.exclusiveMin ? `Must be above ${field.min}.` : `At least ${field.min}.`;
    else if (field.max != null && value > field.max) errors[field.path] = `At most ${field.max}.`;
  }
  const bands = ['suspicious', 'high', 'critical'].map((key) => values[`severityBands.${key}`]);
  if (bands.every(Number.isFinite) && !(bands[0] < bands[1] && bands[1] < bands[2])) {
    errors['severityBands.critical'] ??= 'Bands must ascend: suspicious < high < critical.';
  }
  const [partial, full] = [values['entropy.partialRatio'], values['entropy.fullRatio']];
  if (Number.isFinite(partial) && Number.isFinite(full) && !(partial < full)) {
    errors['entropy.fullRatio'] ??= 'Full must be above partial.';
  }
  return { errors, values };
}

// Changed fields between two configs (or a config and parsed draft values keyed by path).
export function diff(before, after, { afterIsFlat = false } = {}) {
  return FIELDS
    .map((field) => ({
      field,
      before: getPath(before, field.path),
      after: afterIsFlat ? after[field.path] : getPath(after, field.path),
    }))
    .filter((change) => change.before !== change.after && !(Number.isNaN(change.after)));
}

// The PUT body: only the changed fields, nested (the server merges them into the active config).
export function toPatch(changes) {
  const patch = {};
  for (const change of changes) setPath(patch, change.field.path, change.after);
  return patch;
}

export function formatValue(field, value) {
  if (field.kind === 'bool') return value ? 'on' : 'off';
  return String(value);
}
