import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.2
const SessionSchema = new Schema({
  userId:     { type: ObjectId, ref: 'User', required: true, index: true },
  status:     { type: String, enum: ['ACTIVE', 'REVOKED', 'EXPIRED'], default: 'ACTIVE' },
  ip:         String,
  userAgent:  String,
  lastSeenAt: Date,
  expiresAt:  { type: Date, required: true },
  revokedAt:  Date,
  revokedReason: { type: String, enum: ['LOGOUT', 'USER', 'ADMIN', 'FREEZE_SIGNOUT'] },
}, { timestamps: true });
SessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const Session = mongoose.model('Session', SessionSchema);
