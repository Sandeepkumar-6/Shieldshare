import mongoose from "mongoose";

// Single document holding all tunable risk-engine parameters.
const riskConfigSchema = new mongoose.Schema(
  {
    key: { type: String, default: "default", unique: true },
    rules: {
      mass_modification: { minCount: { type: Number, default: 20 }, windowSeconds: { type: Number, default: 60 }, points: { type: Number, default: 30 } },
      high_velocity: { minCount: { type: Number, default: 30 }, windowSeconds: { type: Number, default: 10 }, points: { type: Number, default: 20 } },
      multi_directory: { minDirs: { type: Number, default: 3 }, windowSeconds: { type: Number, default: 60 }, points: { type: Number, default: 15 } },
      mass_rename_delete: {
        minRenameDelete: { type: Number, default: 10 },
        minExtensionChanges: { type: Number, default: 5 },
        windowSeconds: { type: Number, default: 60 },
        points: { type: Number, default: 20 },
      },
      canary_touched: { points: { type: Number, default: 15 } },
      integrity_anomaly: { points: { type: Number, default: 10 } },
      baseline_deviation: { multiplier: { type: Number, default: 3 }, defaultBaselinePerHour: { type: Number, default: 10 }, points: { type: Number, default: 10 } },
    },
    containmentLevel: { type: String, enum: ["SUSPICIOUS", "HIGH", "CRITICAL"], default: "HIGH" },
    defaultBaselinePerHour: { type: Number, default: 10 },
  },
  { timestamps: true }
);

export const RiskConfig = mongoose.model("RiskConfig", riskConfigSchema);

export async function getRiskConfig() {
  let cfg = await RiskConfig.findOne({ key: "default" });
  if (!cfg) cfg = await RiskConfig.create({ key: "default" });
  return cfg;
}
