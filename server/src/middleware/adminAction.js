import mongoose from 'mongoose';
import * as audit from '../services/audit.service.js';
import { errors } from '../utils/AppError.js';
import { clientIp } from '../utils/requestContext.js';
import { validate } from './validate.js';

// Wraps an administrator security action so it is always written to AdminAuditLog
// (api-contract §3.13), including every failure after authentication and the role check:
// frozen admin, invalid input, missing target, invalid transition, unexpected error.
//
// The handler returns { before, after, note?, targetId?, send(res) }. The audit entry is
// written before the response is sent, so a successful response always has its audit record.
// `targetId` names the target when it is not in the URL (the simulator's demo account).
export function adminAction({ action, targetKind, targetParam = 'id', schemas }, handler) {
  const validator = schemas ? validate(schemas) : null;

  return async function auditedAdminAction(req, res) {
    const rawTarget = req.params[targetParam];
    const entry = {
      adminId: req.user.id,
      action,
      target: { kind: targetKind, ...(mongoose.isValidObjectId(rawTarget) ? { id: rawTarget } : {}) },
      via: 'UI',
      ip: clientIp(req),
    };
    const requestNote = typeof (req.body?.reason ?? req.body?.note) === 'string'
      ? String(req.body.reason ?? req.body.note).slice(0, 1000)
      : undefined;

    let outcome;
    try {
      // A frozen account keeps read-only access, administrators included.
      if (req.user.status === 'FROZEN') throw errors.userFrozen();
      if (validator) validator(req, res, () => {});
      outcome = await handler(req);
    } catch (error) {
      await audit.record({
        ...entry,
        note: requestNote,
        result: 'FAILURE',
        error: error.code ? `${error.code}: ${error.message}`.slice(0, 500) : 'INTERNAL_ERROR',
      }).catch((failure) => console.error('[audit] failed to record failure', failure.message));
      throw error;
    }

    // A handler may complete but report a partial failure (e.g. restore-all where one file
    // failed verification): the response is sent, the audit entry says FAILURE.
    await audit.record({
      ...entry,
      ...(outcome.targetId && !entry.target.id ? { target: { ...entry.target, id: outcome.targetId } } : {}),
      before: outcome.before,
      after: outcome.after,
      note: outcome.note ?? requestNote,
      result: outcome.failure ? 'FAILURE' : 'SUCCESS',
      ...(outcome.failure ? { error: String(outcome.failure).slice(0, 500) } : {}),
    });
    return outcome.send(res);
  };
}
