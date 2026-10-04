import { useMemo, useState } from 'react';
import { ArrowDownToLine, LayoutGrid, List, ListFilter, Plus, Search, WifiOff, X, Library as LibraryIcon } from 'lucide-react';
import { usePlaylists } from '../context/PlaylistsContext';
import { useConnection } from '../context/ConnectionContext';
import { groupAlbums, groupArtists, primaryArtist, songCount } from '../lib/collections';
import { useLibrary } from '../context/LibraryContext';
import { isNativeApp } from '../lib/api';
import useHomeFeed from '../hooks/useHomeFeed';
import Artwork from '../components/Artwork';
import TrackList from '../components/TrackList';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';
import { sectionTitle } from './CollectionView';

const TABS = [
  { id: 'playlists', label: 'Playlists' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'downloaded', label: 'Downloaded' },
];
const FORMATS = ['mp3', 'm4a', 'flac', 'opus', 'wav'];
const QUALITIES = ['320', '256', '192', '128'];

function LibraryItem({ item, grid, onOpen }) {
  return <li>
    <button type="button" className={grid ? 'library-card' : 'library-row'} onClick={onOpen}>
      {item.create
        ? <span className="library-item__art library-item__create" aria-hidden="true"><Plus /></span>
        : <Artwork src={item.cover} title={item.title} variant={item.variant} rounded={item.round} className="library-item__art" />}
      <span className="library-item__text">
        <strong>{item.title}</strong>
        <small>{item.downloaded && <ArrowDownToLine className="downloaded-icon" aria-label="Downloaded" />}{item.subtitle}</small>
      </span>
    </button>
  </li>;
}

