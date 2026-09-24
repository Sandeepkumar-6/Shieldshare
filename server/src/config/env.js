import "dotenv/config";

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var: ${name}`);
  return v;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(required("PORT", 4000)),
  mongoUri: required("MONGO_URI", "mongodb://localhost:27017/shieldshare"),
  jwtSecret: required("JWT_SECRET", "dev-only-secret-change-me"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:5173").split(",").map((s) => s.trim()),
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB ?? 10),
  enableSimulation: (process.env.ENABLE_SIMULATION ?? "false") === "true",
  isProd: (process.env.NODE_ENV ?? "development") === "production",
};
