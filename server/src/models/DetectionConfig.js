import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.7 (+ entropy.enabled, Phase 3). Versioned: every change creates a new
// document and exactly one is active. Old versions are kept so stored RiskEvaluations stay
// reproducible (they record configVersion).
const DetectionConfigSchema = new Schema({
  version:   { type: Number, required: true, unique: true },
  isActive:  { type: Boolean, default: false, index: true },
  windowSeconds: { type: Number, default: 60 },
  thresholds: {
    rapidActivity:     { type: Number, default: 30 },
    massModification:  { type: Number, default: 10 },
    massRename:        { type: Number, default: 8 },
    massDelete:        { type: Number, default: 8 },
    directorySpread:   { type: Number, default: 3 },
    extensionChanges:  { type: Number, default: 5 },
    sameExtension:     { type: Number, default: 3 },
    entropyBaselineMax:{ type: Number, default: 6.0 },
    entropyDeltaMin:   { type: Number, default: 1.5 },
  },
  weights: {
    rapidActivity: { type: Number, default: 15 }, massModification: { type: Number, default: 20 },
    massRename:    { type: Number, default: 15 }, massDelete:       { type: Number, default: 15 },
    directorySpread:{ type: Number, default: 10 }, extensionChanges: { type: Number, default: 15 },
    hashChangeRatio:{ type: Number, default: 10 }, entropyChange:    { type: Number, default: 10 },
    canaryTrigger: { type: Number, default: 20 }, mlAnomaly:        { type: Number, default: 10 },
  },
  severityBands: { suspicious: { type: Number, default: 30 }, high: { type: Number, default: 60 }, critical: { type: Number, default: 80 } },
  minCategoriesForCritical: { type: Number, default: 2 },
  entropy: {
    enabled: { type: Boolean, default: false },
    partialRatio: { type: Number, default: 0.25 },
    fullRatio: { type: Number, default: 0.5 },
  },
  ml: {
    enabled: { type: Boolean, default: true },
    timeoutMs: { type: Number, default: 1500 },
    minOperations: { type: Number, default: 10 },
  },
  createdBy: { type: ObjectId, ref: 'User' },
}, { timestamps: true });

export const DetectionConfig = mongoose.model('DetectionConfig', DetectionConfigSchema);
