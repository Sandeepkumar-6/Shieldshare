import express from "express";
import helmet from "helmet";
import cors from "cors";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import authRoutes from "./routes/auth.js";

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error("Origin not allowed by CORS"));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.use("/api/auth", authRoutes);

  app.use(errorHandler);
  return app;
}
