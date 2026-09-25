import { Activity, SecurityIncident } from '../models/index.js';

// Per-user sliding windows of recent write activity (spec §10). In memory for speed on the
// request path; rebuilt from the Activity collection when the server starts, so a restart
// does not reset a burst in progress.
//
// Limitation: one server process. Several processes would each hold a partial window and
// would need a shared store (e.g. Redis).

export const DETECTION_ACTIONS = Object.freeze(['UPLOAD', 'MODIFY', 'RENAME', 'MOVE', 'DELETE', 'CANARY_TRIGGER']);

const windows = new Map();   // userId → entries (oldest first)
const baselines = new Map(); // userId → Date; activity before it has been judged and is ignored

const id = (value) => (value == null ? null : String(value));

export function toEntry(activity) {
  return {
    id: id(activity._id),
    action: activity.action,
    userId: id(activity.userId),
    fileId: id(activity.fileId),
    directory: id(activity.directory),
    fromDirectory: id(activity.metadata?.fromFolderId),
    fileName: activity.metadata?.fileName ?? null,
    timestamp: new Date(activity.timestamp),
    isCanary: Boolean(activity.isCanary),
    nameBefore: activity.nameBefore ?? null,
    nameAfter: activity.nameAfter ?? null,
    hashBefore: activity.hashBefore ?? null,
    hashAfter: activity.hashAfter ?? null,
    entropyBefore: activity.entropyBefore ?? null,
    entropyAfter: activity.entropyAfter ?? null,
    triggeringAction: activity.metadata?.triggeringAction ?? null, // CANARY_TRIGGER only
  };
}

export function add(userId, activities) {
  const key = String(userId);
  const list = windows.get(key) ?? [];
  const known = new Set(list.map((entry) => entry.id));
  for (const activity of activities) {
    if (!DETECTION_ACTIONS.includes(activity.action)) continue;
    const entry = toEntry(activity);
    if (!known.has(entry.id)) list.push(entry);
  }
  list.sort((a, b) => a.timestamp - b.timestamp);
  windows.set(key, list);
}

// Entries inside [now - windowSeconds, now], after the user's baseline. Older ones are dropped.
export function entries(userId, now, windowSeconds) {
  const key = String(userId);
  const from = now.getTime() - windowSeconds * 1000;
  const baseline = baselines.get(key)?.getTime() ?? 0;
  const kept = (windows.get(key) ?? []).filter((entry) => {
    const time = entry.timestamp.getTime();
    return time >= from && time > baseline;
  });
  if (kept.length) windows.set(key, kept);
  else windows.delete(key);
  return kept.slice();
}

// After an incident is resolved its activity has been judged: start the user's window afresh
// so the next ordinary write is not scored together with the old burst.
export function resetUser(userId, at = new Date()) {
  baselines.set(String(userId), at);
  windows.delete(String(userId));
}

export async function rebuild(windowSeconds, now = new Date()) {
  windows.clear();
  baselines.clear();
  const from = new Date(now.getTime() - windowSeconds * 1000);

  const resolved = await SecurityIncident.find({ resolvedAt: { $gte: from } }).select('userId resolvedAt').lean();
  for (const incident of resolved) {
    const key = String(incident.userId);
    if (!baselines.has(key) || baselines.get(key) < incident.resolvedAt) baselines.set(key, incident.resolvedAt);
  }

  const recent = await Activity.find({
    action: { $in: DETECTION_ACTIONS },
    userId: { $ne: null },
    timestamp: { $gte: from },
  }).sort({ timestamp: 1 }).lean();
  const byUser = new Map();
  for (const activity of recent) {
    const key = String(activity.userId);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(activity);
  }
  for (const [userId, activities] of byUser) add(userId, activities);
  return { users: byUser.size, activities: recent.length };
}

export function clearAll() {
  windows.clear();
  baselines.clear();
}
