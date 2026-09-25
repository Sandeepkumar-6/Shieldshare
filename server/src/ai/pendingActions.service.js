import { z } from 'zod';
import { PendingAction } from '../models/index.js';
import * as freeze from '../security/freeze.service.js';
import * as incidents from '../security/incident.service.js';
import * as quarantine from '../security/quarantine.service.js';
import * as recovery from '../security/recovery.service.js';
import * as admin from '../services/admin.service.js';
import * as audit from '../services/audit.service.js';
import { errors } from '../utils/AppError.js';

const id = z.string().regex(/^[a-f\d]{24}$/i, 'Use a valid resource id.');
const reason = z.string().trim().min(1).max(1000);
const schemas = {
  freezeUser: z.object({ userId: id, reason }).strict(),
  unfreezeUser: z.object({ userId: id, reason }).strict(),
  quarantineFile: z.object({ fileId: id, reason }).strict(),
  restoreVersion: z.object({ fileId: id, versionId: id }).strict(),
};

const actorOf = (context) => ({ kind: 'ADMIN', adminId: context.adminId, ip: context.ip });

async function validateAndSummarize(tool, args, context) {
  const parsed = schemas[tool]?.safeParse(args);
  if (!parsed?.success) throw errors.validation('Shield AI proposed invalid action arguments.', parsed?.error?.flatten());
  const values = parsed.data;

  if (tool === 'freezeUser' || tool === 'unfreezeUser') {
    const { user } = await admin.getUser(values.userId);
    if (tool === 'freezeUser') {
      if (String(user._id) === String(context.adminId)) throw errors.conflict('CANNOT_FREEZE_SELF', 'You cannot freeze your own account.');
      if (user.status !== 'ACTIVE') throw errors.conflict('INVALID_TRANSITION', 'Only an active account can be frozen.');
    } else if (user.status !== 'FROZEN') {
      throw errors.conflict('INVALID_TRANSITION', 'This account is not frozen.');
    }
    return {
      args: values,
      summary: {
        title: tool === 'freezeUser' ? 'Freeze account' : 'Unfreeze account',
        target: `${user.name} (${user.email})`,
        from: user.status,
        to: tool === 'freezeUser' ? 'FROZEN' : 'ACTIVE',
        consequence: tool === 'freezeUser'
          ? 'The account becomes read-only. Existing sessions remain signed in.'
          : 'The account can change and share files again.',
      },
    };
  }

  if (tool === 'quarantineFile') {
    const { file } = await admin.getFile(values.fileId);
    if (file.status !== 'ACTIVE') throw errors.conflict('INVALID_TRANSITION', 'Only an active file can be quarantined.');
    return {
      args: values,
      summary: {
        title: 'Quarantine file', target: file.name, from: 'ACTIVE', to: 'QUARANTINED',
        consequence: 'Downloads and share links are paused while the file is under review.',
      },
    };
  }

  const [{ file }, version, incident] = await Promise.all([
    admin.getFile(values.fileId),
    admin.getVersion(values.fileId, values.versionId),
    recovery.incidentForFile(values.fileId),
  ]);
  if (!['SAFE', 'RESTORED'].includes(version.securityStatus) || version.createdAt >= incident.windowStart) {
    throw errors.conflict('VERSION_NOT_RESTORABLE', 'Choose a safe version created before the incident started.');
  }
  return {
    args: values,
    summary: {
      title: 'Restore safe version', target: file.name,
      from: `v${file.currentVersion} (${file.name})`, to: `v${version.versionNumber} (${version.nameAtVersion})`,
      consequence: `A verified copy of v${version.versionNumber} becomes the active version. Later versions remain in history.`,
    },
  };
}

