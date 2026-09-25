import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/ui/Toast.jsx';
import { ACCOUNT_FROZEN_EVENT, AUTH_EXPIRED_EVENT } from '../services/api.js';
import { authApi } from '../services/auth.service.js';
import { tokenStore } from '../services/tokenStore.js';

const AuthContext = createContext(null);
const FOCUS_REFRESH_MS = 30_000;

// Who is signed in, as reported by the server. The role and status here drive UX only; the
// API enforces both on every request.
export function AuthProvider({ children }) {
  const toast = useToast();
  const [state, setState] = useState({ phase: 'loading', user: null, endedReason: null });
  const lastRefresh = useRef(0);
  const statusRef = useRef(null);
  statusRef.current = state.user?.status ?? null;

  const signedOut = useCallback((endedReason = null) => {
    tokenStore.clear();
    setState({ phase: 'anonymous', user: null, endedReason });
  }, []);

  const applyUser = useCallback((user) => {
    const previous = statusRef.current;
    if (previous === 'FROZEN' && user.status === 'ACTIVE') {
      toast.success('File access restored', 'You can upload and change files again.');
    }
    setState({ phase: 'authenticated', user, endedReason: null });
  }, [toast]);

  const refreshUser = useCallback(async () => {
    if (!tokenStore.get()) return;
    lastRefresh.current = Date.now();
    try {
      applyUser(await authApi.me());
    } catch {
      /* 401 is handled by the auth-expired listener; other failures keep the current state */
    }
  }, [applyUser]);

  // Initial load: resume a stored session if the server still accepts it. Only an explicit
  // rejection (401/403) ends the session; an unreachable or failing server keeps the token
  // and shows a retryable error instead of signing the user out.
  const bootstrap = useCallback(() => {
    if (!tokenStore.get()) {
      setState({ phase: 'anonymous', user: null, endedReason: null });
      return;
    }
    setState({ phase: 'loading', user: null, endedReason: null });
    authApi.me().then(
      (user) => setState({ phase: 'authenticated', user, endedReason: null }),
      (error) => {
        if (error?.status === 401 || error?.status === 403) {
          signedOut(error.status === 401 ? error.message : null);
        } else {
          setState({ phase: 'unreachable', user: null, endedReason: null, error });
        }
      },
    );
  }, [signedOut]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Server-driven changes: session revoked/expired (401) and account frozen (423).
  useEffect(() => {
    const onExpired = (event) => {
      if (!tokenStore.get()) return;
      signedOut(event.detail?.message || 'Your session has ended. Sign in again.');
    };
    const onFrozen = () => refreshUser();
    const onFocus = () => {
      if (Date.now() - lastRefresh.current > FOCUS_REFRESH_MS) refreshUser();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired);
    window.addEventListener(ACCOUNT_FROZEN_EVENT, onFrozen);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired);
      window.removeEventListener(ACCOUNT_FROZEN_EVENT, onFrozen);
      window.removeEventListener('focus', onFocus);
    };
  }, [signedOut, refreshUser]);

  const login = useCallback(async (credentials) => {
    const { user, accessToken } = await authApi.login(credentials);
    tokenStore.set(accessToken);
    lastRefresh.current = Date.now();
    setState({ phase: 'authenticated', user, endedReason: null });
    return user;
  }, []);

  const register = useCallback(async (details) => {
    const { user, accessToken } = await authApi.register(details);
    tokenStore.set(accessToken);
    lastRefresh.current = Date.now();
    setState({ phase: 'authenticated', user, endedReason: null });
    return user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      /* the local session ends regardless */
    }
    signedOut();
  }, [signedOut]);

  const value = useMemo(() => ({
    phase: state.phase,
    user: state.user,
    endedReason: state.endedReason,
    bootError: state.error ?? null,
    retryBootstrap: bootstrap,
    login,
    register,
    logout,
    refreshUser,
    endLocalSession: signedOut,
  }), [state, login, register, logout, refreshUser, signedOut, bootstrap]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
