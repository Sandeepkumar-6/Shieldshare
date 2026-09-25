import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.1
const UserSchema = new Schema({
  name:          { type: String, required: true, trim: true, maxlength: 100 },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash:  { type: String, required: true, select: false },
  role:          { type: String, enum: ['user', 'admin'], default: 'user' },
  status:        { type: String, enum: ['ACTIVE', 'FROZEN', 'DISABLED'], default: 'ACTIVE', index: true },
  securityStatus:{ type: String, enum: ['SAFE', 'SUSPICIOUS', 'HIGH', 'CRITICAL'], default: 'SAFE' },
  tokenVersion:  { type: Number, default: 0, select: false },
  frozenAt:      Date,
  frozenReason:  String,
  frozenByIncidentId: { type: ObjectId, ref: 'SecurityIncident' },
  isDemoUser:    { type: Boolean, default: false },
}, { timestamps: true });

export const User = mongoose.model('User', UserSchema);
