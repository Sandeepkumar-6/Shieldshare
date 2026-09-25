import { Suspense } from 'react';
import { Link, Outlet } from 'react-router';
import { BrandMark } from '../components/layout/BrandMark.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';

export default function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2 text-center">
          <Link to="/" className="rounded-control" aria-label="ShieldShare home"><BrandMark /></Link>
          <p className="text-meta text-fg-muted">Secure file sharing with ransomware detection and recovery</p>
        </div>
        <div className="rounded-dialog border border-line-subtle bg-surface p-6">
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <Outlet />
          </Suspense>
        </div>
        <nav aria-label="Legal" className="mt-6 flex justify-center gap-4 text-meta text-fg-muted">
          <Link to="/privacy" className="hover:text-fg">Privacy policy</Link>
          <Link to="/terms" className="hover:text-fg">Terms of service</Link>
        </nav>
      </div>
    </div>
  );
}
