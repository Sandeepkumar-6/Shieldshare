import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.9
const TimelineEntrySchema = new Schema({
  at:     { type: Date, required: true },
  type:   { type: String, required: true },  // 'ACTIVITY_BURST','RULE_FIRED','CANARY','ML','RISK','FREEZE','QUARANTINE','STATUS','RESTORE','VERIFY'
  text:   { type: String, required: true },  // "Mass rename detected (14 files)"
  ref:    { kind: String, id: ObjectId },     // link to Activity / RiskEvaluation / Version
  actor:  { type: String, enum: ['SYSTEM','ADMIN'], default: 'SYSTEM' },
  adminId:{ type: ObjectId, ref: 'User' },
}, { _id: false });

export const ACTIVE_INCIDENT_STATUSES = Object.freeze(['OPEN', 'CONTAINED', 'INVESTIGATING']);

const SecurityIncidentSchema = new Schema({
  incidentNumber: { type: String, required: true, unique: true },   // "SH-1042"
  userId:         { type: ObjectId, ref: 'User', required: true, index: true },
  status:         { type: String, enum: ['OPEN','CONTAINED','INVESTIGATING','RECOVERED','RESOLVED','FALSE_POSITIVE'], default: 'OPEN', index: true },
  riskScore:      { type: Number, required: true },   // peak
  severity:       { type: String, enum: ['HIGH','CRITICAL'], required: true },
  trigger:        String,                              // top signal label
  signals:        [String],                            // signal keys that fired
  latestEvaluationId: { type: ObjectId, ref: 'RiskEvaluation' },
  peakEvaluationId:   { type: ObjectId, ref: 'RiskEvaluation' },
  windowStart:    { type: Date, required: true },
  windowEnd:      Date,
  affectedFiles:  [{ type: ObjectId, ref: 'File' }],
  affectedDirectories: [{ type: ObjectId, ref: 'Folder' }],
  canaryTriggered:{ type: Boolean, default: false },
  freezeStatus:   { type: String, enum: ['NONE','FROZEN','UNFROZEN'], default: 'NONE' },
  quarantineStatus:{ type: String, enum: ['NONE','PARTIAL','QUARANTINED','RELEASED','RESTORED'], default: 'NONE' },
  timeline:       [TimelineEntrySchema],
  assignedTo:     { type: ObjectId, ref: 'User' },
  resolution:     { type: String, enum: ['RESOLVED','FALSE_POSITIVE'] },
  resolutionNote: String,
  resolvedBy:     { type: ObjectId, ref: 'User' },
  resolvedAt:     Date,
}, { timestamps: true });
SecurityIncidentSchema.index({ createdAt: -1 });

export const SecurityIncident = mongoose.model('SecurityIncident', SecurityIncidentSchema);
