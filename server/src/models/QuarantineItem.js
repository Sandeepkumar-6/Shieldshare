import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.12 (+ releasedBy, releaseNote, Phase 2)
const QuarantineItemSchema = new Schema({
  fileId:     { type: ObjectId, ref: 'File', required: true, index: true },
  incidentId: { type: ObjectId, ref: 'SecurityIncident', index: true },
  versionIds: [{ type: ObjectId, ref: 'Version' }],   // versions quarantined
  reason:     { type: String, required: true },
  status:     { type: String, enum: ['QUARANTINED','RELEASED','RESTORED'], default: 'QUARANTINED', index: true },
  quarantinedBy: { type: String, enum: ['SYSTEM','ADMIN'], default: 'SYSTEM' },
  adminId:    { type: ObjectId, ref: 'User' },
  releasedAt: Date,
  releasedBy: { type: ObjectId, ref: 'User' },
  releaseNote:String,
  // Phase 3: a file deleted during an incident is quarantined too. Release returns it to
  // this status; a restore makes it ACTIVE.
  previousFileStatus: { type: String, enum: ['ACTIVE', 'DELETED'], default: 'ACTIVE' },
  restoredToVersion: Number,
}, { timestamps: true });

export const QuarantineItem = mongoose.model('QuarantineItem', QuarantineItemSchema);
