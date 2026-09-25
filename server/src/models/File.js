import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.4
const FileSchema = new Schema({
  ownerId:        { type: ObjectId, ref: 'User', required: true, index: true },
  folderId:       { type: ObjectId, ref: 'Folder', required: true, index: true },
  name:           { type: String, required: true, maxlength: 255 },
  storageKey:     { type: String, required: true, select: false }, // current blob; never sent to clients
  size:           { type: Number, required: true },
  mimeType:       String,
  currentVersion: { type: Number, default: 1 },
  sha256:         { type: String, required: true },
  entropy:        Number,                                     // bits/byte, 0–8
  status:         { type: String, enum: ['ACTIVE', 'QUARANTINED', 'DELETED'], default: 'ACTIVE', index: true },
  isCanary:       { type: Boolean, default: false, index: true },
  canaryTemplate: String,
  lastVerifiedAt: Date,
  deletedAt:      Date,
  quarantinedAt:  Date,
}, { timestamps: true });
FileSchema.index({ ownerId: 1, status: 1, isCanary: 1 });

// Named FileModel in code to avoid shadowing the global File (Blob) class.
export const FileModel = mongoose.model('File', FileSchema);
