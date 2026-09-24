import mongoose from "mongoose";

const riskSnapshotSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    score: { type: Number, required: true },
    level: { type: String, required: true, enum: ["SAFE", "SUSPICIOUS", "HIGH", "CRITICAL"] },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

riskSnapshotSchema.index({ user: 1, timestamp: -1 });

export const RiskSnapshot = mongoose.model("RiskSnapshot", riskSnapshotSchema);
