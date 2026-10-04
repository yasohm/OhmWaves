import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUrl, isNativeApp, USER_ID } from '../lib/api';
import { libraryFileToTrack, normalizeTrack, toRemoteTrack } from '../lib/tracks';
import * as offline from '../lib/offline';
import { useToast } from './ToastContext';
import { useConnection } from './ConnectionContext';
import ConfirmDialog from '../components/ConfirmDialog';

const LibraryContext = createContext(null);

const SETTINGS_KEY = 'ohmwave:download-settings';
// Liked Songs are kept on the phone too, so the list still shows (and plays its downloads) offline.
const LIKES_KEY = 'ohmwave:likes-cache';
const readCachedLikes = () => { try { const list = JSON.parse(localStorage.getItem(LIKES_KEY) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } };
const cacheLikes = (list) => { try { localStorage.setItem(LIKES_KEY, JSON.stringify(list)); } catch { /* cache only */ } };
// Songs saved to the phone at the same time: enough to keep the connection busy without starving playback.
const PHONE_PARALLEL = 2;
const NEEDS_SERVER = 'needs your OhmWaves server. You’re offline right now.';
const readSettings = () => {
  try { return { format: 'mp3', quality: '320', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { format: 'mp3', quality: '320' }; }
};

export function LibraryProvider({ children }) {
  const { notify } = useToast();
  const { offline: isOffline } = useConnection();
  const [likes, setLikesState] = useState(() => (isNativeApp ? readCachedLikes() : []));
  const setLikes = useCallback((update) => setLikesState((current) => {
    const next = typeof update === 'function' ? update(current) : update;
    if (isNativeApp) cacheLikes(next);
    return next;
  }), []);
  const [files, setFiles] = useState([]);
  const [filesState, setFilesState] = useState('loading'); // loading | ready | error
  const [jobs, setJobs] = useState({});
  const [settings, setSettingsState] = useState(readSettings);
  const timersRef = useRef({});
  const [pendingDelete, setPendingDelete] = useState(null);
  // Phone app: `files` are downloads saved on this phone. Web: tracks in the server's downloads folder.
  const filesRef = useRef([]);
  const commitFiles = useCallback((next) => { filesRef.current = next; setFiles(next); }, []);
  const inFlightRef = useRef(new Set()); // videoIds being saved to the phone right now

  const refreshFiles = useCallback(async () => {
    if (isNativeApp) {
      commitFiles(await offline.readIndex());
      setFilesState('ready');
      return;
    }
    try {
      const data = await api.get('/api/library');
      setFiles(data.files || []);
      setFilesState('ready');
    } catch {
      setFilesState('error');
    }
  }, [commitFiles]);

  useEffect(() => {
    refreshFiles();
    api.get(`/api/likes/${USER_ID}`)
      .then((data) => setLikes((data.tracks || []).map((t) => normalizeTrack(t))))
      .catch(() => {}); // offline: keep the cached list
    const timers = timersRef.current;
    return () => Object.values(timers).forEach(clearInterval);
  }, [refreshFiles, setLikes]);

  // Songs saved before covers were stored on the phone (or whose cover failed) get it the next time we're online.
  const artRepairStarted = useRef(false);
  useEffect(() => {
    if (!isNativeApp || isOffline || filesState !== 'ready' || artRepairStarted.current) return;
    const missing = filesRef.current.filter((e) => !e.artUri && e.remoteCover);
    if (!missing.length) return;
    artRepairStarted.current = true;
    (async () => {
      for (const entry of missing) {
        const art = await offline.saveArtwork(entry);
        if (!art.artUri) continue;
        const next = filesRef.current.map((e) => (e.videoId === entry.videoId && !e.artUri ? { ...e, ...art } : e));
        commitFiles(next);
        offline.writeIndex(next);
      }
    })();
  }, [isOffline, filesState, commitFiles]);

  const likedIds = useMemo(() => new Set(likes.map((t) => t.id)), [likes]);
  const isLiked = useCallback((track) => !!track && likedIds.has(track.id), [likedIds]);

  const toggleLike = useCallback(async (track) => {
    if (isOffline) { notify(`Liking songs ${NEEDS_SERVER}`, { tone: 'error' }); return; }
    const wasLiked = likedIds.has(track.id);
    const liked = toRemoteTrack(track);
    setLikes((list) => (wasLiked ? list.filter((t) => t.id !== track.id) : [liked, ...list]));
    try {
      const body = { user_id: USER_ID, track_id: track.id, title: liked.title, artist: liked.artist, album: liked.album, cover: liked.cover };
      if (wasLiked) await api.delete('/api/likes', body); else await api.post('/api/likes', body);
      notify(wasLiked ? 'Removed from Liked Songs' : 'Added to Liked Songs');
    } catch (error) {
      setLikes((list) => (wasLiked ? [liked, ...list] : list.filter((t) => t.id !== track.id)));
      notify(error.message, { tone: 'error' });
    }
  }, [isOffline, likedIds, notify, setLikes]);

  const setSettings = useCallback((patch) => {
    setSettingsState((current) => {
      const next = { ...current, ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* preference only */ }
      return next;
    });
  }, []);

  const pollJob = useCallback((jobId, label) => {
    timersRef.current[jobId] = setInterval(async () => {
      try {
        const status = await api.get(`/api/download/status/${jobId}`);
        setJobs((all) => ({ ...all, [jobId]: { ...all[jobId], ...status, label } }));
        if (status.status !== 'completed') return;
        clearInterval(timersRef.current[jobId]);
        delete timersRef.current[jobId];
        refreshFiles();
        const failed = status.errors?.length || 0;
        if (failed && !status.completed) notify(`Couldn’t download ${label}.`, { tone: 'error' });
        else notify(failed ? `Downloaded ${status.completed} of ${status.total}. ${failed} failed.` : `${label} saved to your library`);
        setTimeout(() => setJobs((all) => { const { [jobId]: _done, ...rest } = all; return rest; }), 4000);
      } catch { /* keep polling; the server may be briefly busy */ }
    }, 1000);
  }, [notify, refreshFiles]);

  const addOffline = useCallback((entry) => {
    const next = [entry, ...filesRef.current.filter((e) => e.videoId !== entry.videoId)];
    commitFiles(next);
    offline.writeIndex(next);
  }, [commitFiles]);

  /**
   * Phone downloads: each song streams from the server straight into this phone's app storage. The server only
   * relays the audio and keeps no copy. Two songs transfer at a time.
   */
  const saveToPhone = useCallback(async (jobId, label, tracks) => {
    const parts = {}; // videoId -> fraction of that song received
    let saved = 0;
    let failed = 0;
    let nextIndex = 0;
    const update = (patch) => setJobs((all) => (all[jobId] ? { ...all, [jobId]: { ...all[jobId], ...patch } } : all));
    const report = () => update({ saved, failed, saving: Object.values(parts).reduce((sum, part) => sum + part, 0) });

    tracks.forEach((t) => inFlightRef.current.add(t.videoId));
    const worker = async () => {
      while (nextIndex < tracks.length) {
        const track = tracks[nextIndex];
        nextIndex += 1;
        const id = encodeURIComponent(track.videoId);
        parts[track.videoId] = 0;
        try {
          const { ext, file_url: fileUrl } = await api.get(`/api/offline/${id}`);
          addOffline(await offline.saveTrack(track, apiUrl(fileUrl), ext, (part) => { parts[track.videoId] = part; report(); }));
          saved += 1;
        } catch {
          failed += 1;
        }
        delete parts[track.videoId];
        inFlightRef.current.delete(track.videoId);
        report();
      }
    };
    update({ status: 'in_progress' });
    await Promise.all(Array.from({ length: Math.min(PHONE_PARALLEL, tracks.length) }, worker));

    update({ status: 'saved' });
    if (!saved) notify(`Couldn’t download ${label}. Check your connection to the OhmWaves server and try again.`, { tone: 'error' });
    else notify(failed ? `Saved ${saved} of ${tracks.length} to your phone. ${failed} failed.` : `${label} saved to your phone`);
    setTimeout(() => setJobs((all) => { const { [jobId]: _done, ...rest } = all; return rest; }), 4000);
  }, [addOffline, notify]);

  const offlineById = useMemo(() => new Map(isNativeApp ? files.map((e) => [e.videoId, offline.entryToTrack(e)]) : []), [files]);

  /** The downloaded copy of a track, if there is one, so it plays from disk. */
  const findLocal = useCallback((track) => {
    if (!track || track.relative_path || track.localUri) return null;
    if (isNativeApp) return offlineById.get(track.videoId) || null;
    // Prefer the server's copy of a track when it's already in the downloads folder.
    const title = track.title.toLowerCase();
    return files.find((f) => f.title.toLowerCase() === title) || null;
  }, [files, offlineById]);

  const download = useCallback(async (tracks) => {
    if (isOffline) { notify(`Downloading ${NEEDS_SERVER}`, { tone: 'error' }); return; }
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t.videoId && !findLocal(t) && !inFlightRef.current.has(t.videoId));
    if (!list.length) { notify(isNativeApp ? 'Already downloaded or downloading to this phone.' : 'These tracks are already on your device.'); return; }
    const label = list.length === 1 ? `“${list[0].title}”` : `${list.length} tracks`;
    notify(`Downloading ${label}…`);
    try {
      if (isNativeApp) {
        const jobId = `phone-${Date.now()}`;
        setJobs((all) => ({ ...all, [jobId]: { status: 'queued', total: list.length, saved: 0, label, device: true, ids: list.map((t) => t.videoId) } }));
        await saveToPhone(jobId, label, list);
        return;
      }
      // `thumbnail` makes the tagger embed square album art instead of a video frame.
      const payload = list.map((t) => ({ ...t, thumbnail: t.cover || undefined }));
      const data = await api.post('/api/download', { tracks: payload, format: settings.format, quality: settings.quality });
      setJobs((all) => ({ ...all, [data.job_id]: { status: 'queued', total: list.length, completed: 0, label, ids: list.map((t) => t.videoId) } }));
      pollJob(data.job_id, label);
    } catch (error) {
      notify(error.message, { tone: 'error' });
    }
  }, [findLocal, isOffline, notify, pollJob, saveToPhone, settings]);

  const deleteFile = useCallback(async (track) => {
    if (isNativeApp) {
      const entry = filesRef.current.find((e) => e.videoId === track.videoId);
      if (entry) await offline.removeTrack(entry);
      const next = filesRef.current.filter((e) => e !== entry);
      commitFiles(next);
      offline.writeIndex(next);
      notify(`Removed “${track.title}” from this phone`);
      return;
    }
    try {
      await api.post('/api/delete_file', { relative_path: track.relative_path });
      setFiles((list) => list.filter((f) => f.relative_path !== track.relative_path));
      notify(`Deleted “${track.title}”`);
    } catch (error) {
      notify(error.message, { tone: 'error' });
    }
  }, [commitFiles, notify]);

  /** Ask before deleting a file from disk; the dialog lives here so any screen can use it. */
  const requestDelete = useCallback((track) => setPendingDelete(track), []);

  const downloadedTracks = useMemo(() => files.map(isNativeApp ? offline.entryToTrack : libraryFileToTrack), [files]);

  /** Songs being downloaded right now, so playlist and album pages can show their progress. */
  const downloadingIds = useMemo(() => new Set(Object.values(jobs).filter((j) => !isJobDone(j)).flatMap((j) => j.ids || [])), [jobs]);

  /**
   * On the phone, use the saved copy of each song when there is one: it plays from disk and shows the saved cover
   * (online covers don't load offline).
   */
  const preferLocal = useCallback((tracks) => (isNativeApp ? tracks.map((t) => findLocal(t) || t) : tracks), [findLocal]);

  /** How much of a song list is downloaded: `{ total, saved, downloading }` (counting only downloadable songs). */
  const downloadStatus = useCallback((tracks) => {
    const songs = tracks.filter((t) => t.videoId || t.localUri || t.relative_path);
    const saved = songs.filter((t) => t.localUri || t.relative_path || findLocal(t)).length;
    const downloading = songs.filter((t) => downloadingIds.has(t.videoId) && !t.localUri && !findLocal(t)).length;
    return { total: songs.length, saved, downloading };
  }, [downloadingIds, findLocal]);

  const value = useMemo(() => ({
    likes, isLiked, toggleLike, files, downloadedTracks, filesState, refreshFiles,
    jobs, download, deleteFile, requestDelete, settings, setSettings, findLocal, preferLocal, downloadStatus,
  }), [likes, isLiked, toggleLike, files, downloadedTracks, filesState, refreshFiles, jobs, download, deleteFile, requestDelete, settings,
    setSettings, findLocal, preferLocal, downloadStatus]);

  return <LibraryContext.Provider value={value}>
    {children}
    <ConfirmDialog open={!!pendingDelete} title="Delete from this device?"
      message={pendingDelete ? `“${pendingDelete.title}” will be permanently removed from your downloads.` : ''}
      confirmLabel="Delete" onCancel={() => setPendingDelete(null)}
      onConfirm={() => { deleteFile(pendingDelete); setPendingDelete(null); }} />
  </LibraryContext.Provider>;
}

export const useLibrary = () => useContext(LibraryContext);

/** Whether a download job has finished (phone downloads end at 'saved', library downloads at 'completed'). */
export const isJobDone = (job) => job.status === (job.device ? 'saved' : 'completed');
