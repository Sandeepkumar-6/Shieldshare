import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "user"], default: "user" },
    isFrozen: { type: Boolean, default: false },
    frozenAt: { type: Date, default: null },
    currentRiskScore: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const User = mongoose.model("User", userSchema);
