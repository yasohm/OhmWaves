import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUrl, isNativeApp, USER_ID } from '../lib/api';
import { libraryFileToTrack, normalizeTrack } from '../lib/tracks';
import * as offline from '../lib/offline';
import { useToast } from './ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';

const LibraryContext = createContext(null);

const SETTINGS_KEY = 'ohmwave:download-settings';
const readSettings = () => {
  try { return { format: 'mp3', quality: '320', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { format: 'mp3', quality: '320' }; }
};

export function LibraryProvider({ children }) {
  const { notify } = useToast();
  const [likes, setLikes] = useState([]);
  const [files, setFiles] = useState([]);
  const [filesState, setFilesState] = useState('loading'); // loading | ready | error
  const [jobs, setJobs] = useState({});
  const [settings, setSettingsState] = useState(readSettings);
  const timersRef = useRef({});
  const [pendingDelete, setPendingDelete] = useState(null);
  // Phone app: `files` are downloads saved on this phone. Web: tracks in the server's downloads folder.
  const filesRef = useRef([]);
  const commitFiles = useCallback((next) => { filesRef.current = next; setFiles(next); }, []);

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
      .catch(() => {});
    const timers = timersRef.current;
    return () => Object.values(timers).forEach(clearInterval);
  }, [refreshFiles]);

  const likedIds = useMemo(() => new Set(likes.map((t) => t.id)), [likes]);
  const isLiked = useCallback((track) => !!track && likedIds.has(track.id), [likedIds]);

  const toggleLike = useCallback(async (track) => {
    const wasLiked = likedIds.has(track.id);
    setLikes((list) => (wasLiked ? list.filter((t) => t.id !== track.id) : [track, ...list]));
    try {
      const body = { user_id: USER_ID, track_id: track.id, title: track.title, artist: track.artist, album: track.album || '', cover: track.cover };
      if (wasLiked) await api.delete('/api/likes', body); else await api.post('/api/likes', body);
      notify(wasLiked ? 'Removed from Liked Songs' : 'Added to Liked Songs');
    } catch (error) {
      setLikes((list) => (wasLiked ? [track, ...list] : list.filter((t) => t.id !== track.id)));
      notify(error.message, { tone: 'error' });
    }
  }, [likedIds, notify]);

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
        setJobs((all) => ({ ...all, [jobId]: { ...status, label } }));
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
   * Phone downloads: the server converts each track into a temporary folder, the phone copies it into app
   * storage as soon as it's ready, then the server deletes its copy.
   */
  const pollDeviceJob = useCallback((jobId, label, tracks) => {
    const byId = new Map(tracks.map((t) => [t.videoId, t]));
    const started = new Set();
    let transfers = Promise.resolve();
    let saved = 0;
    let lostOnTheWay = 0;
    let finishing = false;
    const update = (patch) => setJobs((all) => (all[jobId] ? { ...all, [jobId]: { ...all[jobId], ...patch } } : all));

    timersRef.current[jobId] = setInterval(async () => {
      if (finishing) return;
      let status;
      try { status = await api.get(`/api/download/status/${jobId}`); } catch { return; } // server busy; retry next tick
      (status.files || []).forEach((file, i) => {
        if (started.has(i)) return;
        started.add(i);
        transfers = transfers.then(async () => {
          try {
            const track = { ...file, ...byId.get(file.videoId) };
            addOffline(await offline.saveTrack(track, apiUrl(file.file_url), file.ext, (part) => update({ saving: part })));
            saved += 1;
          } catch {
            lostOnTheWay += 1;
          }
          update({ saved, saving: 0 });
        });
      });
      update({ ...status, label, saved });
      if (status.status !== 'completed') return;

      finishing = true;
      clearInterval(timersRef.current[jobId]);
      delete timersRef.current[jobId];
      await transfers;
      api.delete(`/api/download/${jobId}`).catch(() => {}); // the server also purges leftovers after a few hours
      update({ status: 'saved' });
      const failed = (status.errors?.length || 0) + lostOnTheWay;
      if (!saved) notify(`Couldn’t download ${label}.`, { tone: 'error' });
      else notify(failed ? `Saved ${saved} of ${status.total} to your phone. ${failed} failed.` : `${label} saved to your phone`);
      setTimeout(() => setJobs((all) => { const { [jobId]: _done, ...rest } = all; return rest; }), 4000);
    }, 1000);
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
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t.videoId && !findLocal(t));
    if (!list.length) { notify(isNativeApp ? 'Already downloaded to this phone.' : 'These tracks are already on your device.'); return; }
    const label = list.length === 1 ? `“${list[0].title}”` : `${list.length} tracks`;
    try {
      // `thumbnail` makes the tagger embed square album art instead of a video frame.
      const payload = list.map((t) => ({ ...t, thumbnail: t.cover || undefined }));
      const data = await api.post('/api/download', {
        tracks: payload, format: settings.format, quality: settings.quality, target: isNativeApp ? 'device' : 'library',
      });
      setJobs((all) => ({ ...all, [data.job_id]: { status: 'queued', total: list.length, completed: 0, label, device: isNativeApp } }));
      notify(`Downloading ${label}…`);
      if (isNativeApp) pollDeviceJob(data.job_id, label, list);
      else pollJob(data.job_id, label);
    } catch (error) {
      notify(error.message, { tone: 'error' });
    }
  }, [findLocal, notify, pollDeviceJob, pollJob, settings]);

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

  const value = useMemo(() => ({
    likes, isLiked, toggleLike, files, downloadedTracks, filesState, refreshFiles,
    jobs, download, deleteFile, requestDelete, settings, setSettings, findLocal,
  }), [likes, isLiked, toggleLike, files, downloadedTracks, filesState, refreshFiles, jobs, download, deleteFile, requestDelete, settings, setSettings, findLocal]);

  return <LibraryContext.Provider value={value}>
    {children}
    <ConfirmDialog open={!!pendingDelete} title="Delete from this device?"
      message={pendingDelete ? `“${pendingDelete.title}” will be permanently removed from your downloads.` : ''}
      confirmLabel="Delete" onCancel={() => setPendingDelete(null)}
      onConfirm={() => { deleteFile(pendingDelete); setPendingDelete(null); }} />
  </LibraryContext.Provider>;
}

export const useLibrary = () => useContext(LibraryContext);
