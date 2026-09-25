import { DetectionConfig } from '../models/index.js';
import { errors } from '../utils/AppError.js';

// Detection configuration (spec §11 thresholds, §16 weights and bands). The active version is
// cached in memory and reloaded whenever it changes. A single server process is assumed; with
// several processes each would need to reload on change (Phase 4 can broadcast it).

export const DEFAULT_DETECTION_CONFIG = Object.freeze({
  windowSeconds: 60,
  thresholds: {
    rapidActivity: 30,
    massModification: 10,
    massRename: 8,
    massDelete: 8,
    directorySpread: 3,
    extensionChanges: 5,
    sameExtension: 3,
    entropyBaselineMax: 6.0,
    entropyDeltaMin: 1.5,
  },
  weights: {
    rapidActivity: 15,
    massModification: 20,
    massRename: 15,
    massDelete: 15,
    directorySpread: 10,
    extensionChanges: 15,
    hashChangeRatio: 10,
    entropyChange: 10,
    canaryTrigger: 20,
    mlAnomaly: 10,
  },
  severityBands: { suspicious: 30, high: 60, critical: 80 },
  minCategoriesForCritical: 2,
  entropy: { enabled: false, partialRatio: 0.25, fullRatio: 0.5 },
  ml: { enabled: true, timeoutMs: 1500, minOperations: 10 },
});

let cached = null;
const listeners = new Set();

function plain(doc) {
  return {
    id: String(doc._id),
    version: doc.version,
    windowSeconds: doc.windowSeconds,
    thresholds: { ...DEFAULT_DETECTION_CONFIG.thresholds, ...doc.thresholds },
    weights: { ...DEFAULT_DETECTION_CONFIG.weights, ...doc.weights },
    severityBands: { ...DEFAULT_DETECTION_CONFIG.severityBands, ...doc.severityBands },
    minCategoriesForCritical: doc.minCategoriesForCritical,
    entropy: {
      enabled: Boolean(doc.entropy?.enabled),
      partialRatio: doc.entropy?.partialRatio ?? 0.25,
      fullRatio: doc.entropy?.fullRatio ?? 0.5,
    },
    ml: {
      enabled: doc.ml?.enabled ?? true,
      timeoutMs: doc.ml?.timeoutMs ?? 1500,
      minOperations: doc.ml?.minOperations ?? 10,
    },
    createdBy: doc.createdBy ? String(doc.createdBy) : null,
    createdAt: doc.createdAt,
  };
}

// Loads the active config, creating version 1 with the spec defaults on first start.
export async function ensureActiveConfig() {
  let active = await DetectionConfig.findOne({ isActive: true }).lean();
  if (!active) {
    const latest = await DetectionConfig.findOne().sort({ version: -1 }).lean();
    if (latest) {
      await DetectionConfig.updateOne({ _id: latest._id }, { $set: { isActive: true } });
      active = { ...latest, isActive: true };
    } else {
      try {
        active = (await DetectionConfig.create({ ...DEFAULT_DETECTION_CONFIG, version: 1, isActive: true })).toObject();
      } catch (error) {
        if (error?.code !== 11000) throw error;
        active = await DetectionConfig.findOne({ version: 1 }).lean(); // created concurrently
      }
    }
  }
  // Phase 5a migration: preserve the previous active configuration as history and create
  // one new version that enables entropy. A later administrator can disable it without the
  // next restart turning it back on because the enabled version remains in history.
  const entropyWasIntroduced = await DetectionConfig.exists({ 'entropy.enabled': true });
  if (!entropyWasIntroduced) {
    const latest = await DetectionConfig.findOne().sort({ version: -1 }).lean();
    const migrated = await DetectionConfig.create({
      ...plain(active),
      _id: undefined,
      id: undefined,
      version: (latest?.version ?? active.version) + 1,
      isActive: true,
      entropy: { enabled: true, partialRatio: 0.25, fullRatio: 0.5 },
    });
    await DetectionConfig.updateMany({ _id: { $ne: migrated._id }, isActive: true }, { $set: { isActive: false } });
    active = migrated.toObject();
  }
  cached = plain(active);
  return cached;
}

export async function activeConfig() {
  return cached ?? ensureActiveConfig();
}

export function onConfigChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch ?? {})) {
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? deepMerge(base[key] ?? {}, value) : value;
  }
  return out;
}

// Cross-field rules zod cannot express on its own.
function assertConsistent(config) {
  const { suspicious, high, critical } = config.severityBands;
  if (!(suspicious > 0 && suspicious < high && high < critical && critical <= 100)) {
    throw errors.validation('Severity bands must ascend: 0 < suspicious < high < critical ≤ 100.');
  }
  const { partialRatio, fullRatio } = config.entropy;
  if (!(partialRatio > 0 && partialRatio < fullRatio && fullRatio <= 1)) {
    throw errors.validation('Entropy levels must ascend: 0 < partialRatio < fullRatio ≤ 1.');
  }
}

// PUT semantics over a partial body: fields not provided keep their current value. Always
// creates a new version; old versions are kept for reproducibility.
export async function updateConfig(patch, adminId) {
  const current = await activeConfig();
  const merged = deepMerge(
    {
      windowSeconds: current.windowSeconds,
      thresholds: current.thresholds,
      weights: current.weights,
      severityBands: current.severityBands,
      minCategoriesForCritical: current.minCategoriesForCritical,
      entropy: current.entropy,
      ml: current.ml,
    },
    patch,
  );
  assertConsistent(merged);

  const latest = await DetectionConfig.findOne().sort({ version: -1 }).lean();
  const next = await DetectionConfig.create({ ...merged, version: (latest?.version ?? 0) + 1, isActive: false, createdBy: adminId });
  await DetectionConfig.updateMany({ _id: { $ne: next._id }, isActive: true }, { $set: { isActive: false } });
  await DetectionConfig.updateOne({ _id: next._id }, { $set: { isActive: true } });

  const before = current;
  cached = plain({ ...next.toObject(), isActive: true });
  for (const listener of listeners) {
    try {
      await listener(cached, before);
    } catch (error) {
      console.error('[detection-config] listener failed', error.message);
    }
  }
  return { before, after: cached };
}

// Test support: forget the cache so the next call reloads from the database.
// Every version, newest first (Phase 6 settings editor). Versions are immutable, so stored
// RiskEvaluations stay reproducible from their configVersion.
export async function listVersions({ limit = 50 } = {}) {
  const docs = await DetectionConfig.find().sort({ version: -1 }).limit(limit).lean();
  return docs.map((doc) => ({ ...plain(doc), isActive: Boolean(doc.isActive) }));
}

export function resetConfigCache() {
  cached = null;
}
