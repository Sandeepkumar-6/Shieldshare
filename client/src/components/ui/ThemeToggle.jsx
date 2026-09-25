import { useTheme } from '../../state/ThemeContext.jsx';
import { Icon } from './Icon.jsx';
import { Tooltip } from './Tooltip.jsx';

// Switches between the dark (default) and light themes.
export function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'light' ? 'dark' : 'light';
  return (
    <Tooltip content={`Switch to ${next} theme`} side="bottom">
      <button
        type="button"
        onClick={toggle}
        aria-label={`Switch to ${next} theme`}
        className={`cursor-pointer rounded-control p-1.5 text-fg-secondary transition-colors hover:bg-surface-hover hover:text-fg ${className}`}
      >
        <Icon name={theme === 'light' ? 'moon' : 'sun'} className="size-[18px]" />
      </button>
    </Tooltip>
  );
}
