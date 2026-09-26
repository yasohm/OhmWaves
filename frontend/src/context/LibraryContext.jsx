import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, USER_ID } from '../lib/api';
import { libraryFileToTrack, normalizeTrack } from '../lib/tracks';
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

  const refreshFiles = useCallback(async () => {
    try {
      const data = await api.get('/api/library');
      setFiles(data.files || []);
      setFilesState('ready');
    } catch {
      setFilesState('error');
    }
  }, []);

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

  const download = useCallback(async (tracks) => {
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t.videoId);
    if (!list.length) { notify('These tracks are already on your device.'); return; }
    const label = list.length === 1 ? `“${list[0].title}”` : `${list.length} tracks`;
    try {
      // `thumbnail` makes the tagger embed square album art instead of a video frame.
      const payload = list.map((t) => ({ ...t, thumbnail: t.cover || undefined }));
      const data = await api.post('/api/download', { tracks: payload, format: settings.format, quality: settings.quality });
      setJobs((all) => ({ ...all, [data.job_id]: { status: 'queued', total: list.length, completed: 0, label } }));
      notify(`Downloading ${label}…`);
      pollJob(data.job_id, label);
    } catch (error) {
      notify(error.message, { tone: 'error' });
    }
  }, [notify, pollJob, settings]);

  const deleteFile = useCallback(async (track) => {
    try {
      await api.post('/api/delete_file', { relative_path: track.relative_path });
      setFiles((list) => list.filter((f) => f.relative_path !== track.relative_path));
      notify(`Deleted “${track.title}”`);
    } catch (error) {
      notify(error.message, { tone: 'error' });
    }
  }, [notify]);

  /** Ask before deleting a file from disk; the dialog lives here so any screen can use it. */
  const requestDelete = useCallback((track) => setPendingDelete(track), []);

  const downloadedTracks = useMemo(() => files.map(libraryFileToTrack), [files]);

  /** Prefer the local copy of a track when we already have it on disk. */
  const findLocal = useCallback((track) => {
    if (!track || track.relative_path) return null;
    const title = track.title.toLowerCase();
    return files.find((f) => f.title.toLowerCase() === title) || null;
  }, [files]);

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
