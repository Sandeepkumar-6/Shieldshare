import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../state/AuthContext.jsx';
import { useSocketStatus } from '../../state/SocketContext.jsx';
import { useTheme } from '../../state/ThemeContext.jsx';
import { Badge } from '../ui/Badge.jsx';
import { Icon } from '../ui/Icon.jsx';
import { Menu } from '../ui/Menu.jsx';
import { ThemeToggle } from '../ui/ThemeToggle.jsx';
import { Tooltip } from '../ui/Tooltip.jsx';
import { BrandMark } from './BrandMark.jsx';

// Real-time connection state (spec §19). While it is not "Live", pages still show server
// state; they refetch as soon as the connection is back.
const CONNECTION = {
  connected: { tone: 'success', label: 'Live', hint: 'Real-time updates are on.' },
  connecting: { tone: 'neutral', label: 'Connecting', hint: 'Connecting to real-time updates…' },
  reconnecting: { tone: 'warning', label: 'Reconnecting', hint: 'Real-time updates dropped. Reconnecting; data is refreshed when the connection is back.' },
  offline: { tone: 'neutral', label: 'Offline', hint: 'Real-time updates are off. Reload the page to see the latest data.' },
};

const DOT_TONE = { success: 'bg-success', warning: 'bg-warning', neutral: 'bg-fg-muted' };

function ConnectionIndicator() {
  const status = useSocketStatus();
  const entry = CONNECTION[status] ?? CONNECTION.offline;
  return (
    <Tooltip content={entry.hint} side="bottom">
      <span role="status" aria-label={`Real-time updates: ${entry.label}`} tabIndex={0} className="rounded-control">
        {/* Phones: the dot alone (the label stays in aria-label); wider screens: the badge. */}
        <span aria-hidden="true" className={`block size-2 rounded-full sm:hidden ${DOT_TONE[entry.tone]}`} />
        {/* Hidden on a wrapper: Badge always sets inline-flex, which would override `hidden`. */}
        <span className="hidden sm:inline-flex"><Badge tone={entry.tone} dot>{entry.label}</Badge></span>
      </span>
    </Tooltip>
  );
}

export function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)[0] : '')).toUpperCase() || '?';
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const admin = user?.role === 'admin';

  return (
    <Menu
      label="Account"
      triggerClassName="flex items-center gap-2.5 rounded-control py-1 pl-1 pr-1 sm:pr-2 transition-colors hover:bg-surface-hover"
      triggerContent={(
        <>
          <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-accent/15 text-meta font-semibold text-accent">
            {initials(user?.name)}
          </span>
          <span className="hidden min-w-0 flex-col items-start leading-tight md:flex">
            <span className="max-w-40 truncate text-body font-medium text-fg">{user?.name}</span>
            <span className="text-meta text-fg-muted">{admin ? 'Administrator' : 'Member'}</span>
          </span>
          <Icon name="chevronDown" className="hidden size-3.5 text-fg-muted md:block" />
          <span className="sr-only">Account menu for {user?.email}</span>
        </>
      )}
      items={[
        { label: 'Security & sessions', icon: 'shield', onSelect: () => navigate('/app/security') },
        { label: theme === 'light' ? 'Dark theme' : 'Light theme', icon: theme === 'light' ? 'moon' : 'sun', onSelect: toggle },
        { label: 'Sign out', icon: 'logout', onSelect: logout },
      ]}
    />
  );
}

export function Topbar({ onOpenNav }) {
  const { user } = useAuth();
  const frozen = user?.status === 'FROZEN';

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-line-subtle bg-bg/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-bg/75 sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenNav}
        aria-label="Open navigation"
        className="-ml-1.5 cursor-pointer rounded-control p-1.5 text-fg-secondary hover:bg-surface-hover hover:text-fg lg:hidden"
      >
        <Icon name="menu" className="size-5" />
      </button>
      <BrandMark className="lg:hidden" />

      <div className="ml-auto flex min-w-0 items-center gap-1.5 sm:gap-3">
        {/* A paused account is always visible; the full explanation is in the banner below. */}
        {frozen && (
          <Link to="/app/security" className="rounded-control" aria-label="Account status: changes paused. View security.">
            <Badge tone="warning" dot>Changes paused</Badge>
          </Link>
        )}
        <ConnectionIndicator />
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  );
}
