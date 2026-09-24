import mongoose from "mongoose";

const ACTIONS = ["upload", "modify", "rename", "delete", "download", "share", "restore"];

const activitySchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    file: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
    action: { type: String, enum: ACTIONS, required: true },
    directory: { type: String, default: "" },
    oldName: { type: String, default: null },
    newName: { type: String, default: null },
    oldHash: { type: String, default: null },
    newHash: { type: String, default: null },
    ip: { type: String, default: "" },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activitySchema.index({ user: 1, timestamp: -1 });

export const Activity = mongoose.model("Activity", activitySchema);
export const ACTIVITY_ACTIONS = ACTIONS;
