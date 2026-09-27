import { useMemo, useState } from 'react';
import { ArrowDownToLine, LayoutGrid, List, ListFilter, Plus, Search, WifiOff, X, Library as LibraryIcon } from 'lucide-react';
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
const songs = (n) => `${n} ${n === 1 ? 'song' : 'songs'}`;

function LibraryItem({ item, grid, onOpen }) {
  return <li>
    <button type="button" className={grid ? 'library-card' : 'library-row'} onClick={onOpen}>
      <Artwork src={item.cover} title={item.title} variant={item.variant} rounded={item.round} className="library-item__art" />
      <span className="library-item__text">
        <strong>{item.title}</strong>
        <small>{item.downloaded && <ArrowDownToLine className="downloaded-icon" aria-label="Downloaded" />}{item.subtitle}</small>
      </span>
    </button>
  </li>;
}

/** "Your library": playlists and mixes, downloaded albums, artists and files, in list or grid. */
export default function LibraryView({ tab = 'playlists', navigate }) {
  const library = useLibrary();
  const { feed } = useHomeFeed({ refreshOnMount: false });
  const [sort, setSort] = useState('recent');
  const [grid, setGrid] = useState(false);
  const [searching, setSearching] = useState(false);
  const [filter, setFilter] = useState('');

  const downloadedIds = useMemo(() => new Set(library.files.map((f) => f.title.toLowerCase())), [library.files]);

  const items = useMemo(() => {
    if (tab === 'playlists') {
      const liked = library.likes;
      const mixes = (feed?.sections || []).filter((s) => s.kind === 'tracks' && s.tracks.length);
      return [
        { key: 'liked', title: 'Liked Songs', subtitle: `Playlist · ${songs(liked.length)}`, variant: 'bands',
          downloaded: liked.length > 0 && liked.every((t) => downloadedIds.has(t.title.toLowerCase())), open: { name: 'collection', kind: 'liked' } },
        ...mixes.map((s) => ({ key: s.id, title: sectionTitle(s), subtitle: s.id === 'recent' ? `Playlist · ${songs(s.tracks.length)}` : s.id === 'trending' ? 'Chart · Global' : 'Made for you · OhmWaves',
          open: { name: 'collection', kind: 'section', id: s.id } })),
      ];
    }
    if (tab === 'albums') {
      const albums = new Map();
      library.downloadedTracks.forEach((t) => {
        if (!t.album) return;
        const key = `${t.artist}::${t.album}`;
        if (!albums.has(key)) albums.set(key, { key, title: t.album, subtitle: `Album · ${t.artist}`, cover: t.cover, downloaded: true, count: 0,
          open: { name: 'collection', kind: 'local-album', artist: t.artist, album: t.album } });
        albums.get(key).count += 1;
      });
      return [...albums.values()];
    }
    if (tab === 'artists') {
      const artists = new Map();
      const add = (name, cover) => {
        const clean = (name || '').split(',')[0].trim();
        if (!clean || clean === 'Various Artists') return;
        const entry = artists.get(clean.toLowerCase()) || { key: clean, title: clean, cover: null, round: true, count: 0, open: { name: 'search', query: clean, category: 'artist' } };
        entry.count += 1;
        entry.cover = entry.cover || cover;
        artists.set(clean.toLowerCase(), entry);
      };
      library.likes.forEach((t) => add(t.artist, t.cover));
      library.downloadedTracks.forEach((t) => add(t.artist, t.cover));
      (feed?.top_artists || []).forEach((name) => add(name, null));
      return [...artists.values()].map((a) => ({ ...a, subtitle: `Artist · ${songs(a.count)}` }));
    }
    return [];
  }, [tab, library.likes, library.downloadedTracks, feed, downloadedIds]);

  const visible = useMemo(() => {
    const text = filter.trim().toLowerCase();
    const list = text ? items.filter((i) => `${i.title} ${i.subtitle}`.toLowerCase().includes(text)) : items;
    return sort === 'alpha' ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
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
        <button type="button" className="icon-btn icon-btn--lg" onClick={() => navigate({ name: 'search' })} aria-label="Find music to add"><Plus /></button>
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
      <div className="download-settings" role="group" aria-label="Download settings">
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
      </div>
      {library.filesState === 'loading' && <ListSkeleton />}
      {library.filesState === 'error' && <EmptyState icon={WifiOff} title="Couldn’t read your downloads"
        action={<button type="button" className="btn btn--primary" onClick={library.refreshFiles}>Try again</button>}>The OhmWaves server may be offline.</EmptyState>}
      {library.filesState === 'ready' && (downloadedTracks.length
        ? <TrackList tracks={downloadedTracks} source="Downloaded" onDelete={library.requestDelete} />
        : <EmptyState icon={ArrowDownToLine} title={filter ? `Nothing matches “${filter}”` : 'No downloads yet'}
          action={!filter && <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>Find music</button>}>
          {!filter && (isNativeApp
            ? 'Download songs to listen without a connection. They’re kept inside OhmWaves on this phone.'
            : 'Download songs to listen offline. They’re saved with cover art and tags.')}
        </EmptyState>)}
    </> : visible.length
      ? <ul className={grid ? 'library-grid' : 'library-list'}>
        {visible.map((item) => <LibraryItem key={item.key} item={item} grid={grid} onOpen={() => navigate(item.open)} />)}
      </ul>
      : <EmptyState icon={LibraryIcon} title={filter ? `Nothing matches “${filter}”` : tab === 'albums' ? 'No albums on this device' : 'No artists yet'}
        action={!filter && <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>Find music</button>}>
        {!filter && (tab === 'albums' ? 'Download an album or a few songs and it will show up here.' : 'Like or download songs to build your artist list.')}
      </EmptyState>}
  </div>;
}
