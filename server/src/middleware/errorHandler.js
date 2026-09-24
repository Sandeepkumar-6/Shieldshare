import { env } from "../config/env.js";

export function errorHandler(err, _req, res, _next) {
  // Mongoose duplicate key / validation / cast errors
  if (err.code === 11000) {
    err.status = 409;
    err.message = "Duplicate value (email already registered?)";
  }
  if (err.name === "ValidationError") {
    err.status = 400;
    err.message = Object.values(err.errors).map((e) => e.message).join("; ");
  }
  if (err.name === "CastError") {
    err.status = 400;
    err.message = "Invalid id format";
  }

  const status = err.status ?? 500;
  const body = {
    error: err.status ? err.message : "Internal server error",
  };
  if (err.details) body.details = err.details;
  if (!env.isProd && status >= 500) {
    console.error("[errorHandler]", err);
  }
  res.status(status).json(body);
}
