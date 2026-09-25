import { EventEmitter } from 'node:events';

// Internal domain event bus (spec §19). Services publish what happened; realtime/socket.js
// decides who hears about it and how. Services never import Socket.IO.
//
// Listeners are isolated: a listener that throws or rejects is logged and never reaches the
// service that published, so a realtime problem can't break a file operation or a freeze.

const bus = new EventEmitter();
bus.setMaxListeners(100);

// Domain events. The first group maps 1:1 to the Socket.IO events of api-contract §4; the
// second group is internal only.
export const EVENTS = Object.freeze({
  SECURITY_ALERT: 'security.alert',
  RISK_UPDATED: 'risk.updated',
  CANARY_TRIGGERED: 'canary.triggered',
  USER_FROZEN: 'user.frozen',
  USER_UNFROZEN: 'user.unfrozen',
  FILE_QUARANTINED: 'file.quarantined',
  INCIDENT_CREATED: 'incident.created',
  INCIDENT_UPDATED: 'incident.updated',
  INCIDENT_RESOLVED: 'incident.resolved',
  RECOVERY_COMPLETED: 'recovery.completed',
  ACTIVITY_CREATED: 'activity.created',
  SIMULATOR_PROGRESS: 'simulator.progress',

  // Internal: automatic containment finished (freeze + quarantine). The frozen user is told
  // only now, so their file list already shows the quarantine when they reload it.
  CONTAINMENT_COMPLETED: 'containment.completed',
  // Internal: one session ended (logout) / every session of a user ended (freeze + sign out).
  SESSION_REVOKED: 'session.revoked',
  USER_SESSIONS_REVOKED: 'user.sessions.revoked',
});

export function publish(name, data) {
  bus.emit(name, data);
}

// Returns an unsubscribe function.
export function subscribe(name, listener) {
  const safe = (data) => {
    try {
      const result = listener(data);
      if (result && typeof result.catch === 'function') {
        result.catch((error) => console.error(`[events] ${name} listener failed:`, error));
      }
    } catch (error) {
      console.error(`[events] ${name} listener failed:`, error);
    }
  };
  bus.on(name, safe);
  return () => bus.off(name, safe);
}
