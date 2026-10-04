import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { toRemoteTrack } from '../lib/tracks';
import { useToast } from './ToastContext';
import { useConnection } from './ConnectionContext';

const AiFilterContext = createContext(null);

const CACHE_KEY = 'ohmwave:ai-hidden';
const POLL_MS = 20000;
const readCache = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
    return { ids: Array.isArray(saved.ids) ? saved.ids : [], since: saved.since || '', enabled: saved.enabled !== false };
  } catch { return { ids: [], since: '', enabled: true }; }
};
const writeCache = (state) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); } catch { /* cache only */ } };

/**
 * Hides AI-generated songs. The server already leaves known ones out of search, home and recommendations;
 * this catches songs its background scan flags while you're looking at them, and your own "Mark as AI".
 */
export function AiFilterProvider({ children }) {
  const { notify } = useToast();
  const { offline } = useConnection();
  const initial = useMemo(readCache, []);
  const [hiddenIds, setHiddenIds] = useState(() => new Set(initial.ids));
  const [allowedIds, setAllowedIds] = useState(() => new Set()); // "Not AI" this session, before the server confirms
  const [enabled, setEnabledState] = useState(initial.enabled);
  const since = useRef(initial.since);

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const persist = useCallback((ids) => writeCache({ ids: [...ids].slice(-5000), since: since.current, enabled: enabledRef.current }), []);
  const updateHidden = useCallback((change) => setHiddenIds((current) => {
    const next = new Set(current);
    change(next);
    persist(next);
    return next;
  }), [persist]);

  /** Add songs known to be AI (e.g. the full list from the server). */
  const remember = useCallback((ids) => updateHidden((set) => ids.forEach((id) => set.add(id))), [updateHidden]);

  const poll = useCallback(async () => {
    try {
      const data = await api.get(`/api/ai-filter/flagged?since=${encodeURIComponent(since.current)}`);
      since.current = data.now || since.current;
      updateHidden((ids) => (data.tracks || []).forEach((t) => ids.add(t.videoId)));
    } catch { /* offline or server busy: try again next time */ }
  }, [updateHidden]);

  useEffect(() => {
    if (offline) return undefined;
    api.get('/api/ai-filter').then((s) => setEnabledState(s.enabled)).catch(() => {});
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [offline, poll]);

  const isHidden = useCallback((track) => enabled && !!track?.videoId && hiddenIds.has(track.videoId) && !allowedIds.has(track.videoId),
    [enabled, hiddenIds, allowedIds]);
  /** The list without AI songs (for search, home, albums and mixes). */
  const visible = useCallback((tracks) => (enabled ? tracks.filter((t) => !isHidden(t)) : tracks), [enabled, isHidden]);

  const mark = useCallback(async (track, verdict) => {
    if (offline) { notify('Marking songs needs your OhmWaves server. You’re offline right now.', { tone: 'error' }); return; }
    const id = track.videoId;
    const apply = (isAi) => {
      updateHidden((ids) => (isAi ? ids.add(id) : ids.delete(id)));
      setAllowedIds((current) => { const next = new Set(current); if (isAi) next.delete(id); else next.add(id); return next; });
    };
    apply(verdict === 'ai');
    try {
      await api.post('/api/ai-filter/mark', { track: toRemoteTrack(track), verdict });
      notify(verdict === 'ai' ? `Hid “${track.title}” as AI-generated` : `“${track.title}” will show again`);
    } catch (error) {
      apply(verdict !== 'ai');
      notify(error.message, { tone: 'error' });
    }
  }, [offline, notify, updateHidden]);

  const setEnabled = useCallback(async (on) => {
    setEnabledState(on);
    enabledRef.current = on;
    try {
      await api.post('/api/ai-filter', { enabled: on });
      updateHidden(() => {}); // save the new setting with the cache
      notify(on ? 'AI music filter on: only human-made music shows' : 'AI music filter off');
    } catch (error) {
      setEnabledState(!on);
      notify(error.message, { tone: 'error' });
    }
  }, [notify, updateHidden]);

  const value = useMemo(() => ({
    enabled, setEnabled, isHidden, visible, isAi: (track) => !!track?.videoId && hiddenIds.has(track.videoId) && !allowedIds.has(track.videoId),
    markAsAi: (track) => mark(track, 'ai'), markNotAi: (track) => mark(track, 'human'), refresh: poll, remember,
  }), [enabled, setEnabled, isHidden, visible, hiddenIds, allowedIds, mark, poll, remember]);

  return <AiFilterContext.Provider value={value}>{children}</AiFilterContext.Provider>;
}

export const useAiFilter = () => useContext(AiFilterContext);
