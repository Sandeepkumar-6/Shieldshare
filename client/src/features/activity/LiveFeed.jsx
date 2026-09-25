import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { SeverityBadge } from '../../components/security/SecurityBadges.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Icon } from '../../components/ui/Icon.jsx';
import { SkeletonRows } from '../../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../../components/ui/States.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { adminApi } from '../../services/admin.service.js';
import { useOnReconnect, useSocketEvent, useSocketStatus } from '../../state/SocketContext.jsx';
import { formatDateTime, formatTime } from '../../utils/format.js';

// Live activity feed (spec §20, skill §21). Loaded from GET /api/admin/activity, then kept
// current by the batched `activity.created` event. Newest first; only items that arrive
// live get the entry animation. After a reconnect the list is reloaded from the server.

// INTEGRITY_CHANGE is left out: it accompanies every MODIFY row, which already says the
// content changed.
export const FEED_ACTIONS = [
  'UPLOAD', 'MODIFY', 'RENAME', 'MOVE', 'DELETE', 'DOWNLOAD', 'RESTORE', 'SHARE', 'SHARE_REVOKE',
  'SHARE_ACCESS', 'CANARY_TRIGGER', 'QUARANTINE', 'QUARANTINE_RELEASE', 'FREEZE', 'UNFREEZE', 'LOGIN', 'LOGOUT',
];
const MAX_ITEMS = 40;

const ICONS = {
  UPLOAD: 'upload', MODIFY: 'pencil', RENAME: 'fileText', MOVE: 'folderMove', DELETE: 'trash', DOWNLOAD: 'download',
  RESTORE: 'restore', SHARE: 'link', SHARE_REVOKE: 'link', SHARE_ACCESS: 'eye', CANARY_TRIGGER: 'fingerprint',
  QUARANTINE: 'lock', QUARANTINE_RELEASE: 'unlock', FREEZE: 'lock', UNFREEZE: 'unlock', LOGIN: 'monitor', LOGOUT: 'logout',
};
const RESPONSE_ACTIONS = new Set(['FREEZE', 'QUARANTINE']);
const RECOVERY_ACTIONS = new Set(['UNFREEZE', 'QUARANTINE_RELEASE', 'RESTORE']);

function who(item) {
  return item.userName ?? item.userEmail ?? 'A user';
}

function describe(item) {
  const file = item.fileName ?? 'a file';
  const by = item.actor === 'SYSTEM' ? 'automatically' : item.actor === 'ADMIN' ? 'by an administrator' : null;
  switch (item.action) {
    case 'UPLOAD': return `${who(item)} uploaded ${file}`;
    case 'MODIFY': return `${who(item)} changed the content of ${file}`;
    case 'RENAME': return `${who(item)} renamed ${item.nameBefore ?? file} → ${item.nameAfter ?? file}`;
    case 'MOVE': return `${who(item)} moved ${file}`;
    case 'DELETE': return `${who(item)} deleted ${file}`;
    case 'DOWNLOAD': return `${who(item)} downloaded ${file}`;
    case 'RESTORE': return item.actor === 'ADMIN' ? `${file} restored by an administrator` : `${who(item)} restored ${file}`;
    case 'SHARE': return `${who(item)} created a share link for ${file}`;
    case 'SHARE_REVOKE': return `${who(item)} revoked a share link for ${file}`;
    case 'SHARE_ACCESS': return `Share link used for ${file}`;
    case 'CANARY_TRIGGER': return `Canary file ${file} touched by ${who(item)}`;
    case 'QUARANTINE': return `${file} quarantined${by ? ` ${by}` : ''}`;
    case 'QUARANTINE_RELEASE': return `${file} released from quarantine`;
    case 'FREEZE': return `${who(item)} frozen${by ? ` ${by}` : ''}`;
    case 'UNFREEZE': return `${who(item)} unfrozen`;
    case 'LOGIN': return `${who(item)} signed in`;
    case 'LOGOUT': return `${who(item)} signed out`;
    default: return `${who(item)}: ${item.action}`;
  }
}

// The row's label: the risk level the operation produced, or the incident's severity for an
// automatic response; otherwise a plain category. Never a guessed severity.
function Label({ item }) {
  if (item.severity) return <SeverityBadge severity={item.severity} />;
  if (RESPONSE_ACTIONS.has(item.action)) return <Badge tone="danger" dot>Response</Badge>;
  if (RECOVERY_ACTIONS.has(item.action)) return <Badge tone="info" dot>Recovery</Badge>;
  return <Badge tone="neutral" dot>Activity</Badge>;
}

const ICON_TONE = { CRITICAL: 'text-critical', HIGH: 'text-danger', SUSPICIOUS: 'text-warning' };

