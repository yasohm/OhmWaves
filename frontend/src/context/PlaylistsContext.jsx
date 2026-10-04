import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, USER_ID } from '../lib/api';
import { normalizeTrack, toRemoteTrack } from '../lib/tracks';
import { firstCover } from '../lib/collections';
import { useToast } from './ToastContext';
import { useConnection } from './ConnectionContext';
import ConfirmDialog from '../components/ConfirmDialog';
import PlaylistNameDialog from '../components/PlaylistNameDialog';
import AddToPlaylistDialog from '../components/AddToPlaylistDialog';

const PlaylistsContext = createContext(null);

// Playlists are kept on the phone too, so they can be opened (and their downloads played) offline.
const CACHE_KEY = 'ohmwave:playlists-cache';
const readCache = () => { try { const list = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); return Array.isArray(list) ? list : null; } catch { return null; } };
const writeCache = (list) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch { /* cache only */ } };
const OFFLINE_EDIT = 'Editing playlists needs your OhmWaves server. You’re offline right now.';

const fromServer = (p) => {
  const tracks = (p.tracks || []).map((t) => normalizeTrack(t));
  return { id: p.id, name: p.name, updatedAt: p.updated_at, tracks, cover: firstCover(tracks) };
};

/** Your own playlists: create, rename, delete, add and remove songs. Edits need the server; viewing works offline. */
export function PlaylistsProvider({ children }) {
  const { notify } = useToast();
  const { offline } = useConnection();
  const cached = useMemo(readCache, []);
  const [playlists, setPlaylistsState] = useState(cached || []);
  const [status, setStatus] = useState(cached ? 'ready' : 'loading'); // loading | ready | error
  const playlistsRef = useRef(playlists);
  const commit = useCallback((next) => { playlistsRef.current = next; setPlaylistsState(next); writeCache(next); }, []);
  const upsert = useCallback((playlist) => {
    const next = fromServer(playlist);
    const rest = playlistsRef.current.filter((p) => p.id !== next.id);
    commit([next, ...rest]); // most recently changed first, like the server
    return next;
  }, [commit]);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get(`/api/playlists?user_id=${encodeURIComponent(USER_ID)}`);
      commit((data.playlists || []).map(fromServer));
      setStatus('ready');
    } catch {
      setStatus((s) => (s === 'ready' ? s : 'error')); // keep showing the cached copy
    }
  }, [commit]);

  // Load when the app starts and whenever it comes back online.
  useEffect(() => { if (!offline) refresh(); }, [offline, refresh]);

  const canEdit = useCallback(() => {
    if (offline) notify(OFFLINE_EDIT, { tone: 'error' });
    return !offline;
  }, [offline, notify]);

  const run = useCallback(async (work) => {
    try { return await work(); } catch (error) { notify(error.message, { tone: 'error' }); return null; }
  }, [notify]);

  const create = useCallback((name, tracks = []) => run(async () => {
    const data = await api.post('/api/playlists', { user_id: USER_ID, name, tracks: tracks.map(toRemoteTrack) });
    const playlist = upsert(data.playlist);
    notify(tracks.length ? `Created “${playlist.name}” with ${tracks.length === 1 ? `“${tracks[0].title}”` : `${tracks.length} songs`}` : `Created “${playlist.name}”`);
    return playlist;
  }), [run, upsert, notify]);

  const rename = useCallback((playlist, name) => run(async () => {
    const data = await api.patch(`/api/playlists/${encodeURIComponent(playlist.id)}`, { user_id: USER_ID, name });
    notify('Playlist renamed');
    return upsert(data.playlist);
  }), [run, upsert, notify]);

  const remove = useCallback((playlist) => run(async () => {
    await api.delete(`/api/playlists/${encodeURIComponent(playlist.id)}`, { user_id: USER_ID });
    commit(playlistsRef.current.filter((p) => p.id !== playlist.id));
    notify(`Deleted “${playlist.name}”`);
    return true;
  }), [run, commit, notify]);

  const addTracks = useCallback((playlist, tracks) => run(async () => {
    const data = await api.post(`/api/playlists/${encodeURIComponent(playlist.id)}/tracks`, { user_id: USER_ID, tracks: tracks.map(toRemoteTrack) });
    const updated = upsert(data.playlist);
    const subject = tracks.length === 1 ? `“${tracks[0].title}”` : `${data.added} ${data.added === 1 ? 'song' : 'songs'}`;
    notify(data.added ? `Added ${subject} to “${updated.name}”` : `Already in “${updated.name}”`);
    return updated;
  }), [run, upsert, notify]);

  const removeTrack = useCallback((playlist, track) => {
    if (!canEdit()) return null;
    return run(async () => {
      const data = await api.delete(`/api/playlists/${encodeURIComponent(playlist.id)}/tracks/${encodeURIComponent(track.videoId)}`, { user_id: USER_ID });
      notify(`Removed “${track.title}” from “${playlist.name}”`);
      return upsert(data.playlist);
    });
  }, [canEdit, run, upsert, notify]);

  // ------------------------------------------------------------- dialogs
  // Kept here so any screen (track menus, the player, the library) can open them.
  const [adding, setAdding] = useState(null); // tracks waiting for a playlist
  const [naming, setNaming] = useState(null); // { playlist?, tracks? }
  const [deleting, setDeleting] = useState(null);
  const onDeleted = useRef(null);

  const requestAddToPlaylist = useCallback((tracks) => {
    const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t.videoId);
    if (!list.length || !canEdit()) return;
    setAdding(list);
  }, [canEdit]);
  const requestCreate = useCallback((tracks = []) => { if (canEdit()) setNaming({ tracks }); }, [canEdit]);
  const requestRename = useCallback((playlist) => { if (canEdit()) setNaming({ playlist }); }, [canEdit]);
  /** `then` runs after a successful delete (e.g. leave the playlist's page). */
  const requestDelete = useCallback((playlist, then) => {
    if (!canEdit()) return;
    onDeleted.current = then || null;
    setDeleting(playlist);
  }, [canEdit]);

  const submitName = async (name) => {
    const { playlist, tracks } = naming;
    const done = playlist ? await rename(playlist, name) : await create(name, tracks);
    if (done) setNaming(null);
  };

  const value = useMemo(() => ({
    playlists, status, refresh, removeTrack, addTracks,
    requestAddToPlaylist, requestCreate, requestRename, requestDelete,
    getPlaylist: (id) => playlists.find((p) => p.id === id) || null,
  }), [playlists, status, refresh, removeTrack, addTracks, requestAddToPlaylist, requestCreate, requestRename, requestDelete]);

  return <PlaylistsContext.Provider value={value}>
    {children}
    <AddToPlaylistDialog open={!!adding} tracks={adding} playlists={playlists} onCancel={() => setAdding(null)}
      onPick={async (playlist) => { const tracks = adding; setAdding(null); await addTracks(playlist, tracks); }}
      onCreate={() => { const tracks = adding; setAdding(null); setNaming({ tracks }); }} />
    <PlaylistNameDialog open={!!naming} title={naming?.playlist ? 'Rename playlist' : 'New playlist'}
      initialName={naming?.playlist?.name || ''} confirmLabel={naming?.playlist ? 'Save' : 'Create'}
      onSubmit={submitName} onCancel={() => setNaming(null)} />
    <ConfirmDialog open={!!deleting} title="Delete this playlist?"
      message={deleting ? `“${deleting.name}” will be deleted. Songs you downloaded stay on your device.` : ''}
      confirmLabel="Delete" onCancel={() => setDeleting(null)}
      onConfirm={async () => {
        const playlist = deleting;
        setDeleting(null);
        if (await remove(playlist)) onDeleted.current?.();
      }} />
  </PlaylistsContext.Provider>;
}

export const usePlaylists = () => useContext(PlaylistsContext);
