import { useRef } from 'react';

// Accessible tab list (WAI-ARIA tabs pattern, manual activation with arrow-key focus).
// The caller renders the active panel with <TabPanel>.
export function Tabs({ idPrefix, tabs, value, onChange, label }) {
  const refs = useRef({});

  function focusTab(index) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    refs.current[tab.id]?.focus();
  }

  function onKeyDown(event, index) {
    if (event.key === 'ArrowRight') focusTab(index + 1);
    else if (event.key === 'ArrowLeft') focusTab(index - 1);
    else if (event.key === 'Home') focusTab(0);
    else if (event.key === 'End') focusTab(tabs.length - 1);
    else return;
    event.preventDefault();
  }

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-line-subtle">
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(node) => { refs.current[tab.id] = node; }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`-mb-px cursor-pointer border-b-2 px-3 py-2.5 text-body whitespace-nowrap transition-colors duration-150 ${
              selected
                ? 'border-accent font-medium text-fg'
                : 'border-transparent text-fg-secondary hover:text-fg'
            }`}
          >
            {tab.label}
            {tab.count != null && <span className="ml-1.5 text-meta text-fg-muted tabular">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, id, children }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel-${id}`} aria-labelledby={`${idPrefix}-tab-${id}`} className="pt-5">
      {children}
    </div>
  );
}
