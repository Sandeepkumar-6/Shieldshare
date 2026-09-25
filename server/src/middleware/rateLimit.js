import crypto from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { config } from '../config/env.js';
import { AppError } from '../utils/AppError.js';

// Limits are per client IP. Values are Phase 1 defaults (the spec requires rate limiting
// but sets no numbers). They sit well above what a person clicking through the UI produces.

function limiter({ windowMs, limit, message, ...rest }) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next) => next(new AppError(429, 'RATE_LIMITED', message)),
    ...rest,
  });
}

export const apiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: config.apiRateLimitPerMinute,
  message: 'Too many requests. Wait a moment and try again.',
});

export const aiLimiter = limiter({
  windowMs: 60 * 1000,
  limit: config.ai.rateLimitPerMinute,
  message: 'Too many Shield AI requests. Wait a moment and try again.',
});

// Only failed sign-ins count, so a person who signs in successfully is never locked out.
export const loginLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: 'Too many failed sign-in attempts. Try again in 15 minutes.',
});

export const registerLimiter = limiter({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  message: 'Too many accounts created from this network. Try again later.',
});

// ── Public share links (/s/*), no authentication ───────────────────────────────────────

export const publicShareLimiter = limiter({
  windowMs: 60 * 1000,
  limit: 60,
  message: 'Too many requests. Wait a moment and try again.',
});

// Failed password attempts, per link and client IP. The key uses a hash of the URL token so
// raw tokens are never held in the limiter's memory.
export const shareUnlockPerLinkLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}|${crypto.createHash('sha256').update(String(req.params.token)).digest('hex').slice(0, 32)}`,
  message: 'Too many incorrect passwords for this link. Try again in 15 minutes.',
});

// Failed password attempts per IP across all links (guessing many links at once).
export const shareUnlockPerIpLimiter = limiter({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  skipSuccessfulRequests: true,
  message: 'Too many incorrect passwords. Try again in 15 minutes.',
});
