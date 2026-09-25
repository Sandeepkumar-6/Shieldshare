import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { FrozenBanner } from '../components/layout/FrozenBanner.jsx';
import { Sidebar } from '../components/layout/Sidebar.jsx';
import { Topbar } from '../components/layout/Topbar.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';

function PageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading page</span>
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-4 w-80 max-w-full" />
      <Skeleton className="mt-2 h-40 w-full" />
    </div>
  );
}

export default function AppShell() {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    setNavOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-control focus:bg-surface-elevated focus:px-3 focus:py-2 focus:text-fg"
      >
        Skip to content
      </a>
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenNav={() => setNavOpen(true)} />
        <FrozenBanner />
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-6xl">
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
