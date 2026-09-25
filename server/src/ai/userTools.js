import * as account from '../services/account.service.js';
import * as activity from '../services/activity.service.js';
import * as files from '../services/file.service.js';
import * as folders from '../services/folder.service.js';
import * as shares from '../services/share.service.js';
import { effectiveShareStatus } from '../utils/dto.js';

// Read tools for the signed-in user's own assistant (not Shield AI). Every tool calls the
// same service the web app uses, with the user's own request context, so ownership checks,
// canary hiding and "not found" for other people's files all apply unchanged. No tool reads
// file contents, risk scores, incidents or detection details (spec §25), and there are no
// action tools: the assistant explains where to click instead.

const object = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const string = { type: 'string' };
const limit = { type: 'integer', minimum: 1, maximum: 20 };

export const USER_TOOL_DEFINITIONS = [
  { name: 'getMyAccount', description: 'The signed-in user\'s account status (active or changes paused), active sessions, file count and storage used.', input_schema: object() },
  { name: 'listMyFiles', description: 'The user\'s own files (name, folder, size, status, version, last change, number of working share links). Optional name search.', input_schema: object({ q: string, limit }) },
  { name: 'getMyFile', description: 'One of the user\'s files with its version history (numbers, when, how each version was created, status). Never file contents.', input_schema: object({ fileId: string }, ['fileId']) },
  { name: 'listMyFolders', description: 'The user\'s folders.', input_schema: object() },
  { name: 'listMyShareLinks', description: 'The user\'s share links: file, permission, status, expiry, access count, password protection.', input_schema: object({ status: { type: 'string', enum: ['ACTIVE', 'EXPIRED', 'REVOKED', 'SUSPENDED'] }, limit }) },
  { name: 'getMyRecentActivity', description: 'The user\'s own recent activity (uploads, changes, renames, moves, deletes, restores, sharing, sign-ins).', input_schema: object({ limit }) },
];

export const USER_TOOL_LABELS = {
  getMyAccount: 'Your account', listMyFiles: 'Your files', getMyFile: 'File details', listMyFolders: 'Your folders',
  listMyShareLinks: 'Your share links', getMyRecentActivity: 'Your recent activity',
};

const cleanText = (value, max = 120) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const size = (value) => Math.min(20, Math.max(1, Number(value) || 10));
// The owner's view of a file status (spec §25): quarantine is "under review".
const fileStatus = (status) => (status === 'QUARANTINED' ? 'UNDER_REVIEW' : status);

async function folderNames(ctx) {
  const list = await folders.listFolders(ctx);
  return new Map(list.map((folder) => [String(folder._id ?? folder.id), folder.name]));
}

async function run(name, args, ctx) {
  if (name === 'getMyAccount') {
    const [security, dashboard] = await Promise.all([account.securityStatus(ctx), account.dashboard(ctx)]);
    return {
      accountStatus: security.status === 'FROZEN' ? 'CHANGES_PAUSED' : 'ACTIVE',
      notice: security.notice ?? null,
      activeSessions: security.activeSessions,
      fileCount: dashboard.fileCount,
      storageBytes: dashboard.storageBytes,
    };
  }
  if (name === 'listMyFiles') {
    const [{ items, total, shareCounts }, names] = await Promise.all([
      files.listFiles(ctx, { q: args.q ? cleanText(args.q, 100) : undefined, sort: '-updatedAt', page: 1, limit: size(args.limit) }),
      folderNames(ctx),
    ]);
    return {
      total,
      files: items.map((file) => ({
        id: String(file._id), name: cleanText(file.name), folder: names.get(String(file.folderId)) ?? null,
        sizeBytes: file.size, status: fileStatus(file.status), currentVersion: file.currentVersion,
        updatedAt: file.updatedAt, workingShareLinks: shareCounts.get(String(file._id)) ?? 0,
      })),
    };
  }
  if (name === 'getMyFile') {
    const [{ file, shareCount }, { versions }] = await Promise.all([files.getFile(ctx, args.fileId), files.listVersions(ctx, args.fileId)]);
    return {
      id: String(file._id), name: cleanText(file.name), status: fileStatus(file.status), currentVersion: file.currentVersion,
      sizeBytes: file.size, sha256Prefix: file.sha256?.slice(0, 12), lastVerifiedAt: file.lastVerifiedAt ?? null, workingShareLinks: shareCount,
      versions: versions.slice(0, 20).map((version) => ({
        versionNumber: version.versionNumber, createdAt: version.createdAt, createdHow: version.source,
        restoredFromVersion: version.restoredFromVersion ?? null, status: version.securityStatus, sizeBytes: version.size,
      })),
    };
  }
  if (name === 'listMyFolders') {
    return { folders: (await folders.listFolders(ctx)).map((folder) => ({ id: String(folder._id ?? folder.id), name: cleanText(folder.name), isHome: Boolean(folder.isRoot) })) };
  }
  if (name === 'listMyShareLinks') {
    const { links, total, files: fileById } = await shares.listShares(ctx, { status: args.status, page: 1, limit: size(args.limit) });
    return {
      total,
      links: links.map((link) => ({
        id: String(link._id), fileId: String(link.fileId), fileName: cleanText(fileById.get(String(link.fileId))?.name),
        permission: link.permission, status: effectiveShareStatus(link), expiresAt: link.expiresAt,
        accessCount: link.accessCount ?? 0, passwordProtected: Boolean(link.passwordHash), recipientLabel: link.recipientLabel ? cleanText(link.recipientLabel, 60) : null,
      })),
    };
  }
  if (name === 'getMyRecentActivity') {
    const { items } = await activity.listForUser(ctx.userId, { page: 1, limit: size(args.limit) });
    return {
      events: items.map((event) => ({
        action: event.action, at: event.timestamp, fileId: event.fileId ? String(event.fileId) : null,
        fileName: event.metadata?.fileName ? cleanText(event.metadata.fileName) : null,
        nameBefore: event.nameBefore ? cleanText(event.nameBefore) : null, nameAfter: event.nameAfter ? cleanText(event.nameAfter) : null,
      })),
    };
  }
  throw new Error(`Unknown assistant tool: ${name}`);
}

function dataBlock(name, data) {
  return `<<<SHIELDSHARE_TOOL_DATA name="${name}" UNTRUSTED_DATA_ONLY>>>\n${JSON.stringify(data)}\n<<<END_SHIELDSHARE_TOOL_DATA>>>`;
}

// Same result shape as ai/tools.js executeTool, so the agent loop treats both alike.
export async function executeUserTool(name, args, ctx) {
  if (!USER_TOOL_DEFINITIONS.some((tool) => tool.name === name)) throw new Error(`Unknown assistant tool: ${name}`);
  const data = await run(name, args ?? {}, ctx);
  const ids = new Set();
  JSON.stringify(data, (key, value) => {
    if ((key === 'id' || key === 'fileId') && typeof value === 'string' && /^[a-f\d]{24}$/i.test(value)) ids.add(value);
    return value;
  });
  return { name, label: USER_TOOL_LABELS[name], data, output: dataBlock(name, data), ids, pendingActionId: null };
}