/** "Your library": your playlists and mixes, downloaded albums, artists and files, in list or grid. Works offline too. */
export default function LibraryView({ tab = 'playlists', navigate }) {
  const library = useLibrary();
  const playlists = usePlaylists();
  const { offline } = useConnection();
  const { feed } = useHomeFeed({ refreshOnMount: false });
  const [sort, setSort] = useState('recent');
  const [grid, setGrid] = useState(false);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState('');

  const items = useMemo(() => {
    /** "Playlist · 12 songs", or offline "3 of 12 downloaded" so it's clear what will play. */
    const describe = (tracks, kind = 'Playlist') => {
      const { total, saved } = library.downloadStatus(tracks);
      return {
        subtitle: offline && saved < total ? `${kind} · ${saved} of ${songCount(total)} downloaded` : `${kind} · ${songCount(tracks.length)}`,
        downloaded: total > 0 && saved === total,
      };
    };
    if (tab === 'playlists') {
      const likedTracks = library.preferLocal(library.likes);
      const mixes = offline ? [] : (feed?.sections || []).filter((s) => s.kind === 'tracks' && s.tracks.length);
      return [
        ...(offline ? [] : [{ key: 'create', create: true, title: 'Create playlist', subtitle: 'Build your own mix', onOpen: () => playlists.requestCreate() }]),
        { key: 'liked', title: 'Liked Songs', variant: 'bands', ...describe(likedTracks), open: { name: 'collection', kind: 'liked' } },
        ...playlists.playlists.map((p) => {
          const tracks = library.preferLocal(p.tracks);
          return { key: p.id, title: p.name, cover: tracks.find((t) => t.cover)?.cover, ...describe(tracks), open: { name: 'collection', kind: 'playlist', id: p.id } };
        }),
        ...mixes.map((s) => ({ key: s.id, title: sectionTitle(s), subtitle: s.id === 'recent' ? `Playlist · ${songCount(s.tracks.length)}` : s.id === 'trending' ? 'Chart · Global' : 'Made for you · OhmWaves',
          open: { name: 'collection', kind: 'section', id: s.id } })),
      ];
    }
    if (tab === 'albums') {
      return groupAlbums(library.downloadedTracks).map((a) => ({ key: a.key, title: a.title, subtitle: `Album · ${a.artist}`, cover: a.cover, downloaded: true,
        open: { name: 'collection', kind: 'local-album', id: a.key, artist: a.artist, album: a.title } }));
    }
    if (tab === 'artists') {
      // Offline, only artists with songs on this phone, opening those songs. Online, artists you play, like or saved.
      const sources = offline ? library.downloadedTracks : [...library.likes, ...library.downloadedTracks];
      const artists = groupArtists(sources);
      if (!offline) {
        (feed?.top_artists || []).forEach((name) => {
          const clean = primaryArtist(name);
          if (clean && !artists.some((a) => a.key === clean.toLowerCase())) artists.push({ key: clean.toLowerCase(), name: clean, cover: null, count: 0 });
        });
      }
      return artists.map((a) => ({ key: a.key, title: a.name, cover: a.cover, round: true,
        subtitle: a.count ? `Artist · ${songCount(a.count)}` : 'Artist',
        open: offline ? { name: 'collection', kind: 'local-artist', artist: a.name } : { name: 'search', query: a.name, category: 'artist' } }));
    }
    return [];
  }, [tab, library, playlists, offline, feed]);

  const visible = useMemo(() => {
    const text = filter.trim().toLowerCase();
    const list = text ? items.filter((i) => !i.create && `${i.title} ${i.subtitle}`.toLowerCase().includes(text)) : items;
    if (sort !== 'alpha') return list;
    // "Create playlist" stays first whatever the order.
    return [...list.filter((i) => i.create), ...list.filter((i) => !i.create).sort((a, b) => a.title.localeCompare(b.title))];
  }, [items, filter, sort]);

  const downloadedTracks = useMemo(() => {
    const text = filter.trim().toLowerCase();
    const list = text ? library.downloadedTracks.filter((t) => `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(text)) : library.downloadedTracks;
    return sort === 'alpha' ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
  }, [library.downloadedTracks, filter, sort]);

  const switchTab = (id) => { setFilter(''); navigate({ name: 'library', tab: id }, { replace: true }); };

  return <div className="page page--library">
    <header className="page-head">
      <h1 className="page-title">Your library</h1>
      <div className="page-head__actions">
        <button type="button" className="icon-btn icon-btn--lg" onClick={() => { setSearching((v) => !v); setFilter(''); }}
          aria-pressed={searching} aria-label={searching ? 'Close library search' : 'Search your library'}>{searching ? <X /> : <Search />}</button>
        {!offline && <button type="button" className="icon-btn icon-btn--lg" onClick={() => playlists.requestCreate()} aria-label="Create playlist"><Plus /></button>}
      </div>
    </header>

    <div className="chip-row" role="tablist" aria-label="Library sections">
      {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
        className={`chip ${tab === t.id ? 'is-active' : ''}`} onClick={() => switchTab(t.id)}>{t.label}</button>)}
    </div>

    {searching && <label className="filter-field">
      <Search aria-hidden="true" />
      <input type="search" autoFocus value={filter} onChange={(e) => setFilter(e.target.value)}
        placeholder={`Search ${TABS.find((t) => t.id === tab).label.toLowerCase()}`} aria-label="Filter your library" />
    </label>}

    <div className="library-toolbar">
      <button type="button" className="sort-btn" onClick={() => setSort((s) => (s === 'recent' ? 'alpha' : 'recent'))}
        aria-label={`Sorted by ${sort === 'recent' ? 'recently played' : 'name'}. Change sort order`}>
        <ListFilter aria-hidden="true" /><span className="mono-label">{sort === 'recent' ? 'Recently played' : 'Alphabetical'}</span>
      </button>
      {tab !== 'downloaded' && <button type="button" className="icon-btn" onClick={() => setGrid((g) => !g)}
        aria-label={grid ? 'Show as list' : 'Show as grid'}>{grid ? <List /> : <LayoutGrid />}</button>}
    </div>

    {tab === 'downloaded' ? <>
      {/* Phone downloads keep the original audio as streamed; format and quality only apply to the server library. */}
      {!isNativeApp && <div className="download-settings" role="group" aria-label="Download settings">
        <label>Format
          <select value={library.settings.format} onChange={(e) => library.setSettings({ format: e.target.value })}>
            {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </label>
        <label>Quality
          <select value={library.settings.quality} onChange={(e) => library.setSettings({ quality: e.target.value })}>
            {QUALITIES.map((q) => <option key={q} value={q}>{q} kbps</option>)}
          </select>
        </label>
      </div>}
      {library.filesState === 'loading' && <ListSkeleton />}
      {library.filesState === 'error' && <EmptyState icon={WifiOff} title="Couldn’t read your downloads"
        action={<button type="button" className="btn btn--primary" onClick={library.refreshFiles}>Try again</button>}>The OhmWaves server may be offline.</EmptyState>}
      {library.filesState === 'ready' && (downloadedTracks.length
        ? <TrackList tracks={downloadedTracks} source="Downloaded" onDelete={library.requestDelete} hideAi={false} />
        : <EmptyState icon={ArrowDownToLine} title={filter ? `Nothing matches “${filter}”` : 'No downloads yet'}
          action={!filter && !offline && <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>Find music</button>}>
          {!filter && (isNativeApp
            ? 'Download songs to listen without a connection. They’re kept inside OhmWaves on this phone.'
            : 'Download songs to listen offline. They’re saved with cover art and tags.')}
        </EmptyState>)}
    </> : visible.length
      ? <ul className={grid ? 'library-grid' : 'library-list'}>
        {visible.map((item) => <LibraryItem key={item.key} item={item} grid={grid} onOpen={item.onOpen || (() => navigate(item.open))} />)}
      </ul>
      : <EmptyState icon={LibraryIcon} title={filter ? `Nothing matches “${filter}”` : tab === 'albums' ? 'No albums on this device' : 'No artists yet'}
        action={!filter && !offline && <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>Find music</button>}>
        {!filter && (tab === 'albums' ? 'Open an album and tap Download to keep it on this device.'
          : offline ? 'Artists of the songs you download show up here.' : 'Like or download songs to build your artist list.')}
      </EmptyState>}
  </div>;
}
