import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

// Colour theme: dark is ShieldShare's default identity, light is opt-in. The choice is kept
// per browser (localStorage) and applied as <html data-theme>; index.html applies it before
// the first paint so a light-theme visitor never sees a dark flash.

const KEY = 'shieldshare.theme';
const ThemeContext = createContext({ theme: 'dark', setTheme: () => {}, toggle: () => {} });

function stored() {
  try {
    return window.localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

// Applied to the document synchronously, before React re-renders, so components that read the
// CSS tokens during render (charts) already see the new values.
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light') root.dataset.theme = 'light';
  else delete root.dataset.theme;
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(stored);

  useEffect(() => {
    applyTheme(theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f4f6f9' : '#0d1117');
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', theme);
  }, [theme]);

  const setTheme = useCallback((next) => {
    applyTheme(next);
    setThemeState(next);
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      /* storage unavailable: the choice lasts until reload */
    }
  }, []);
  const toggle = useCallback(() => setTheme(theme === 'light' ? 'dark' : 'light'), [theme, setTheme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
