import { Navigate, Outlet, useLocation } from 'react-router';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/ui/States.jsx';
import { Button } from '../components/ui/Button.jsx';
import { useAuth } from '../state/AuthContext.jsx';

// Route guards are UX. Authorization is enforced by the API on every request (skill §44).

export function BootSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-dvh">
      <span className="sr-only">Loading ShieldShare</span>
      <div className="hidden w-60 shrink-0 flex-col gap-3 border-r border-line-subtle bg-bg-secondary p-4 lg:flex">
        <Skeleton className="mb-4 h-6 w-32" />
        {[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-8 w-full" />)}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="h-14 border-b border-line-subtle" />
        <div className="flex flex-col gap-4 p-6 lg:p-8">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}

// The server could not be reached while resuming a session. The token is kept.
function Unreachable() {
  const { bootError, retryBootstrap } = useAuth();
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <ErrorState title="ShieldShare is unavailable" error={bootError} onRetry={retryBootstrap} />
    </div>
  );
}

export function RequireAuth() {
  const { phase, endedReason } = useAuth();
  const location = useLocation();
  if (phase === 'loading') return <BootSkeleton />;
  if (phase === 'unreachable') return <Unreachable />;
  if (phase === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search, reason: endedReason }} />;
  }
  return <Outlet />;
}

export function PublicOnly() {
  const { phase } = useAuth();
  const location = useLocation();
  if (phase === 'loading') return <BootSkeleton />;
  if (phase === 'unreachable') return <Unreachable />;
  if (phase === 'authenticated') {
    const from = location.state?.from;
    return <Navigate to={typeof from === 'string' && from.startsWith('/') ? from : '/app'} replace />;
  }
  return <Outlet />;
}

export function RequireRole({ role }) {
  const { user } = useAuth();
  if (user?.role !== role) {
    return (
      <EmptyState
        icon="shield"
        title="You don't have access to this page"
        description="This area is for administrators. If you think you should have access, contact your administrator."
        action={<Button to="/app">Back to overview</Button>}
      />
    );
  }
  return <Outlet />;
}