function target(item) {
  if (item.incidentId) return { to: `/admin/incidents/${item.incidentId}`, label: `Open incident ${item.incidentNumber ?? ''}`.trim() };
  if (item.userEmail) return { to: `/admin/users?q=${encodeURIComponent(item.userEmail)}`, label: `Open ${item.userEmail}` };
  if (item.fileName) return { to: `/admin/files?q=${encodeURIComponent(item.fileName)}`, label: `Find ${item.fileName}` };
  return null;
}

function FeedRow({ item, fresh }) {
  const link = target(item);
  const body = (
    <>
      <time dateTime={item.timestamp} title={formatDateTime(item.timestamp)} className="w-[4.75rem] shrink-0 pt-0.5 font-mono text-tech text-fg-muted tabular">
        {formatTime(item.timestamp)}
      </time>
      <span className="w-24 shrink-0"><Label item={item} /></span>
      <Icon name={ICONS[item.action] ?? 'activity'} className={`mt-0.5 size-4 shrink-0 ${ICON_TONE[item.severity] ?? 'text-fg-muted'}`} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-body text-fg">{describe(item)}</span>
        {(item.isCanary || item.incidentNumber) && (
          <span className="mt-1 flex flex-wrap gap-1.5">
            {item.isCanary && <Badge tone="critical">Canary</Badge>}
            {item.incidentNumber && <Badge tone="neutral" mono>{item.incidentNumber}</Badge>}
          </span>
        )}
      </span>
    </>
  );
  const rowClass = `flex items-start gap-3 px-4 py-2.5 ${fresh ? 'animate-feed-in' : ''}`;
  return (
    <li>
      {link
        ? <Link to={link.to} aria-label={`${describe(item)}. ${link.label}`} className={`${rowClass} transition-colors hover:bg-surface-hover`}>{body}</Link>
        : <div className={rowClass}>{body}</div>}
    </li>
  );
}

function merge(existing, incoming) {
  const byId = new Map(existing.map((item) => [item.activityId, item]));
  for (const item of incoming) byId.set(item.activityId, item);
  return [...byId.values()]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp) || (b.activityId > a.activityId ? 1 : -1))
    .slice(0, MAX_ITEMS);
}

export function LiveFeed({ userId, limit = 25 }) {
  const status = useSocketStatus();
  const initial = useAsync(
    () => adminApi.activityFeed({ limit, actions: FEED_ACTIONS.join(','), ...(userId ? { userId } : {}) }),
    [userId, limit],
  );
  const [live, setLive] = useState({ items: [], fresh: new Set(), base: null });

  // Live items are merged on top of the last server load; a new load replaces them.
  const baseItems = initial.data?.data;
  const items = live.base === baseItems ? merge(baseItems ?? [], live.items) : (baseItems ?? []);

  const onBatch = useCallback((data) => {
    const incoming = (data?.items ?? []).filter((item) => FEED_ACTIONS.includes(item.action) && (!userId || item.userId === userId));
    if (data?.dropped > 0) initial.reload(); // a burst larger than one batch: reload rather than show gaps
    if (!incoming.length) return;
    setLive((previous) => {
      const sameBase = previous.base === baseItems;
      return {
        base: baseItems,
        items: merge(sameBase ? previous.items : [], incoming),
        fresh: new Set([...(sameBase ? previous.fresh : []), ...incoming.map((item) => item.activityId)]),
      };
    });
  }, [baseItems, userId, initial]);

  useSocketEvent('activity.created', onBatch);
  useOnReconnect(initial.reload);

  return (
    <div className="flex flex-col">
      <p className="flex items-center gap-2 border-b border-line-subtle px-4 py-2 text-meta text-fg-muted">
        <span aria-hidden="true" className={`size-1.5 rounded-full ${status === 'connected' ? 'bg-success' : 'bg-fg-muted'}`} />
        {status === 'connected' ? 'Updating live' : 'Not live: showing the last loaded events'}
      </p>
      {initial.status === 'loading' && <div className="px-4"><SkeletonRows rows={6} columns={3} label="Loading activity" /></div>}
      {initial.status === 'error' && <ErrorState compact title="Unable to load activity" error={initial.error} onRetry={initial.reload} />}
      {initial.status === 'success' && (items.length === 0 ? (
        <EmptyState
          compact
          icon="activity"
          title="No activity yet"
          description="File operations, sign-ins, sharing and every automatic response appear here as they happen."
        />
      ) : (
        <ol aria-label="Live activity" aria-live="off" className="divide-y divide-line-subtle">
          {items.map((item) => <FeedRow key={item.activityId} item={item} fresh={live.fresh.has(item.activityId)} />)}
        </ol>
      ))}
    </div>
  );
}
