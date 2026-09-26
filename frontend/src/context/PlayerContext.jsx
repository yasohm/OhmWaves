import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, apiUrl, encodePath, sendQuietly, USER_ID, warmTrack } from '../lib/api';
import { durationToSeconds, normalizeTrack, shuffleArray } from '../lib/tracks';
import { useLibrary } from './LibraryContext';
import { useToast } from './ToastContext';

const PlayerContext = createContext(null);
const ProgressContext = createContext(null); // split out: updates ~4x/second

const VOLUME_KEY = 'ohmwave:volume';
const readVolume = () => { try { const v = Number(localStorage.getItem(VOLUME_KEY)); return Number.isFinite(v) && localStorage.getItem(VOLUME_KEY) !== null ? v : 0.9; } catch { return 0.9; } };

let qidCounter = 0;
const withQid = (track, extra = {}) => { qidCounter += 1; return { ...track, ...extra, qid: qidCounter }; };

const isTypingTarget = (el) => el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(el.tagName));

export function PlayerProvider({ children }) {
  const { findLocal } = useLibrary();
  const { notify } = useToast();
  const audioRef = useRef(null);
  /** One <audio> element for the app's lifetime, created on first use. */
  const getAudio = useCallback(() => { if (!audioRef.current) audioRef.current = new Audio(); return audioRef.current; }, []);
  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setBuffering] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState('off'); // off | all | one
  const [source, setSource] = useState('');
  const [volume, setVolumeState] = useState(readVolume);
  const [progress, setProgress] = useState({ time: 0, duration: 0 });

  const current = queue[index] || null;
  const state = useRef({});
  // Latest state for event handlers and async callbacks, without re-subscribing listeners.
  useLayoutEffect(() => { state.current = { queue, index, repeat, shuffle, current, findLocal }; });
  const listen = useRef({ track: null, ms: 0, last: null, started: false });
  const fetchingMore = useRef(false);
  const errorStreak = useRef(0);
  const unshuffled = useRef(null);

  // ---------------------------------------------------------------- telemetry
  /** Report how the last track was consumed so recommendations learn from plays and skips. */
  const finalizeListen = useCallback((reason) => {
    const { track, ms, started } = listen.current;
    listen.current = { track: null, ms: 0, last: null, started: false };
    if (!track || !started || (ms < 1000 && reason !== 'skip')) return;
    const durationMs = Math.round((getAudio().duration || durationToSeconds(track.duration)) * 1000) || 0;
    const completed = reason === 'ended';
    sendQuietly('/api/events', {
      user_id: USER_ID, track_id: track.id, title: track.title, artist: track.artist,
      album: track.album || '', cover: track.cover, ms_played: Math.round(ms), duration_ms: durationMs,
      completed, skipped: reason === 'skip' && !completed,
    });
  }, [getAudio]);

  // --------------------------------------------------------------- navigation
  const goTo = useCallback((nextIndex, reason) => {
    finalizeListen(reason);
    if (nextIndex === state.current.index) {
      listen.current = { track: state.current.current, ms: 0, last: null, started: true };
      getAudio().currentTime = 0;
      getAudio().play().catch(() => {});
      return;
    }
    setIndex(nextIndex);
  }, [getAudio, finalizeListen]);

  /** Autoplay: ask the recommender what should follow the current track. */
  const fetchMore = useCallback(async () => {
    const { current: seed, queue: q } = state.current;
    if (!seed || fetchingMore.current) return 0;
    fetchingMore.current = true;
    try {
      const data = await api.post(`/api/recommendations/${USER_ID}/next`, {
        seed: { videoId: seed.videoId, title: seed.title, artist: seed.artist },
        exclude: q.map((t) => t.id), limit: 10,
      });
      const known = new Set(state.current.queue.map((t) => t.id));
      const added = (data.tracks || []).map((t) => normalizeTrack(t)).filter((t) => t.videoId && !known.has(t.id))
        .map((t) => withQid(t, { autoplay: true }));
      if (added.length) setQueue((list) => [...list, ...added]);
      return added.length;
    } catch {
      return 0;
    } finally {
      fetchingMore.current = false;
    }
  }, []);

  const next = useCallback(async (userInitiated = true) => {
    const { queue: q, index: i, repeat: r } = state.current;
    const reason = userInitiated ? 'skip' : 'ended';
    if (i < q.length - 1) return goTo(i + 1, reason);
    if (r === 'all' && q.length) return goTo(0, reason);
    finalizeListen(reason);
    const added = await fetchMore();
    if (added) setIndex(state.current.index + 1);
    else { getAudio().pause(); if (!userInitiated) getAudio().currentTime = 0; }
    return undefined;
  }, [getAudio, fetchMore, finalizeListen, goTo]);

  const previous = useCallback(() => {
    const { index: i } = state.current;
    if (getAudio().currentTime > 3 || i <= 0) { getAudio().currentTime = 0; return; }
    goTo(i - 1, 'switch');
  }, [getAudio, goTo]);

  const togglePlay = useCallback(() => {
    if (!state.current.current) return;
    if (getAudio().paused) getAudio().play().catch(() => notify('Playback was blocked. Tap play again.', { tone: 'error' }));
    else getAudio().pause();
  }, [getAudio, notify]);

  /** Play a list starting at `startIndex`. Tapping the current song toggles play/pause instead. */
  const playFrom = useCallback((tracks, startIndex = 0, label = '') => {
    const chosen = tracks[startIndex];
    if (!chosen) return;
    if (state.current.current?.id === chosen.id) { togglePlay(); return; }
    finalizeListen('switch');
    let list = tracks.map((t) => withQid(t));
    let start = startIndex;
    unshuffled.current = null;
    if (state.current.shuffle) {
      unshuffled.current = list;
      list = [list[startIndex], ...shuffleArray(list.filter((_, i) => i !== startIndex))];
      start = 0;
    }
    setQueue(list);
    setIndex(start);
    setSource(label);
  }, [finalizeListen, togglePlay]);

  const shufflePlay = useCallback((tracks, label = '') => {
    if (!tracks.length) return;
    finalizeListen('switch');
    const list = tracks.map((t) => withQid(t));
    unshuffled.current = list;
    setShuffle(true);
    setQueue(shuffleArray(list));
    setIndex(0);
    setSource(label);
  }, [finalizeListen]);

  /** Insert into the queue; with nothing playing, the track simply starts. */
  const insertTrack = useCallback((track, position) => {
    const { queue: q, index: i } = state.current;
    const item = withQid(track);
    if (!q.length) { setQueue([item]); setIndex(0); setSource(''); return; }
    const at = Math.min(position(q, i), q.length);
    setQueue([...q.slice(0, at), item, ...q.slice(at)]);
  }, []);

  const playNext = useCallback((track) => {
    insertTrack(track, (_, i) => i + 1);
    notify(`“${track.title}” will play next`);
  }, [insertTrack, notify]);

  const addToQueue = useCallback((track) => {
    // User-queued songs go before autoplay suggestions, like Spotify.
    insertTrack(track, (q, i) => { const auto = q.findIndex((t, n) => n > i && t.autoplay); return auto === -1 ? q.length : auto; });
    notify(`Added “${track.title}” to queue`);
  }, [insertTrack, notify]);

  const removeFromQueue = useCallback((qid) => {
    const i = state.current.queue.findIndex((t) => t.qid === qid);
    if (i === -1 || i === state.current.index) return;
    setQueue(state.current.queue.filter((t) => t.qid !== qid));
    if (i < state.current.index) setIndex(state.current.index - 1);
  }, []);

  const jumpTo = useCallback((qid) => {
    const i = state.current.queue.findIndex((t) => t.qid === qid);
    if (i !== -1) goTo(i, 'skip');
  }, [goTo]);

  const toggleShuffle = useCallback(() => {
    const { queue: q, index: i, shuffle: on } = state.current;
    const played = q.slice(0, i + 1);
    const upcoming = q.slice(i + 1);
    if (!on) {
      unshuffled.current = q;
      setQueue([...played, ...shuffleArray(upcoming)]);
    } else if (unshuffled.current) {
      const pending = new Set(upcoming.map((t) => t.qid));
      const ordered = unshuffled.current.filter((t) => pending.has(t.qid));
      const extra = upcoming.filter((t) => !ordered.includes(t));
      setQueue([...played, ...ordered, ...extra]);
      unshuffled.current = null;
    }
    setShuffle(!on);
  }, []);

  const cycleRepeat = useCallback(() => setRepeat((r) => ({ off: 'all', all: 'one', one: 'off' }[r])), []);

  const seek = useCallback((seconds) => {
    if (!Number.isFinite(seconds)) return;
    getAudio().currentTime = seconds;
    listen.current.last = null;
    setProgress((p) => ({ ...p, time: seconds }));
  }, [getAudio]);

  const setVolume = useCallback((value) => {
    const v = Math.max(0, Math.min(1, value));
    getAudio().volume = v;
    setVolumeState(v);
    try { localStorage.setItem(VOLUME_KEY, String(v)); } catch { /* preference only */ }
  }, [getAudio]);

  // ------------------------------------------------------------ audio engine
  const nextRef = useRef(next);
  useLayoutEffect(() => { nextRef.current = next; });

  useEffect(() => {
    const audio = getAudio();
    audio.preload = 'auto';
    audio.volume = readVolume();
    const on = {
      play: () => setIsPlaying(true),
      pause: () => setIsPlaying(false),
      waiting: () => setBuffering(true),
      playing: () => { setBuffering(false); listen.current.started = true; errorStreak.current = 0; },
      canplay: () => setBuffering(false),
      durationchange: () => setProgress((p) => ({ ...p, duration: audio.duration || p.duration })),
      timeupdate: () => {
        const t = audio.currentTime;
        const l = listen.current;
        if (l.last !== null && t > l.last && t - l.last < 1.5) l.ms += (t - l.last) * 1000;
        l.last = t;
        setProgress({ time: t, duration: audio.duration || 0 });
      },
      seeking: () => { listen.current.last = null; },
      ended: () => {
        if (state.current.repeat === 'one') { goTo(state.current.index, 'ended'); return; }
        nextRef.current(false);
      },
      error: () => {
        if (!audio.getAttribute('src')) return;
        setBuffering(false);
        const title = state.current.current?.title || 'this track';
        errorStreak.current += 1;
        const canSkip = errorStreak.current < 3 && state.current.index < state.current.queue.length - 1;
        notify(canSkip ? `Couldn’t play “${title}”. Skipping…` : `Couldn’t play “${title}”.`, { tone: 'error' });
        if (canSkip) setTimeout(() => nextRef.current(false), 1200);
      },
    };
    Object.entries(on).forEach(([event, handler]) => audio.addEventListener(event, handler));
    const flush = () => finalizeListen('switch');
    window.addEventListener('pagehide', flush);
    return () => {
      Object.entries(on).forEach(([event, handler]) => audio.removeEventListener(event, handler));
      window.removeEventListener('pagehide', flush);
    };
  }, [getAudio, finalizeListen, goTo, notify]);

  // Load a new track whenever the queue position changes.
  const currentQid = current?.qid;
  useEffect(() => {
    const audio = getAudio();
    const track = state.current.current;
    if (!track) { audio.pause(); audio.removeAttribute('src'); return; }
    const local = track.relative_path ? track : state.current.findLocal(track);
    const url = local?.relative_path
      ? apiUrl(`/api/stream/${encodePath(local.relative_path)}`)
      : track.videoId ? apiUrl(`/api/listen/${track.videoId}`) : null;
    if (!url) { notify('This track can’t be played.', { tone: 'error' }); return; }
    listen.current = { track, ms: 0, last: null, started: false };
    setProgress({ time: 0, duration: durationToSeconds(track.duration) });
    setBuffering(true);
    audio.src = url;
    audio.play().catch((error) => {
      if (error.name === 'NotAllowedError') { setBuffering(false); setIsPlaying(false); }
    });
  }, [getAudio, currentQid, notify]);

  // Keep autoplay one step ahead and pre-resolve the next stream so skips feel instant.
  useEffect(() => {
    if (index < 0) return;
    if (queue.length - index - 1 <= 1 && repeat === 'off') fetchMore();
    const upcoming = queue[index + 1];
    if (upcoming && !findLocal(upcoming)) warmTrack(upcoming);
  }, [index, queue, repeat, fetchMore, findLocal]);

  // Lock screen, headset buttons and hardware media keys.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !current) return;
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title: current.title, artist: current.artist, album: current.album || '',
      artwork: current.cover ? [{ src: current.cover, sizes: '512x512' }] : [],
    });
    const handlers = {
      play: () => getAudio().play(), pause: () => getAudio().pause(),
      previoustrack: () => previous(), nexttrack: () => next(true),
      seekto: (details) => seek(details.seekTime),
    };
    Object.entries(handlers).forEach(([action, handler]) => { try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported */ } });
  }, [getAudio, current, next, previous, seek]);

  useEffect(() => {
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  // Space toggles playback anywhere except while typing or on a focused control.
  useEffect(() => {
    const onKey = (event) => {
      if (event.code !== 'Space' || isTypingTarget(event.target) || event.repeat) return;
      event.preventDefault();
      togglePlay();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay]);

  const isCurrent = useCallback((track) => !!current && !!track && current.id === track.id, [current]);

  const value = useMemo(() => ({
    current, queue, index, isPlaying, isBuffering, shuffle, repeat, source, volume,
    playFrom, shufflePlay, togglePlay, next, previous, playNext, addToQueue, removeFromQueue, jumpTo,
    toggleShuffle, cycleRepeat, setVolume, isCurrent,
  }), [current, queue, index, isPlaying, isBuffering, shuffle, repeat, source, volume, playFrom, shufflePlay,
    togglePlay, next, previous, playNext, addToQueue, removeFromQueue, jumpTo, toggleShuffle, cycleRepeat, setVolume, isCurrent]);

  const progressValue = useMemo(() => ({ ...progress, seek }), [progress, seek]);

  return <PlayerContext.Provider value={value}>
    <ProgressContext.Provider value={progressValue}>{children}</ProgressContext.Provider>
  </PlayerContext.Provider>;
}

export const usePlayer = () => useContext(PlayerContext);
export const useProgress = () => useContext(ProgressContext);
