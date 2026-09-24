import mongoose from "mongoose";
import crypto from "node:crypto";

const shareLinkSchema = new mongoose.Schema(
  {
    file: { type: mongoose.Schema.Types.ObjectId, ref: "File", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    token: { type: String, required: true, unique: true, default: () => crypto.randomBytes(24).toString("hex") },
    permission: { type: String, enum: ["view", "download"], default: "download" },
    expiresAt: { type: Date, required: true },
    maxDownloads: { type: Number, default: null },
    downloadCount: { type: Number, default: 0 },
    isRevoked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const ShareLink = mongoose.model("ShareLink", shareLinkSchema);
