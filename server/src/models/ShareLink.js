import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.11 (+ suspendedByQuarantineId, Phase 2)
const ShareLinkSchema = new Schema({
  fileId:        { type: ObjectId, ref: 'File', required: true, index: true },
  createdBy:     { type: ObjectId, ref: 'User', required: true },
  tokenHash:     { type: String, required: true, unique: true, select: false },
  permission:    { type: String, enum: ['VIEW','DOWNLOAD'], required: true },
  recipientLabel:{ type: String, maxlength: 254 },          // display only, not access control
  passwordHash:  { type: String, select: false },
  expiresAt:     { type: Date, required: true },
  status:        { type: String, enum: ['ACTIVE','REVOKED','EXPIRED','SUSPENDED'], default: 'ACTIVE' },
  suspendedByIncidentId: { type: ObjectId, ref: 'SecurityIncident' },
  // The quarantine that suspended this link; release reactivates only these links.
  suspendedByQuarantineId: { type: ObjectId, ref: 'QuarantineItem', index: true },
  accessCount:   { type: Number, default: 0 },
  lastAccessedAt:Date,
  revokedAt:     Date,
}, { timestamps: true });
ShareLinkSchema.index({ createdBy: 1, createdAt: -1 });

export const ShareLink = mongoose.model('ShareLink', ShareLinkSchema);
