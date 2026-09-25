import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

export const ACTIVITY_ACTIONS = Object.freeze([
  'LOGIN', 'LOGOUT', 'UPLOAD', 'DOWNLOAD', 'MODIFY', 'RENAME', 'MOVE', 'DELETE',
  'SHARE', 'SHARE_REVOKE', 'SHARE_ACCESS', 'RESTORE', 'QUARANTINE', 'QUARANTINE_RELEASE',
  'FREEZE', 'UNFREEZE', 'CANARY_TRIGGER', 'INTEGRITY_CHANGE',
  'ADMIN_FORENSIC_ACCESS',
]);

// api-contract.md §3.6
const ActivitySchema = new Schema({
  userId:    { type: ObjectId, ref: 'User', index: true },    // null for public share access
  sessionId: { type: ObjectId, ref: 'Session' },
  fileId:    { type: ObjectId, ref: 'File', index: true },
  action:    { type: String, required: true, enum: ACTIVITY_ACTIONS },
  timestamp: { type: Date, default: Date.now, index: true },
  ip:        String,
  directory: { type: ObjectId, ref: 'Folder' },
  isCanary:  { type: Boolean, default: false },
  hashBefore: String,  hashAfter: String,
  entropyBefore: Number, entropyAfter: Number,
  sizeBefore: Number,  sizeAfter: Number,
  nameBefore: String,  nameAfter: String,
  metadata:  Schema.Types.Mixed,
  // Phase 4: the risk level the evaluation after this operation produced (set by detection on
  // the operation's own events, SAFE included). Absent = not scored.
  riskSeverity: { type: String, enum: ['SAFE', 'SUSPICIOUS', 'HIGH', 'CRITICAL'] },
}, { timestamps: false });
ActivitySchema.index({ userId: 1, timestamp: -1 });
// Phase 4: global feed filtered by action, analytics grouped over a time range.
ActivitySchema.index({ action: 1, timestamp: -1 });

export const Activity = mongoose.model('Activity', ActivitySchema);
