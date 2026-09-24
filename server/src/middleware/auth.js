import jwt from "jsonwebtoken";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { HttpError } from "../utils/errors.js";

export async function auth(req, _res, next) {
  try {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) throw new HttpError(401, "Authentication required");
    const payload = jwt.verify(token, env.jwtSecret);
    const user = await User.findById(payload.sub).lean();
    if (!user) throw new HttpError(401, "User no longer exists");
    req.user = user;
    next();
  } catch (err) {
    next(err instanceof HttpError ? err : new HttpError(401, "Invalid or expired token"));
  }
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(new HttpError(403, "You do not have permission to do this"));
    }
    next();
  };
}
