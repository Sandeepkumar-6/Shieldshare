import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.13. Append-only: nothing in the codebase updates or deletes entries,
// and no route exposes an update or delete.
const AdminAuditLogSchema = new Schema({
  adminId:  { type: ObjectId, ref: 'User', required: true, index: true },
  action:   { type: String, required: true },   // 'FREEZE_USER','REQUEST_FILE_ACCESS','FORENSIC_DOWNLOAD',...
  target:   { kind: String, id: ObjectId },
  via:      { type: String, enum: ['UI','SHIELD_AI'], default: 'UI' },
  pendingActionId: { type: ObjectId, ref: 'PendingAction' },
  before:   Schema.Types.Mixed,
  after:    Schema.Types.Mixed,
  note:     String,
  ip:       String,
  result:   { type: String, enum: ['SUCCESS','FAILURE'], required: true },
  error:    String,
}, { timestamps: { createdAt: true, updatedAt: false } });
AdminAuditLogSchema.index({ createdAt: -1 });

export const AdminAuditLog = mongoose.model('AdminAuditLog', AdminAuditLogSchema);
