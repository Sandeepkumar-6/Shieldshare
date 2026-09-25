import { useAuth } from '../../state/AuthContext.jsx';
import { Icon } from '../ui/Icon.jsx';

// Spec §25, verbatim. Shown on every user page while user.status is FROZEN. It carries no
// risk scores, signals or incident details.
export const FROZEN_BANNER_TEXT = 'File changes are paused while ShieldShare reviews recent activity on your account. '
  + 'You can still view your files. Contact your administrator if you have questions.';

export function FrozenBanner() {
  const { user } = useAuth();
  if (user?.status !== 'FROZEN') return null;

  return (
    <div role="status" className="border-b border-warning/30 bg-warning/10 px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl items-start gap-3">
        <Icon name="pause" className="mt-0.5 size-4 text-warning" />
        <p className="text-body text-fg">{FROZEN_BANNER_TEXT}</p>
      </div>
    </div>
  );
}
