import { useCallback, useEffect, useState } from 'react';
import { api, USER_ID, warmTrack } from '../lib/api';
import { normalizeTrack } from '../lib/tracks';

// Stale-while-revalidate: Home and Library share one feed; revisits are instant, then refresh quietly.
let cachedFeed = null;
let inflight = null;
const listeners = new Set();

async function fetchFeed() {
  if (!inflight) {
    inflight = api.get(`/api/home/${USER_ID}`).then((data) => {
      const sections = (data.sections || []).map((s) => ({
        ...s,
        // Reasons only add information in the personal mix, not in "Because you like X".
        tracks: (s.tracks || []).map((t) => normalizeTrack(s.id === 'for-you' ? t : { ...t, reason: null })),
      }));
      cachedFeed = { ...data, sections };
      (sections.find((s) => s.id === 'for-you') || sections[0])?.tracks.slice(0, 3).forEach(warmTrack);
      listeners.forEach((fn) => fn(cachedFeed));
      return cachedFeed;
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

export default function useHomeFeed({ refreshOnMount = true } = {}) {
  const [feed, setFeed] = useState(cachedFeed);
  const [status, setStatus] = useState(cachedFeed ? 'ready' : 'loading');
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchFeed();
      setStatus('ready');
    } catch {
      if (!cachedFeed) setStatus('error');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const onFeed = (value) => { setFeed(value); setStatus('ready'); };
    listeners.add(onFeed);
    if (refreshOnMount || !cachedFeed) reload();
    return () => listeners.delete(onFeed);
  }, [reload, refreshOnMount]);

  return { feed, status, refreshing, reload };
}
