import mongoose from "mongoose";

const fileSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    originalName: { type: String, required: true },
    storedName: { type: String, required: true, unique: true },
    path: { type: String, required: true },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    currentHash: { type: String, required: true },
    currentVersion: { type: Number, default: 1 },
    isCanary: { type: Boolean, default: false },
    status: { type: String, enum: ["active", "quarantined", "deleted"], default: "active", index: true },
    directory: { type: String, default: "My Files", index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

fileSchema.index({ owner: 1, directory: 1, status: 1 });

export const File = mongoose.model("File", fileSchema);
