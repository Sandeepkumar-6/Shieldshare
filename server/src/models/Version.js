import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.5
const VersionSchema = new Schema({
  fileId:         { type: ObjectId, ref: 'File', required: true },
  versionNumber:  { type: Number, required: true },
  storageKey:     { type: String, required: true, select: false },
  nameAtVersion:  { type: String, required: true },
  size:           Number,
  sha256:         { type: String, required: true },
  entropy:        Number,
  createdBy:      { type: ObjectId, ref: 'User', required: true },
  source:         { type: String, enum: ['UPLOAD', 'MODIFY', 'RESTORE'], required: true },
  restoredFromVersion: Number,
  securityStatus: { type: String, enum: ['SAFE', 'SUSPICIOUS', 'QUARANTINED', 'RESTORED'], default: 'SAFE' },
  incidentId:     { type: ObjectId, ref: 'SecurityIncident' },
}, { timestamps: { createdAt: true, updatedAt: false } });
VersionSchema.index({ fileId: 1, versionNumber: 1 }, { unique: true });

export const Version = mongoose.model('Version', VersionSchema);
