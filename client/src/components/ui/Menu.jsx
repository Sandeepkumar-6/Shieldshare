import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';

const MENU_WIDTH = 224;

// Action menu (WAI-ARIA menu button). Rendered in a portal with fixed positioning so it is
// never clipped by scrollable tables.
// Items: { label, icon, onSelect, tone, disabledReason, disabledHint }. A disabled item stays
// visible and explains itself (short hint inline, full reason on hover).
export function Menu({ label, items, triggerClassName = '', triggerContent }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const visible = items.filter(Boolean);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const estimatedHeight = visible.length * 40 + 12;
    const openUp = rect.bottom + estimatedHeight > window.innerHeight - 8 && rect.top > estimatedHeight;
    setPosition({
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
      top: openUp ? rect.top - estimatedHeight - 4 : rect.bottom + 4,
    });
  }, [open, visible.length]);

  // Focus the first available item once the menu is positioned and rendered.
  useEffect(() => {
    if (open && position) {
      menuRef.current?.querySelector('[role="menuitem"]:not([aria-disabled="true"])')?.focus();
    }
  }, [open, position]);

  useEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    function onPointerDown(event) {
      if (!menuRef.current?.contains(event.target) && !triggerRef.current?.contains(event.target)) close(false);
    }
    function onViewportChange() {
      close(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open, close]);

  function onMenuKeyDown(event) {
    const options = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const index = options.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[(index + 1) % options.length]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      options[(index - 1 + options.length) % options.length]?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className={`inline-flex cursor-pointer items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg ${triggerClassName || 'size-8'}`}
      >
        {triggerContent ?? <Icon name="more" className="size-4" />}
      </button>
      {open && position && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
          className="fixed z-50 rounded-card border border-line bg-surface-elevated p-1 shadow-raised animate-pop-in"
        >
          {visible.map((item) => {
            const disabled = Boolean(item.disabledReason);
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={disabled || undefined}
                title={item.disabledReason || undefined}
                onClick={() => {
                  if (disabled) return;
                  close(false);
                  item.onSelect();
                }}
                className={`flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left text-body focus:bg-surface-hover focus:outline-none ${
                  disabled
                    ? 'cursor-not-allowed text-fg-muted'
                    : `cursor-pointer hover:bg-surface-hover ${item.tone === 'danger' ? 'text-critical' : 'text-fg'}`
                }`}
              >
                {item.icon && <Icon name={item.icon} className="mt-0.5 size-4" />}
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  {disabled && (
                    <span className="block text-meta text-fg-muted">{item.disabledHint || 'Unavailable right now'}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
