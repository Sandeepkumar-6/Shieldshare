import { Suspense } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { BrandMark } from '../components/layout/BrandMark.jsx';
import { Button } from '../components/ui/Button.jsx';
import { Skeleton } from '../components/ui/Skeleton.jsx';
import { useAuth } from '../state/AuthContext.jsx';

// Public pages: landing, privacy policy, terms (skill §38, §43). No authentication needed;
// a signed-in visitor gets a link back into the app instead of the sign-in buttons.

export function PublicFooter() {
  return (
    <footer className="border-t border-line-subtle">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 py-6 text-meta text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p><span className="font-medium text-fg-secondary">Hackathon project.</span> ShieldShare is not a production service.</p>
        <nav aria-label="Legal" className="flex gap-4">
          <Link to="/privacy" className="hover:text-fg">Privacy</Link>
          <Link to="/terms" className="hover:text-fg">Terms</Link>
        </nav>
      </div>
    </footer>
  );
}

export default function PublicLayout() {
  const { phase, user } = useAuth();
  const { pathname } = useLocation();
  const signedIn = phase === 'authenticated';
  const landing = pathname === '/';
  return (
    <div className={`flex min-h-dvh flex-col bg-bg ${landing ? 'landing-theme' : ''}`}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-[70] focus:rounded-control focus:bg-surface-elevated focus:px-3 focus:py-2 focus:text-fg"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line-subtle bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link to="/" className="rounded-control" aria-label="ShieldShare home"><BrandMark /></Link>
          {landing && (
            <nav aria-label="Landing page" className="hidden items-center gap-6 lg:flex">
              <a href="#how-it-works" className="text-body text-fg-secondary hover:text-fg">How it works</a>
              <a href="#detection" className="text-body text-fg-secondary hover:text-fg">Detection</a>
              <a href="#recovery" className="text-body text-fg-secondary hover:text-fg">Recovery</a>
              <a href="#security" className="text-body text-fg-secondary hover:text-fg">Security</a>
            </nav>
          )}
          <nav aria-label="Account" className="flex items-center gap-1 sm:gap-2">
            {signedIn ? (
              <Button variant="primary" size="sm" to={user?.role === 'admin' ? '/admin' : '/app'}>Open ShieldShare</Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" to="/login">Sign in</Button>
                <Button variant="primary" size="sm" to="/register">Get started</Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        <Suspense fallback={<div className="mx-auto max-w-6xl px-4 py-10 sm:px-6"><Skeleton className="h-64 w-full" /></div>}>
          <Outlet />
        </Suspense>
      </main>
      <PublicFooter />
    </div>
  );
}
