import { useCallback, useEffect, useRef, useState } from 'react';

// Loads server state for a region of the page.
//   status: 'loading' (first load) | 'success' | 'error'
//   refreshing: true while reloading data that is already on screen
// Keeping the previous data during a reload avoids flashing skeletons after every action.
export function useAsync(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: undefined, error: null, refreshing: false });
  const [nonce, setNonce] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    setState((previous) => (previous.data === undefined
      ? { status: 'loading', data: undefined, error: null, refreshing: false }
      : { ...previous, refreshing: true }));

    loadRef.current().then(
      (data) => {
        if (active) setState({ status: 'success', data, error: null, refreshing: false });
      },
      (error) => {
        if (active) setState({ status: 'error', data: undefined, error, refreshing: false });
      },
    );
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);
  const setData = useCallback((updater) => {
    setState((previous) => ({
      ...previous,
      data: typeof updater === 'function' ? updater(previous.data) : updater,
    }));
  }, []);

  return { ...state, reload, setData };
}