export async function propose({ tool, args, conversationId, adminId, ip }) {
  const checked = await validateAndSummarize(tool, args, { adminId, ip });
  const action = await PendingAction.create({
    adminId, conversationId, tool, args: checked.args, summary: checked.summary,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return action;
}

export function toPendingActionDTO(action) {
  return {
    id: String(action._id), tool: action.tool, summary: action.summary, status: action.status,
    expiresAt: action.expiresAt, executedAt: action.executedAt ?? null, result: action.result ?? null,
  };
}

async function ownAction(idValue, adminId) {
  const action = await PendingAction.findOne({ _id: idValue, adminId });
  if (!action) throw errors.notFound('Pending action not found.');
  if (action.status === 'PROPOSED' && action.expiresAt <= new Date()) {
    action.status = 'EXPIRED';
    await action.save();
  }
  return action;
}

export async function cancel(idValue, context) {
  const action = await ownAction(idValue, context.adminId);
  if (action.status === 'EXPIRED') throw errors.conflict('ACTION_EXPIRED', 'This proposed action has expired.');
  if (action.status !== 'PROPOSED' || action.executedAt) throw errors.conflict('INVALID_TRANSITION', 'This action is no longer awaiting confirmation.');
  action.status = 'CANCELLED';
  await action.save();
  return action;
}

function auditTarget(action) {
  if (['freezeUser', 'unfreezeUser'].includes(action.tool)) return { kind: 'User', id: action.args.userId };
  return { kind: 'File', id: action.args.fileId };
}

const auditAction = {
  freezeUser: 'FREEZE_USER', unfreezeUser: 'UNFREEZE_USER', quarantineFile: 'QUARANTINE_FILE', restoreVersion: 'RESTORE_VERSION',
};

async function execute(action, context) {
  const actor = actorOf(context);
  if (action.tool === 'freezeUser') {
    const result = await freeze.freezeUser(action.args.userId, { reason: action.args.reason, signOut: false, actor });
    return { before: result.before, after: { status: result.user.status }, data: { userId: String(result.user._id), status: result.user.status } };
  }
  if (action.tool === 'unfreezeUser') {
    const result = await freeze.unfreezeUser(action.args.userId, { reason: action.args.reason, actor });
    return { before: result.before, after: { status: result.user.status }, data: { userId: String(result.user._id), status: result.user.status } };
  }
  if (action.tool === 'quarantineFile') {
    const result = await quarantine.quarantineFile(action.args.fileId, { reason: action.args.reason, actor });
    return { before: { status: 'ACTIVE' }, after: { status: result.file.status }, data: { fileId: String(result.file._id), status: result.file.status } };
  }
  const incident = await recovery.incidentForFile(action.args.fileId);
  const result = await recovery.restoreFile(incident, action.args.fileId, action.args.versionId, { adminId: context.adminId, ip: context.ip });
  return {
    before: result.before,
    after: { status: result.file.status, currentVersion: result.file.currentVersion, verification: result.verification.passed },
    data: { fileId: String(result.file._id), name: result.file.name, currentVersion: result.file.currentVersion, verification: result.verification },
  };
}

export async function confirm(idValue, context) {
  if (context.adminStatus === 'FROZEN') throw errors.userFrozen();
  let action = await ownAction(idValue, context.adminId);
  if (action.status === 'EXPIRED') throw errors.conflict('ACTION_EXPIRED', 'This proposed action has expired.');
  if (action.status !== 'PROPOSED' || action.executedAt) throw errors.conflict('INVALID_TRANSITION', 'This action is no longer awaiting confirmation.');

  // Re-run every precondition immediately before execution, then atomically claim the proposal.
  await validateAndSummarize(action.tool, action.args, context);
  action = await PendingAction.findOneAndUpdate(
    { _id: action._id, adminId: context.adminId, status: 'PROPOSED', executedAt: { $exists: false } },
    { $set: { executedAt: new Date() } }, { returnDocument: 'after' },
  );
  if (!action) throw errors.conflict('INVALID_TRANSITION', 'This action is already being handled.');

  try {
    const outcome = await execute(action, context);
    action.status = 'EXECUTED';
    action.result = outcome.data;
    await action.save();
    await audit.record({
      adminId: context.adminId, action: auditAction[action.tool], target: auditTarget(action), via: 'SHIELD_AI',
      pendingActionId: action._id, before: outcome.before, after: outcome.after, note: action.args.reason,
      ip: context.ip, result: 'SUCCESS',
    });
    return action;
  } catch (error) {
    action.status = 'FAILED';
    action.result = { error: error.code ?? 'INTERNAL_ERROR', message: error.message };
    await action.save();
    await audit.record({
      adminId: context.adminId, action: auditAction[action.tool], target: auditTarget(action), via: 'SHIELD_AI',
      pendingActionId: action._id, note: action.args.reason, ip: context.ip, result: 'FAILURE',
      error: `${error.code ?? 'INTERNAL_ERROR'}: ${error.message}`.slice(0, 500),
    }).catch(() => {});
    throw error;
  }
}
