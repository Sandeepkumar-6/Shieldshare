import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { config } from '../config/env.js';
import { resolveAccessToken } from '../services/auth.service.js';
import { toFeedItems } from '../services/activityFeed.service.js';
import { EVENTS, subscribe } from './events.js';

// Socket.IO transport (spec §19, api-contract §4), attached to the API's HTTP server.
//
// Handshake: io(url, { auth: { token } }). The token is checked by the same function as the
// REST authenticate middleware (signature, ACTIVE unexpired session, tokenVersion, role and
// status loaded from the database). Anything else is refused with UNAUTHENTICATED or
// SESSION_REVOKED.
//
// Rooms (joined by the server only; clients cannot join rooms):
//   user:<userId>       everyone: their own notices (freeze / unfreeze), never risk data
//   admins              role === 'admin' only: every security event
//   session:<sessionId> internal: lets logout disconnect exactly that session's sockets
//
// Every event is { eventId, at, data } with a random UUID eventId for client de-duplication.
// Clients refetch server state on reconnect; missed events are never replayed.

const FROZEN_NOTICE = 'File changes are paused while ShieldShare reviews recent activity on your account.';
const UNFROZEN_NOTICE = 'File access has been restored.';

// activity.created is batched: at most one emit per FLUSH_MS (≤ 5 per second), at most
// MAX_BATCH items per emit (older overflow is counted in `dropped`, and the feed's REST
// endpoint still has everything).
const FLUSH_MS = 200;
const MAX_BATCH = 50;
const MAX_TIMER_MS = 2 ** 31 - 1;

const envelope = (data) => ({ eventId: randomUUID(), at: new Date().toISOString(), data });

function authError(code) {
  const error = new Error(code);
  error.data = { code };
  return error;
}

/**
 * @param {import('node:http').Server} httpServer
 * @returns {{ io: Server, close: () => Promise<void> }}
 */
export function attachRealtime(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin, methods: ['GET', 'POST'] },
    serveClient: false,
  });

  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
      return next(authError('UNAUTHENTICATED'));
    }
    try {
      const { user, session } = await resolveAccessToken(token);
      socket.data.userId = String(user._id);
      socket.data.sessionId = String(session._id);
      socket.data.role = user.role;
      socket.data.expiresAt = session.expiresAt.getTime();
      return next();
    } catch (error) {
      return next(authError(error.code === 'SESSION_REVOKED' ? 'SESSION_REVOKED' : 'UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const { userId, sessionId, role, expiresAt } = socket.data;
    socket.join(`user:${userId}`);
    socket.join(`session:${sessionId}`);
    if (role === 'admin') socket.join('admins');

    // The connection must not outlive the session it was opened with.
    const timer = setTimeout(
      () => socket.disconnect(true),
      Math.min(Math.max(0, expiresAt - Date.now()), MAX_TIMER_MS),
    );
    timer.unref?.();
    socket.on('disconnect', () => clearTimeout(timer));
  });

  const toAdmins = (event, data) => io.to('admins').emit(event, envelope(data));
  const toUser = (userId, event, data) => io.to(`user:${userId}`).emit(event, envelope(data));
  const adminsOnline = () => (io.sockets.adapter.rooms.get('admins')?.size ?? 0) > 0;

  // ── activity.created batching ──
  let queue = [];
  let dropped = 0;
  let flushTimer = null;
  let flushInProgress = false;
  let lastFlush = 0;

  async function flush() {
    flushTimer = null;
    flushInProgress = true;
    const batch = queue;
    const lost = dropped;
    queue = [];
    dropped = 0;
    try {
      if (batch.length === 0 || !adminsOnline()) return;
      const items = await toFeedItems(batch);
      toAdmins(EVENTS.ACTIVITY_CREATED, { items, dropped: lost });
      // Rate-limit actual emissions, not the start of the asynchronous conversion above.
      lastFlush = Date.now();
    } finally {
      flushInProgress = false;
      if (queue.length) schedule();
    }
  }

  function schedule() {
    if (flushTimer || flushInProgress) return;
    flushTimer = setTimeout(() => {
      flush().catch((error) => console.error('[realtime] activity batch failed:', error.message));
    }, Math.max(0, lastFlush + FLUSH_MS - Date.now()));
    flushTimer.unref?.();
  }

  const direct = [
    EVENTS.SECURITY_ALERT, EVENTS.RISK_UPDATED, EVENTS.CANARY_TRIGGERED, EVENTS.FILE_QUARANTINED,
    EVENTS.INCIDENT_CREATED, EVENTS.INCIDENT_UPDATED, EVENTS.INCIDENT_RESOLVED,
    EVENTS.RECOVERY_COMPLETED, EVENTS.SIMULATOR_PROGRESS,
  ];

  const unsubscribers = [
    ...direct.map((event) => subscribe(event, (data) => toAdmins(event, data))),

    subscribe(EVENTS.USER_FROZEN, ({ userId, incidentId, reason, actor }) => {
      toAdmins(EVENTS.USER_FROZEN, { userId, incidentId, reason });
      // Automatic containment tells the user when it has finished (containment.completed).
      if (actor !== 'SYSTEM') toUser(userId, EVENTS.USER_FROZEN, { notice: FROZEN_NOTICE });
    }),
    subscribe(EVENTS.CONTAINMENT_COMPLETED, ({ userId }) => {
      toUser(userId, EVENTS.USER_FROZEN, { notice: FROZEN_NOTICE });
    }),
    subscribe(EVENTS.USER_UNFROZEN, ({ userId }) => {
      toAdmins(EVENTS.USER_UNFROZEN, { userId });
      toUser(userId, EVENTS.USER_UNFROZEN, { notice: UNFROZEN_NOTICE });
    }),

    subscribe(EVENTS.ACTIVITY_CREATED, ({ activities, severity = null, incidentId = null }) => {
      for (const activity of activities) queue.push({ activity, severity, incidentId });
      if (queue.length > MAX_BATCH) {
        dropped += queue.length - MAX_BATCH;
        queue = queue.slice(-MAX_BATCH);
      }
      schedule();
    }),

    subscribe(EVENTS.SESSION_REVOKED, ({ sessionId }) => {
      io.in(`session:${sessionId}`).disconnectSockets(true);
    }),
    subscribe(EVENTS.USER_SESSIONS_REVOKED, ({ userId }) => {
      io.in(`user:${userId}`).disconnectSockets(true);
    }),
  ];

  async function close() {
    for (const unsubscribe of unsubscribers) unsubscribe();
    if (flushTimer) clearTimeout(flushTimer);
    await new Promise((resolve) => { io.close(() => resolve()); });
  }

  return { io, close };
}
