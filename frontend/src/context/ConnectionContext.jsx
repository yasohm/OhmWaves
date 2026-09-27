import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isNativeApp, needsServer, onNetworkError, pingServer } from '../lib/api';
import { useToast } from './ToastContext';

const ConnectionContext = createContext(null);

const OFFLINE_MODE_KEY = 'ohmwave:offline-mode';
export const readOfflineMode = () => { try { return localStorage.getItem(OFFLINE_MODE_KEY) === '1'; } catch { return false; } };
export const saveOfflineMode = (on) => { try { if (on) localStorage.setItem(OFFLINE_MODE_KEY, '1'); else localStorage.removeItem(OFFLINE_MODE_KEY); } catch { /* this session only */ } };

const RECHECK_MS = 20000;

/**
 * Offline mode for the phone app, like Spotify's: when the OhmWaves server can't be reached (or the listener
 * switches offline mode on), the app plays only music saved on the phone. The website always talks to its server.
 */
export function ConnectionProvider({ children, onNeedServer }) {
  const { notify } = useToast();
  const [offlineMode, setOfflineModeState] = useState(readOfflineMode);
  const [reachable, setReachable] = useState(true); // optimistic until a check fails
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);

  const offline = isNativeApp && (offlineMode || !reachable || needsServer());

  const check = useCallback(async () => {
    if (!isNativeApp || needsServer() || checkingRef.current) return false;
    checkingRef.current = true;
    setChecking(true);
    const ok = await pingServer();
    checkingRef.current = false;
    setChecking(false);
    setReachable(ok);
    return ok;
  }, []);

  // Check at start, when the network changes, when the app comes back to the front, and after failed requests.
  useEffect(() => {
    if (!isNativeApp) return undefined;
    check();
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    window.addEventListener('online', check);
    window.addEventListener('offline', check);
    document.addEventListener('visibilitychange', onVisible);
    const stopListening = onNetworkError(check);
    return () => {
      window.removeEventListener('online', check);
      window.removeEventListener('offline', check);
      document.removeEventListener('visibilitychange', onVisible);
      stopListening();
    };
  }, [check]);

  // While the server is unreachable, keep looking for it so the app comes back online by itself.
  useEffect(() => {
    if (reachable || offlineMode) return undefined;
    const timer = setInterval(check, RECHECK_MS);
    return () => clearInterval(timer);
  }, [reachable, offlineMode, check]);

  // Tell the listener when the app switches on its own (not when they flipped the switch themselves).
  const wasOffline = useRef(offline);
  useEffect(() => {
    if (offline === wasOffline.current) return;
    wasOffline.current = offline;
    if (offlineMode) return;
    notify(offline ? 'You’re offline. Playing music saved on this phone.' : 'Back online');
  }, [offline, offlineMode, notify]);

  const setOfflineMode = useCallback(async (on) => {
    saveOfflineMode(on);
    setOfflineModeState(on);
    if (on) { notify('Offline mode on. Only music saved on this phone will play.'); return; }
    if (needsServer()) { onNeedServer?.(); return; }
    notify((await check()) ? 'Offline mode off' : 'Offline mode off, but the OhmWaves server can’t be reached right now.');
  }, [check, notify, onNeedServer]);

  const value = useMemo(() => ({ offline, offlineMode, reachable, checking, check, setOfflineMode }),
    [offline, offlineMode, reachable, checking, check, setOfflineMode]);
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export const useConnection = () => useContext(ConnectionContext);
