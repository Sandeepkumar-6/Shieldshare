import mongoose from 'mongoose';
import { SecurityIncident, Session, User } from '../models/index.js';
import { EVENTS, publish } from '../realtime/events.js';
import * as activity from '../services/activity.service.js';
import { errors } from '../utils/AppError.js';

// Account freeze (spec §5 "Freeze Enforcement"). A frozen user keeps read-only access;
// requireNotFrozen answers 423 on every write because status is read per request.
// "Freeze and sign out" also bumps tokenVersion and revokes every session, so all
// already-issued tokens stop working immediately.
//
// actor: { kind: 'ADMIN', adminId, ip } | { kind: 'SYSTEM' }  (Phase 3 uses SYSTEM)

async function findTarget(userId) {
  if (!mongoose.isValidObjectId(userId)) throw errors.notFound('User not found.');
  const user = await User.findById(userId);
  if (!user) throw errors.notFound('User not found.');
  return user;
}

function actorMetadata(actor) {
  return actor.kind === 'ADMIN' ? { actor: 'ADMIN', adminId: actor.adminId } : { actor: 'SYSTEM' };
}

export async function freezeUser(userId, { reason, signOut = false, incidentId, actor }) {
  if (actor.kind === 'ADMIN' && String(actor.adminId) === String(userId)) {
    throw errors.conflict('CANNOT_FREEZE_SELF', 'You can\'t freeze your own account.');
  }
  const user = await findTarget(userId);
  if (user.status === 'FROZEN') throw errors.conflict('INVALID_TRANSITION', 'This account is already frozen.');
  if (user.status !== 'ACTIVE') throw errors.conflict('INVALID_TRANSITION', 'Only active accounts can be frozen.');

  const now = new Date();
  const frozen = await User.findOneAndUpdate(
    { _id: user._id, status: 'ACTIVE' },
    {
      $set: { status: 'FROZEN', frozenAt: now, frozenReason: reason, ...(incidentId ? { frozenByIncidentId: incidentId } : {}) },
      ...(signOut ? { $inc: { tokenVersion: 1 } } : {}),
    },
    { returnDocument: 'after' },
  );
  if (!frozen) throw errors.conflict('INVALID_TRANSITION', 'This account is already frozen.');

  let revokedSessions = 0;
  if (signOut) {
    const result = await Session.updateMany(
      { userId: user._id, status: 'ACTIVE' },
      { $set: { status: 'REVOKED', revokedAt: now, revokedReason: 'FREEZE_SIGNOUT' } },
    );
    revokedSessions = result.modifiedCount;
  }

  // Recorded on the target's timeline. The reason is admin-only: the user's notice uses fixed
  // wording (spec §25), so this note never reaches them.
  await activity.record({ userId: user._id, sessionId: null, ip: actor.ip ?? null }, 'FREEZE', {
    metadata: { adminNote: reason, signOut, revokedSessions, incidentId, ...actorMetadata(actor) },
  });

  // `actor` lets the socket layer hold the user's own notice until automatic containment has
  // finished (realtime/socket.js); administrators hear about the freeze immediately.
  publish(EVENTS.USER_FROZEN, {
    userId: String(user._id),
    incidentId: incidentId ? String(incidentId) : null,
    reason,
    actor: actor.kind,
  });
  if (signOut) publish(EVENTS.USER_SESSIONS_REVOKED, { userId: String(user._id) });

  return { user: frozen, before: { status: user.status }, revokedSessions };
}

export async function unfreezeUser(userId, { reason, actor }) {
  const user = await findTarget(userId);
  if (user.status !== 'FROZEN') throw errors.conflict('INVALID_TRANSITION', 'This account is not frozen.');

  const unfrozen = await User.findOneAndUpdate(
    { _id: user._id, status: 'FROZEN' },
    { $set: { status: 'ACTIVE' }, $unset: { frozenAt: 1, frozenReason: 1, frozenByIncidentId: 1 } },
    { returnDocument: 'after' },
  );
  if (!unfrozen) throw errors.conflict('INVALID_TRANSITION', 'This account is not frozen.');

  await activity.record({ userId: user._id, sessionId: null, ip: actor.ip ?? null }, 'UNFREEZE', {
    metadata: { adminNote: reason, ...actorMetadata(actor) },
  });

  // An account frozen by an incident: the unfreeze belongs on that incident's timeline too,
  // whichever page it was done from.
  if (user.frozenByIncidentId) {
    const incident = await SecurityIncident.findOneAndUpdate(
      { _id: user.frozenByIncidentId },
      {
        $set: { freezeStatus: 'UNFROZEN' },
        $push: {
          timeline: {
            at: new Date(),
            type: 'FREEZE',
            actor: actor.kind === 'ADMIN' ? 'ADMIN' : 'SYSTEM',
            adminId: actor.kind === 'ADMIN' ? actor.adminId : undefined,
            text: `Account unfrozen: “${reason}”`,
          },
        },
      },
      { returnDocument: 'after' },
    );
    if (incident) {
      publish(EVENTS.INCIDENT_UPDATED, { incidentId: String(incident._id), status: incident.status, riskScore: incident.riskScore });
    }
  }

  publish(EVENTS.USER_UNFROZEN, { userId: String(user._id) });
  return { user: unfrozen, before: { status: user.status, frozenReason: user.frozenReason ?? null } };
}
