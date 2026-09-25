import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// An owner's explicit, file-version-specific consent for one administrator download.
// APPROVED is consumed atomically to USED, so one approval can never authorize two reads.
const FileAccessRequestSchema = new Schema({
  fileId:        { type: ObjectId, ref: 'File', required: true, index: true },
  versionId:     { type: ObjectId, ref: 'Version', required: true },
  versionNumber: { type: Number, required: true },
  ownerId:       { type: ObjectId, ref: 'User', required: true, index: true },
  adminId:       { type: ObjectId, ref: 'User', required: true, index: true },
  reason:        { type: String, required: true, maxlength: 1000 },
  status:        { type: String, enum: ['PENDING', 'APPROVED', 'DENIED', 'USED'], default: 'PENDING', index: true },
  respondedAt:   Date,
  usedAt:        Date,
}, { timestamps: true });

FileAccessRequestSchema.index({ ownerId: 1, createdAt: -1 });
FileAccessRequestSchema.index({ adminId: 1, fileId: 1, createdAt: -1 });

export const FileAccessRequest = mongoose.model('FileAccessRequest', FileAccessRequestSchema);
