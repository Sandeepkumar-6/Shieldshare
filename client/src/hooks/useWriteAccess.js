import { useAuth } from '../state/AuthContext.jsx';

export const FROZEN_WRITE_REASON = 'File changes are paused while ShieldShare reviews recent activity on your account.';

// UX only: disables write controls for a frozen account (spec §25). The server enforces the
// same rule with 423 USER_FROZEN on every write endpoint.
export function useWriteAccess() {
  const { user } = useAuth();
  const frozen = user?.status === 'FROZEN';
  return {
    canWrite: !frozen,
    reason: frozen ? FROZEN_WRITE_REASON : null,
    hint: frozen ? 'Paused on your account' : null,
  };
}
