import mongoose from "mongoose";

const alertSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    riskScore: { type: Number, required: true },
    riskLevel: { type: String, required: true },
    reasons: [
      {
        _id: false,
        rule: { type: String, required: true },
        points: { type: Number, required: true },
        detail: { type: String, required: true },
      },
    ],
    affectedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: "File" }],
    actionsTaken: [{ type: String }],
    status: { type: String, enum: ["open", "resolved"], default: "open" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const Alert = mongoose.model("Alert", alertSchema);
