import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { useToast } from '../components/ui/Toast.jsx';
import { tokenStore } from '../services/tokenStore.js';
import { useAuth } from './AuthContext.jsx';

// One Socket.IO connection per signed-in session (spec §19, api-contract §4).
//  - connects after sign-in with the access token; disconnects on sign-out
//  - de-duplicates events by eventId (a small LRU)
//  - exposes the connection state for the Topbar indicator
//  - after a reconnect, pages refetch server state (useLiveRefresh); missed events are never
//    replayed, so nothing on screen depends on having seen every event
// The server decides who receives what (rooms); nothing here widens access.

const SOCKET_URL = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/+$/, '');
const SEEN_LIMIT = 500;

const SocketApiContext = createContext(null);
const SocketStatusContext = createContext('offline');

const ALERT_TONE = { CRITICAL: 'critical', HIGH: 'danger', SUSPICIOUS: 'warning', INFO: 'info' };

export function SocketProvider({ children }) {
  const { phase, user, refreshUser } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('offline'); // offline | connecting | connected | reconnecting
  const listeners = useRef(new Map());
  const reconnectListeners = useRef(new Set());
  const seen = useRef({ ids: new Set(), order: [] });

  const signedIn = phase === 'authenticated';
  const userId = user?.id ?? null;
  const isAdmin = user?.role === 'admin';

  const subscribe = useCallback((event, handler) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set());
    listeners.current.get(event).add(handler);
    return () => listeners.current.get(event)?.delete(handler);
  }, []);

  const onReconnect = useCallback((handler) => {
    reconnectListeners.current.add(handler);
    return () => reconnectListeners.current.delete(handler);
  }, []);

  const dispatch = useCallback((event, envelope) => {
    if (!envelope || typeof envelope.eventId !== 'string') return;
    const memo = seen.current;
    if (memo.ids.has(envelope.eventId)) return;
    memo.ids.add(envelope.eventId);
    memo.order.push(envelope.eventId);
    if (memo.order.length > SEEN_LIMIT) memo.ids.delete(memo.order.shift());
    for (const handler of [...(listeners.current.get(event) ?? [])]) {
      try {
        handler(envelope.data, envelope, event);
      } catch (error) {
        console.error(`[socket] ${event} handler failed`, error);
      }
    }
  }, []);

  useEffect(() => {
    const token = tokenStore.get();
    if (!signedIn || !userId || !token) {
      setStatus('offline');
      return undefined;
    }

    const socket = io(SOCKET_URL, { auth: { token }, reconnectionDelayMax: 10_000 });
    let connectedBefore = false;
    setStatus('connecting');

    socket.on('connect', () => {
      setStatus('connected');
      if (connectedBefore) reconnectListeners.current.forEach((handler) => handler());
      connectedBefore = true;
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        // The server ended this connection (session revoked or expired). REST decides whether
        // the session is over: a 401 there signs the user out.
        setStatus('offline');
        refreshUser();
      } else if (reason !== 'io client disconnect') {
        setStatus('reconnecting');
      }
    });
    socket.on('connect_error', (error) => {
      if (error?.message === 'SESSION_REVOKED' || error?.message === 'UNAUTHENTICATED') {
        setStatus('offline');
        refreshUser();
      } else {
        setStatus(connectedBefore ? 'reconnecting' : 'connecting');
      }
    });
    socket.onAny(dispatch);

    return () => {
      socket.offAny(dispatch);
      socket.removeAllListeners();
      socket.close();
    };
  }, [signedIn, userId, dispatch, refreshUser]);

  // App-wide reactions. The user's own notices carry only { notice } (spec §25): refreshing
  // the account updates the banner and every write control at once.
  useEffect(() => {
    const offFrozen = subscribe('user.frozen', (data) => {
      if (data?.notice) refreshUser();
    });
    const offUnfrozen = subscribe('user.unfrozen', (data) => {
      if (data?.notice) refreshUser();
    });
    const offAlert = subscribe('security.alert', (data) => {
      if (!isAdmin || !data) return;
      toast.show({
        tone: ALERT_TONE[data.severity] ?? 'info',
        title: data.title,
        description: data.incidentNumber ? `${data.incidentNumber} · ${data.severity}` : data.severity,
        action: data.incidentId
          ? { label: 'Open incident', to: `/admin/incidents/${data.incidentId}` }
          : { label: 'View alerts', to: '/admin/alerts' },
      });
    });
    return () => {
      offFrozen();
      offUnfrozen();
      offAlert();
    };
  }, [subscribe, refreshUser, toast, isAdmin]);

  const api = useMemo(() => ({ subscribe, onReconnect }), [subscribe, onReconnect]);

  return (
    <SocketApiContext.Provider value={api}>
      <SocketStatusContext.Provider value={status}>{children}</SocketStatusContext.Provider>
    </SocketApiContext.Provider>
  );
}

export function useSocketStatus() {
  return useContext(SocketStatusContext);
}

/**
 * Calls handler(data, envelope, eventName) for each (de-duplicated) event.
 * @param {string|string[]} events
 */
export function useSocketEvent(events, handler) {
  const api = useContext(SocketApiContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const key = [].concat(events).join('|');

  useEffect(() => {
    if (!api) return undefined;
    const offs = key.split('|').map((name) => api.subscribe(name, (...args) => handlerRef.current(...args)));
    return () => offs.forEach((off) => off());
  }, [api, key]);
}

export function useOnReconnect(handler) {
  const api = useContext(SocketApiContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => (api ? api.onReconnect(() => handlerRef.current()) : undefined), [api]);
}

/**
 * Reloads server state when one of `events` arrives (debounced, so a burst of events causes
 * one refetch) and after every reconnect.
 * @param {string|string[]} events
 * @param {() => void} reload
 * @param {{ filter?: (data, eventName) => boolean, delay?: number }} options
 */
export function useLiveRefresh(events, reload, { filter, delay = 400 } = {}) {
  const timer = useRef(null);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const trigger = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => reloadRef.current(), delay);
  }, [delay]);

  useSocketEvent(events, (data, envelope, name) => {
    if (!filterRef.current || filterRef.current(data, name)) trigger();
  });
  useOnReconnect(trigger);
  useEffect(() => () => clearTimeout(timer.current), []);
}

// User pages: reload when the signed-in account's own freeze notice arrives (the user room's
// { notice }-only events), so "Under review" states and write controls update live.
export function useAccountNoticeRefresh(reload) {
  useLiveRefresh(['user.frozen', 'user.unfrozen'], reload, { filter: (data) => Boolean(data?.notice) });
}
