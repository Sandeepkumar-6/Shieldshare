import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.8 (+ reasons, Phase 3)
const SignalSchema = new Schema({
  key:        { type: String, required: true },   // 'massRename', 'canaryTrigger', ...
  category:   { type: String, enum: ['BEHAVIOR','INTEGRITY','CONTENT','DECEPTION','ANOMALY'], required: true },
  label:      { type: String, required: true },   // "Mass rename"
  level:      { type: String, enum: ['none','partial','full'], default: 'none' },
  observed:   Schema.Types.Mixed,                 // e.g. { renames: 14 }
  threshold:  Schema.Types.Mixed,                 // e.g. { renames: 8 }
  points:     { type: Number, required: true },
  maxPoints:  Number,
  evidence:   [{ type: ObjectId, ref: 'Activity' }],
}, { _id: false });

const RiskEvaluationSchema = new Schema({
  userId:        { type: ObjectId, ref: 'User', required: true, index: true },
  incidentId:    { type: ObjectId, ref: 'SecurityIncident', index: true },
  windowStart:   { type: Date, required: true },
  windowEnd:     { type: Date, required: true },
  rawScore:      Number,
  score:         { type: Number, required: true, min: 0, max: 100 },
  severity:      { type: String, enum: ['SAFE','SUSPICIOUS','HIGH','CRITICAL'], required: true },
  categories:    [String],
  capApplied:    { type: Boolean, default: false },
  // Why the score or severity differs from the plain sum, e.g. "single-category cap applied".
  reasons:       [String],
  signals:       [SignalSchema],
  ml: {
    status:       { type: String, enum: ['OK','UNAVAILABLE','DISABLED','PENDING'] },
    anomalyScore: Number,
    isAnomaly:    Boolean,
    features:     Schema.Types.Mixed,
    modelVersion: String,
  },
  configVersion: { type: Number, required: true },
  phase:         { type: String, enum: ['INLINE','WITH_ML'], required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });
RiskEvaluationSchema.index({ createdAt: -1 });

export const RiskEvaluation = mongoose.model('RiskEvaluation', RiskEvaluationSchema);
