import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { Folder, Session, User } from '../models/index.js';
import { EVENTS, publish } from '../realtime/events.js';
import { seedForUser } from '../security/canary.service.js';
import { errors } from '../utils/AppError.js';
import * as activity from './activity.service.js';
import * as folders from './folder.service.js';

// Authentication and sessions (spec §5). A JWT is only accepted while its Session is ACTIVE
// and unexpired and its `tv` matches the user's tokenVersion; the role and status always
// come from the database, never from the token.

const BCRYPT_ROUNDS = 12;
const LAST_SEEN_RESOLUTION_MS = 60 * 1000;
// Compared against when an email is unknown, so response time does not reveal which
// accounts exist.
const TIMING_DUMMY_HASH = bcrypt.hashSync('shieldshare-timing-equalizer', BCRYPT_ROUNDS);

const invalidCredentials = () => errors.unauthenticated('Email or password is incorrect.');

// ── Accounts ───────────────────────────────────────────────────────────────────────────

// Creates a user and their workspace. Used by registration and by the seed script.
export async function createUserWithWorkspace({ name, email, password, role = 'user' }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let user;
  try {
    user = await User.create({ name, email, passwordHash, role });
  } catch (error) {
    if (error?.code === 11000) {
      throw errors.conflict('EMAIL_IN_USE', 'An account with this email already exists.');
    }
    throw error;
  }

  try {
    await folders.createRootFolder(user._id);
  } catch (error) {
    // Do not leave an account without a workspace behind.
    await Folder.deleteMany({ ownerId: user._id });
    await User.deleteOne({ _id: user._id });
    throw error;
  }

  // Canary files (spec §14). A failure here must not block registration; the backfill script
  // (npm run canaries:backfill) seeds whatever is missing.
  try {
    await seedForUser(user._id);
  } catch (error) {
    console.error(`[canary] seeding failed for user ${user._id}:`, error.message);
  }
  return user;
}

export async function register(ctx, { name, email, password }) {
  const user = await createUserWithWorkspace({ name, email, password }); // role is never taken from input
  const accessToken = await startSession(user, ctx, 'REGISTER');
  return { user, accessToken };
}

export async function login(ctx, { email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash +tokenVersion');
  if (!user) {
    await bcrypt.compare(password, TIMING_DUMMY_HASH);
    throw invalidCredentials();
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    throw invalidCredentials();
  }
  if (user.status === 'DISABLED') {
    throw errors.forbidden('This account has been disabled. Contact your administrator.');
  }
  // FROZEN users may still sign in with read-only access (spec §5).
  const accessToken = await startSession(user, ctx, 'LOGIN');
  return { user, accessToken };
}

// ── Sessions ───────────────────────────────────────────────────────────────────────────

async function startSession(user, ctx, via) {
  const sessionId = new mongoose.Types.ObjectId();
  const tokenVersion = user.tokenVersion ?? 0;
  const accessToken = jwt.sign(
    { sub: String(user._id), sid: String(sessionId), tv: tokenVersion },
    config.jwt.secret,
    { algorithm: 'HS256', expiresIn: config.jwt.accessTtl },
  );
  // No refresh tokens in the MVP, so the session lives exactly as long as its token.
  const { exp } = jwt.decode(accessToken);
  const now = new Date();
  await Session.create({
    _id: sessionId,
    userId: user._id,
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    lastSeenAt: now,
    expiresAt: new Date(exp * 1000),
  });

  await activity.record(
    { ...ctx, userId: String(user._id), sessionId: String(sessionId) },
    'LOGIN',
    { metadata: { userAgent: ctx.userAgent, via } },
  );
  return accessToken;
}

export async function resolveAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw errors.sessionRevoked('Your session has expired. Sign in again.');
    }
    throw errors.unauthenticated();
  }

  const { sub, sid, tv } = payload;
  if (!mongoose.isValidObjectId(sub) || !mongoose.isValidObjectId(sid) || !Number.isInteger(tv)) {
    throw errors.unauthenticated();
  }

  const [session, user] = await Promise.all([
    Session.findById(sid).lean(),
    User.findById(sub).select('+tokenVersion').lean(),
  ]);
  const now = Date.now();
  if (
    !session
    || String(session.userId) !== sub
    || session.status !== 'ACTIVE'
    || session.expiresAt.getTime() <= now
  ) {
    throw errors.sessionRevoked();
  }
  if (!user || user.tokenVersion !== tv || user.status === 'DISABLED') {
    throw errors.sessionRevoked();
  }

  if (!session.lastSeenAt || now - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date(now) } }, { timestamps: false })
      .catch((error) => console.error('[auth] lastSeenAt update failed', error.message));
  }

  return { user, session };
}

// A revoked session also loses its live connection (realtime/socket.js disconnects it).
async function revoke(sessionId, reason) {
  const session = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'ACTIVE' },
    { $set: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason } },
    { returnDocument: 'after' },
  );
  if (session) publish(EVENTS.SESSION_REVOKED, { sessionId: String(session._id), userId: String(session.userId) });
  return session;
}

export async function logout(ctx) {
  const session = await revoke(ctx.sessionId, 'LOGOUT');
  if (session) {
    await activity.record(ctx, 'LOGOUT');
  }
}

export async function listSessions(ctx) {
  return Session.find({ userId: ctx.userId, status: 'ACTIVE', expiresAt: { $gt: new Date() } })
    .sort({ lastSeenAt: -1, createdAt: -1 })
    .lean();
}

export async function revokeOwnSession(ctx, sessionId) {
  if (!mongoose.isValidObjectId(sessionId)) throw errors.notFound('Session not found.');
  const owned = await Session.findOne({ _id: sessionId, userId: ctx.userId, status: 'ACTIVE' });
  if (!owned) throw errors.notFound('Session not found.');

  const isCurrent = ctx.sessionId === String(owned._id);
  const session = await revoke(owned._id, isCurrent ? 'LOGOUT' : 'USER');
  if (session) {
    // The LOGOUT event belongs to the session that ended, not the one that ended it.
    await activity.record({ ...ctx, sessionId: String(owned._id) }, 'LOGOUT', {
      metadata: isCurrent ? {} : { reason: 'REVOKED_BY_USER', revokedFromSessionId: ctx.sessionId },
    });
  }
  return { revokedCurrent: isCurrent };
}
