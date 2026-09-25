import { Link } from 'react-router';
import { Icon } from './Icon.jsx';
import { Spinner } from './Spinner.jsx';
import { Tooltip } from './Tooltip.jsx';

const VARIANTS = {
  primary: ['bg-accent text-accent-contrast border-transparent font-medium', 'hover:bg-accent-hover'],
  secondary: ['bg-surface-elevated text-fg border-line', 'hover:bg-surface-hover'],
  ghost: ['bg-transparent text-fg-secondary border-transparent', 'hover:bg-surface-hover hover:text-fg'],
  danger: ['bg-critical text-critical-contrast border-transparent font-medium', 'hover:bg-critical/85'],
  'danger-ghost': ['bg-transparent text-critical border-transparent', 'hover:bg-critical/10'],
};

const SIZES = {
  sm: 'h-8 px-2.5 gap-1.5 text-meta',
  md: 'h-9 px-3.5 gap-2 text-body',
  icon: 'size-8 justify-center',
};

// One button for the whole product (skill §51).
//  - `loading` shows a spinner and blocks clicks
//  - `disabledReason` keeps the button focusable (aria-disabled) and explains why it is
//    unavailable in a tooltip, e.g. while the account is frozen (spec §25)
export function Button({
  ref,
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  disabledReason,
  to,
  className = '',
  children,
  onClick,
  type = 'button',
  ...rest
}) {
  const blocked = disabled || loading || Boolean(disabledReason);
  const [base, hover] = VARIANTS[variant];
  const classes = [
    'inline-flex shrink-0 items-center rounded-control border font-medium whitespace-nowrap transition-[color,background-color,border-color,transform] duration-150 select-none',
    base,
    SIZES[size],
    blocked ? 'cursor-not-allowed opacity-50' : `cursor-pointer active:translate-y-px ${hover}`,
    className,
  ].join(' ');

  const content = (
    <>
      {loading ? <Spinner className="size-4" /> : icon ? <Icon name={icon} className="size-4" /> : null}
      {children}
    </>
  );

  if (to && !blocked) {
    return (
      <Link ref={ref} to={to} className={classes} {...rest}>
        {content}
      </Link>
    );
  }

  const renderButton = (describedBy) => (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled && !disabledReason}
      aria-disabled={blocked || undefined}
      aria-busy={loading || undefined}
      aria-describedby={describedBy}
      onClick={(event) => {
        if (blocked) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...rest}
    >
      {content}
    </button>
  );

  if (disabledReason) {
    return <Tooltip content={disabledReason}>{(props) => renderButton(props['aria-describedby'])}</Tooltip>;
  }
  return renderButton(undefined);
}
