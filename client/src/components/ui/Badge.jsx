const TONES = {
  neutral: 'text-fg-secondary bg-surface-hover border-line',
  accent: 'text-accent bg-accent/10 border-accent/25',
  success: 'text-success bg-success/10 border-success/25',
  warning: 'text-warning bg-warning/10 border-warning/25',
  danger: 'text-danger bg-danger/10 border-danger/25',
  critical: 'text-critical bg-critical/10 border-critical/25',
  info: 'text-info bg-info/10 border-info/25',
};

const DOT = {
  neutral: 'bg-fg-muted',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  critical: 'bg-critical',
  info: 'bg-info',
};

// Status label. Always text + colour (+ optional dot), never colour alone (skill §5, §35).
export function Badge({ tone = 'neutral', dot = false, mono = false, children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-control border px-1.5 py-px text-meta font-medium whitespace-nowrap ${mono ? 'font-mono tracking-tight' : ''} ${TONES[tone]} ${className}`}
    >
      {dot && <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  );
}

// Version security status (spec §8)
const VERSION_STATUS = {
  SAFE: { tone: 'success', label: 'Safe' },
  RESTORED: { tone: 'info', label: 'Restored' },
  SUSPICIOUS: { tone: 'warning', label: 'Suspicious' },
  QUARANTINED: { tone: 'critical', label: 'Quarantined' },
};

export function VersionStatusBadge({ status }) {
  const entry = VERSION_STATUS[status] ?? { tone: 'neutral', label: status };
  return <Badge tone={entry.tone} dot>{entry.label}</Badge>;
}

// File status as the owner sees it. Quarantine is shown as "Under review" (spec §25).
const FILE_STATUS = {
  ACTIVE: { tone: 'success', label: 'Active' },
  QUARANTINED: { tone: 'warning', label: 'Under review' },
  DELETED: { tone: 'neutral', label: 'Deleted' },
};

export function FileStatusBadge({ status }) {
  const entry = FILE_STATUS[status] ?? { tone: 'neutral', label: status };
  return <Badge tone={entry.tone} dot>{entry.label}</Badge>;
}

// Share link status (spec §7). EXPIRED is computed by the server from expiresAt.
const SHARE_STATUS = {
  ACTIVE: { tone: 'success', label: 'Active' },
  EXPIRED: { tone: 'neutral', label: 'Expired' },
  REVOKED: { tone: 'neutral', label: 'Revoked' },
  SUSPENDED: { tone: 'warning', label: 'Suspended' },
};

export function ShareStatusBadge({ status }) {
  const entry = SHARE_STATUS[status] ?? { tone: 'neutral', label: status };
  return <Badge tone={entry.tone} dot>{entry.label}</Badge>;
}

export function PermissionBadge({ permission }) {
  return <Badge tone="neutral">{permission === 'DOWNLOAD' ? 'View & download' : 'View only'}</Badge>;
}

// Account status for administrators.
const ACCOUNT_STATUS = {
  ACTIVE: { tone: 'success', label: 'Active' },
  FROZEN: { tone: 'warning', label: 'Frozen' },
  DISABLED: { tone: 'neutral', label: 'Disabled' },
};

export function AccountStatusBadge({ status }) {
  const entry = ACCOUNT_STATUS[status] ?? { tone: 'neutral', label: status };
  return <Badge tone={entry.tone} dot>{entry.label}</Badge>;
}

// Admin view of a file's status: quarantine is named plainly here.
const ADMIN_FILE_STATUS = {
  ACTIVE: { tone: 'success', label: 'Active' },
  QUARANTINED: { tone: 'critical', label: 'Quarantined' },
  DELETED: { tone: 'neutral', label: 'Deleted' },
};

export function AdminFileStatusBadge({ status }) {
  const entry = ADMIN_FILE_STATUS[status] ?? { tone: 'neutral', label: status };
  return <Badge tone={entry.tone} dot>{entry.label}</Badge>;
}
