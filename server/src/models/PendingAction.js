import mongoose from 'mongoose';

const { Schema } = mongoose;

const PendingActionSchema = new Schema({
  adminId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  conversationId: { type: Schema.Types.ObjectId, ref: 'AIConversation', required: true, index: true },
  tool: { type: String, enum: ['freezeUser', 'unfreezeUser', 'quarantineFile', 'restoreVersion'], required: true },
  args: { type: Schema.Types.Mixed, required: true },
  summary: { title: String, target: String, from: String, to: String, consequence: String },
  status: { type: String, enum: ['PROPOSED', 'EXECUTED', 'CANCELLED', 'EXPIRED', 'FAILED'], default: 'PROPOSED', index: true },
  expiresAt: { type: Date, required: true, index: true },
  executedAt: Date,
  result: Schema.Types.Mixed,
}, { timestamps: true });

export const PendingAction = mongoose.model('PendingAction', PendingActionSchema);
