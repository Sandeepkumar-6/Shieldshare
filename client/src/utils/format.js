const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
// 24-hour clock for log timestamps: fixed width, no AM/PM ambiguity.
const timeWithSeconds = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

const toDate = (value) => (value instanceof Date ? value : new Date(value));

export function formatDateTime(value) {
  return value ? dateTime.format(toDate(value)) : '—';
}

export function formatDate(value) {
  return value ? dateOnly.format(toDate(value)) : '—';
}

export function formatTime(value) {
  return value ? timeWithSeconds.format(toDate(value)) : '—';
}

// "3 min ago", "in 7 days". Beyond `maxDays` it falls back to the date.
export function formatRelative(value, { maxDays = 7 } = {}) {
  if (!value) return '—';
  const seconds = Math.round((toDate(value).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return seconds <= 0 ? 'just now' : 'in a few seconds';
  if (abs < 60 * 60) return relative.format(Math.round(seconds / 60), 'minute');
  if (abs < 60 * 60 * 24) return relative.format(Math.round(seconds / 3600), 'hour');
  if (abs < 60 * 60 * 24 * (maxDays + 1)) return relative.format(Math.round(seconds / 86400), 'day');
  return formatDate(value);
}

export function shortHash(hash, head = 12, tail = 6) {
  if (!hash) return '—';
  return hash.length <= head + tail ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}
