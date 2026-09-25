import mongoose from 'mongoose';

const { Schema } = mongoose;

const AIMessageSchema = new Schema({
  role: { type: String, enum: ['user', 'assistant', 'tool'], required: true },
  content: String,
  toolCalls: [{ name: String, args: Schema.Types.Mixed, status: String }],
  toolName: String,
  toolResult: Schema.Types.Mixed,
  toolRuns: [{ name: String, status: String, label: String }],
  blocks: [Schema.Types.Mixed],
  citations: [Schema.Types.Mixed],
  pendingActionId: { type: Schema.Types.ObjectId, ref: 'PendingAction' },
  at: { type: Date, default: Date.now },
}, { _id: true });

// api-contract §3.15. Conversations belong to one person and one audience: `admin` (Shield
// AI, security tools and action proposals) or `user` (the member assistant, own-data tools
// only). Conversations created before the member assistant have only `adminId`; they are
// read as admin conversations of that administrator.
const AIConversationSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  audience: { type: String, enum: ['admin', 'user'], default: 'admin' },
  adminId: { type: Schema.Types.ObjectId, ref: 'User', index: true }, // admin conversations (and legacy ones)
  title: { type: String, maxlength: 120 },
  context: {
    incidentId: { type: Schema.Types.ObjectId, ref: 'SecurityIncident' },
    fileId: { type: Schema.Types.ObjectId, ref: 'File' },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    page: { type: String, maxlength: 40 },
  },
  messages: [AIMessageSchema],
}, { timestamps: true });
AIConversationSchema.index({ adminId: 1, updatedAt: -1 });
AIConversationSchema.index({ ownerId: 1, audience: 1, updatedAt: -1 });

export const AIConversation = mongoose.model('AIConversation', AIConversationSchema);
