import mongoose from "mongoose";

const fileVersionSchema = new mongoose.Schema(
  {
    file: { type: mongoose.Schema.Types.ObjectId, ref: "File", required: true, index: true },
    versionNumber: { type: Number, required: true },
    storedPath: { type: String, required: true },
    hash: { type: String, required: true },
    size: { type: Number, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isKnownSafe: { type: Boolean, default: false },
    isRestore: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const FileVersion = mongoose.model("FileVersion", fileVersionSchema);
