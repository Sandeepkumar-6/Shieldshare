import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.3
const FolderSchema = new Schema({
  ownerId:  { type: ObjectId, ref: 'User', required: true, index: true },
  name:     { type: String, required: true, trim: true, maxlength: 120 },
  isRoot:   { type: Boolean, default: false },
}, { timestamps: true });
FolderSchema.index({ ownerId: 1, name: 1 }, { unique: true });

export const Folder = mongoose.model('Folder', FolderSchema);
