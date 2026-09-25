import { formatBytes, formatDate } from '../../utils/format.js';
import { describeUserAgent } from '../../utils/userAgent.js';

// Labels for the events a user can see about their own account (server:
// activity.service USER_VISIBLE_ACTIONS). Activity is not severity, so these are neutral.
export const ACTION_LABELS = {
  LOGIN: 'Sign in',
  LOGOUT: 'Sign out',
  UPLOAD: 'Upload',
  DOWNLOAD: 'Download',
  MODIFY: 'New version',
  RENAME: 'Rename',
  MOVE: 'Move',
  DELETE: 'Delete',
  RESTORE: 'Restore',
  SHARE: 'Share',
  SHARE_REVOKE: 'Unshare',
  SHARE_ACCESS: 'Link access',
};

const join = (...parts) => parts.filter(Boolean).join(' · ') || null;

// Describes one activity record.
//   verb:       text placed before the file link ("Uploaded a new version of <file>")
//   standalone: the same event without a file link (a file's own activity tab)
//   detail:     secondary line
// folderName(id) returns a name, null when the folder no longer exists, or undefined when
// names are not known (not loaded). Unknown names are left out rather than guessed.
export function describeActivity(activity, folderName = () => undefined) {
  const meta = activity.metadata || {};
  const version = meta.versionNumber ? `v${meta.versionNumber}` : null;

  switch (activity.action) {
    case 'LOGIN':
      return { verb: 'Signed in', standalone: 'Signed in', detail: describeUserAgent(meta.userAgent) };
    case 'LOGOUT':
      return meta.reason === 'REVOKED_BY_USER'
        ? { verb: 'Session signed out', standalone: 'Session signed out', detail: 'Ended from another of your sessions' }
        : { verb: 'Signed out', standalone: 'Signed out', detail: null };
    case 'UPLOAD':
      return { verb: 'Uploaded', standalone: 'Uploaded', detail: join(version, formatBytes(activity.sizeAfter)) };
    case 'MODIFY':
      return {
        verb: 'Uploaded a new version of',
        standalone: 'Uploaded a new version',
        detail: join(version, `${formatBytes(activity.sizeBefore)} → ${formatBytes(activity.sizeAfter)}`),
      };
    case 'RENAME':
      return { verb: 'Renamed', standalone: 'Renamed', detail: `${activity.nameBefore} → ${activity.nameAfter}` };
    case 'MOVE': {
      const from = folderName(meta.fromFolderId);
      const to = folderName(meta.toFolderId);
      const known = from !== undefined && to !== undefined;
      return {
        verb: 'Moved',
        standalone: 'Moved',
        detail: known ? `${from ?? 'a deleted folder'} → ${to ?? 'a deleted folder'}` : null,
      };
    }
    case 'DELETE':
      return { verb: 'Deleted', standalone: 'Deleted', detail: 'Versions are kept for recovery' };
    case 'DOWNLOAD':
      return { verb: 'Downloaded', standalone: 'Downloaded', detail: version };
    case 'RESTORE':
      return {
        verb: 'Restored',
        standalone: 'Restored',
        detail: join(
          `v${meta.restoredFromVersion} restored as ${version}`,
          activity.nameBefore && activity.nameBefore !== activity.nameAfter
            ? `${activity.nameBefore} → ${activity.nameAfter}`
            : null,
        ),
      };
    case 'SHARE':
      return {
        verb: 'Created a share link for',
        standalone: 'Created a share link',
        detail: join(
          meta.permission === 'DOWNLOAD' ? 'View & download' : 'View only',
          meta.expiresAt ? `expires ${formatDate(meta.expiresAt)}` : null,
          meta.recipientLabel ? `for ${meta.recipientLabel}` : null,
          meta.passwordProtected ? 'password required' : null,
        ),
      };
    case 'SHARE_REVOKE':
      return {
        verb: 'Revoked a share link for',
        standalone: 'Revoked a share link',
        detail: meta.recipientLabel ? `Link for ${meta.recipientLabel}` : null,
      };
    case 'SHARE_ACCESS':
      return meta.accessType === 'DOWNLOAD'
        ? { verb: 'Downloaded through a share link:', standalone: 'Downloaded through a share link', detail: meta.recipientLabel ? `Link for ${meta.recipientLabel}` : null }
        : { verb: 'Share link opened for', standalone: 'Share link opened', detail: meta.recipientLabel ? `Link for ${meta.recipientLabel}` : null };
    default: {
      const label = ACTION_LABELS[activity.action] ?? activity.action;
      return { verb: label, standalone: label, detail: null };
    }
  }
}
