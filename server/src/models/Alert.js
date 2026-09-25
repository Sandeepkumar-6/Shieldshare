import mongoose from 'mongoose';

const { Schema } = mongoose;
const { ObjectId } = Schema.Types;

// api-contract.md §3.10. Phase 3: incidentId is optional for CANARY_TRIGGERED, because a
// canary touched outside any HIGH/CRITICAL burst alerts administrators without opening an
// incident. Every other type references its incident.
const AlertSchema = new Schema({
  incidentId: {
    type: ObjectId,
    ref: 'SecurityIncident',
    index: true,
    required: function requiredUnlessCanary() { return this.type !== 'CANARY_TRIGGERED'; },
  },
  userId:     { type: ObjectId, ref: 'User' },            // subject user
  type:       { type: String, enum: ['INCIDENT_CREATED','INCIDENT_ESCALATED','CANARY_TRIGGERED','INCIDENT_RESOLVED'], required: true },
  severity:   { type: String, enum: ['INFO','SUSPICIOUS','HIGH','CRITICAL'], required: true },
  title:      { type: String, required: true },
  status:     { type: String, enum: ['UNREAD','ACKNOWLEDGED'], default: 'UNREAD', index: true },
  acknowledgedBy: { type: ObjectId, ref: 'User' },
  acknowledgedAt: Date,
}, { timestamps: true });
AlertSchema.index({ createdAt: -1 });

export const Alert = mongoose.model('Alert', AlertSchema);
