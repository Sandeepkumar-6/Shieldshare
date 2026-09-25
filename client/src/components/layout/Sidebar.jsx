import { NavLink } from 'react-router';
import { useSimulatorAvailability } from '../../features/simulator/useSimulatorAvailability.js';
import { useAuth } from '../../state/AuthContext.jsx';
import { Icon } from '../ui/Icon.jsx';
import { BrandMark } from './BrandMark.jsx';

// Versions live in File Details (spec §28 removes the standalone Versions page).
const WORKSPACE = [
  { to: '/app', label: 'Overview', icon: 'overview', end: true },
  { to: '/app/files', label: 'Files', icon: 'folder' },
  { to: '/app/shares', label: 'File sharing', icon: 'link' },
  { to: '/app/activity', label: 'Activity', icon: 'activity' },
  { to: '/app/security', label: 'Security', icon: 'shield' },
  { to: '/app/assistant', label: 'Assistant', icon: 'assistant', userOnly: true },
];

// Skill §12 admin navigation plus detection settings and the audit log.
const ADMIN = [
  { to: '/admin', label: 'Overview', icon: 'overview', end: true },
  { to: '/admin/incidents', label: 'Incidents', icon: 'incident' },
  { to: '/admin/alerts', label: 'Alerts', icon: 'bell' },
  { to: '/admin/users', label: 'Users', icon: 'users' },
  { to: '/admin/files', label: 'Files', icon: 'folder' },
  { to: '/admin/quarantine', label: 'Quarantine', icon: 'lock' },
  { to: '/admin/recovery', label: 'Recovery', icon: 'restore' },
  { to: '/admin/analytics', label: 'Analytics', icon: 'chart' },
  { to: '/admin/shield-ai', label: 'Shield AI', icon: 'message' },
  { to: '/admin/detection', label: 'Detection', icon: 'sliders' },
  { to: '/admin/audit', label: 'Audit log', icon: 'audit' },
];

// Shown only when the server has the simulator enabled (its routes are 404 otherwise).
const SIMULATOR = { to: '/admin/simulator', label: 'Simulator', icon: 'activity' };

function NavSection({ title, items }) {
  return (
    <div className="flex flex-col gap-0.5">
      {title && <p className="px-2.5 pb-1.5 pt-4 text-meta font-medium text-fg-muted">{title}</p>}
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `group flex items-center gap-2.5 rounded-control px-2.5 py-2 text-body transition-colors duration-150 ${
            isActive
              ? 'bg-surface-elevated font-medium text-fg'
              : 'text-fg-secondary hover:bg-surface hover:text-fg'
          }`}
        >
          {({ isActive }) => (
            <>
              <Icon name={item.icon} className={`size-4 ${isActive ? 'text-accent' : 'text-fg-muted group-hover:text-fg-secondary'}`} />
              <span className="flex-1">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

function NavContent() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const simulator = useSimulatorAvailability(isAdmin);
  const workspace = isAdmin ? WORKSPACE.filter((item) => !item.userOnly) : WORKSPACE;
  return (
    <nav aria-label="Main" className="flex flex-col overflow-y-auto px-3 py-2">
      <NavSection items={workspace} />
      {isAdmin && <NavSection title="Administration" items={simulator ? [...ADMIN, SIMULATOR] : ADMIN} />}
    </nav>
  );
}

export function Sidebar({ open, onClose }) {
  return (
    <>
      {/* Desktop */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line-subtle bg-bg-secondary lg:flex">
        <div className="flex h-14 shrink-0 items-center px-5">
          <BrandMark />
        </div>
        <NavContent />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-overlay animate-fade-in" aria-hidden="true" onClick={onClose} />
          <aside
            aria-label="Navigation"
            className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-line bg-bg-secondary"
          >
            <div className="flex h-14 shrink-0 items-center justify-between px-4">
              <BrandMark />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close navigation"
                className="cursor-pointer rounded-control p-1.5 text-fg-muted hover:bg-surface-hover hover:text-fg"
              >
                <Icon name="close" className="size-5" />
              </button>
            </div>
            <NavContent />
          </aside>
        </div>
      )}
    </>
  );
}
