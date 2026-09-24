import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { User } from "../models/User.js";
import { createCanariesForUser } from "../services/canaryService.js";
import { auth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { HttpError } from "../utils/errors.js";
import { env } from "../config/env.js";

const router = Router();

const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(80),
    email: z.string().trim().email(),
    password: z.string().min(8).max(128),
  }),
});

const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email(),
    password: z.string().min(1),
  }),
});

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  });
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isFrozen: user.isFrozen,
    currentRiskScore: user.currentRiskScore,
  };
}

router.post("/register", authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { name, email, password } = req.body;
    const existing = await User.findOne({ email }).lean();
    if (existing) throw new HttpError(409, "Email already registered");
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, passwordHash });
    await createCanariesForUser(user._id);
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.post("/login", authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) throw new HttpError(401, "Invalid email or password");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new HttpError(401, "Invalid email or password");
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

router.get("/me", auth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

export default router;
