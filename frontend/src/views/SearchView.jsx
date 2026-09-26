import { useCallback, useEffect, useRef } from 'react';
import { Clock, Loader2, Pause, Play, Search, SearchX, X } from 'lucide-react';
import { api, warmTrack } from '../lib/api';
import { bestThumbnail, normalizeTrack } from '../lib/tracks';
import { usePlayer } from '../context/PlayerContext';
import TrackList from '../components/TrackList';
import { AlbumCard, Shelf } from '../components/Shelf';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Artwork from '../components/Artwork';
import { GENRES } from './genres';

const CATEGORIES = [
  { id: 'track', label: 'Songs' },
  { id: 'artist', label: 'Artists' },
  { id: 'album', label: 'Albums' },
  { id: 'genre', label: 'Genres' },
];

const RECENT_KEY = 'ohmwave:recent-searches';
const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const writeRecent = (list) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* optional */ } };

export const initialSearchState = { query: '', category: 'track', status: 'idle', results: null, error: '', recent: readRecent() };

const toAlbum = (album, fallbackArtist) => ({
  id: album.id, title: album.title || 'Untitled album', artist: album.artist || fallbackArtist || '',
  year: album.year, type: album.type, cover: bestThumbnail(album.thumbnails),
  tracks: album.tracks?.length ? album.tracks.map((t) => normalizeTrack(t)) : null,
});

/** Turn the category-specific API payloads into one results shape. */
function shapeResults(data, category) {
  if (category === 'artist' && data.artists?.length) {
    const [main, ...others] = data.artists;
    return {
      artist: { name: main.name, cover: bestThumbnail(main.thumbnails), subscribers: main.subscribers },
      tracks: (main.songs || []).map((t) => normalizeTrack(t, { artist: main.name })),
      albums: (main.albums || []).filter((a) => a.id).map((a) => toAlbum(a, main.name)),
      related: others.filter((a) => a.name).slice(0, 8).map((a) => ({ name: a.name, cover: bestThumbnail(a.thumbnails) })),
    };
  }
  if (category === 'album') {
    return { albums: (data.albums || []).filter((a) => a.id).map((a) => toAlbum(a)), tracks: [] };
  }
  return { tracks: (data.songs || data.tracks || []).filter((t) => t.videoId || t.id).map((t) => normalizeTrack(t)) };
}

function TopResult({ track, tracks, source }) {
  const player = usePlayer();
  const active = player.isCurrent(track);
  return <button type="button" className="top-result" onClick={() => player.playFrom(tracks, 0, source)}
    aria-label={active && player.isPlaying ? `Pause ${track.title}` : `Play ${track.title} by ${track.artist}`}>
    <Artwork src={track.cover} title={track.title} className="top-result__art" />
    <strong>{track.title}</strong>
    <span className="top-result__meta"><span className="pill">Song</span>{track.artist}</span>
    <span className={`play-fab ${active ? 'is-visible' : ''}`} aria-hidden="true">
      {active && player.isBuffering ? <Loader2 className="spin" /> : active && player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
    </span>
  </button>;
}

export default function SearchView({ state, setState, navigate, pending, clearPending }) {
  const inputRef = useRef(null);
  const abortRef = useRef(null);
  const { query, category, status, results, error, recent } = state;

  const runSearch = useCallback(async (q, cat) => {
    const text = q.trim();
    if (!text) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const nextRecent = [{ query: text, category: cat }, ...readRecent().filter((r) => r.query.toLowerCase() !== text.toLowerCase())].slice(0, 8);
    writeRecent(nextRecent);
    setState((s) => ({ ...s, query: text, category: cat, status: 'loading', error: '', recent: nextRecent }));
    try {
      const data = await api.post('/api/search', { query: text, type: cat }, { signal: controller.signal });
      const shaped = shapeResults(data, cat);
      shaped.tracks.slice(0, 2).forEach(warmTrack); // the top result is the most likely next tap
      setState((s) => ({ ...s, status: 'ready', results: { ...shaped, query: text, category: cat } }));
    } catch (err) {
      if (err.name === 'AbortError') return;
      setState((s) => ({ ...s, status: 'error', error: err.message }));
    }
  }, [setState]);

  // Deep links from Home (artist cards, genre chips).
  useEffect(() => {
    if (!pending) return;
    runSearch(pending.query, pending.category || 'track');
    clearPending();
  }, [pending, runSearch, clearPending]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === '/' && document.activeElement !== inputRef.current && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) { e.preventDefault(); inputRef.current?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); abortRef.current?.abort(); };
  }, []);

  const setCategory = (cat) => {
    setState((s) => ({ ...s, category: cat }));
    if (query.trim()) runSearch(query, cat);
  };
  const removeRecent = (item) => {
    const next = recent.filter((r) => r !== item);
    writeRecent(next);
    setState((s) => ({ ...s, recent: next }));
  };
  const openAlbum = (album) => navigate({ name: 'album', album });

  const source = results ? `“${results.query}”` : '';
  const showIdle = status === 'idle' || (!results && status !== 'loading' && status !== 'error');

  return <div className="page page--search">
    <div className="search-sticky">
      <form className="search-field" role="search" onSubmit={(e) => { e.preventDefault(); runSearch(query, category); }}>
        <Search aria-hidden="true" />
        <input ref={inputRef} type="search" value={query} enterKeyHint="search" autoComplete="off"
          onChange={(e) => setState((s) => ({ ...s, query: e.target.value }))}
          placeholder="What do you want to listen to?" aria-label="Search songs, artists, albums and genres" />
        {status === 'loading' ? <Loader2 className="spin" aria-label="Searching" />
          : query && <button type="button" className="icon-btn icon-btn--sm" onClick={() => { setState((s) => ({ ...s, query: '' })); inputRef.current?.focus(); }} aria-label="Clear search"><X /></button>}
      </form>
      <div className="chip-row" role="group" aria-label="Search category">
        {CATEGORIES.map((c) => <button key={c.id} type="button" className={`chip ${category === c.id ? 'is-active' : ''}`}
          aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.label}</button>)}
      </div>
    </div>

    {showIdle && <>
      {recent.length > 0 && <section className="section">
        <h2 className="section-title">Recent searches</h2>
        <ul className="recent-list">
          {recent.map((item) => <li key={`${item.query}-${item.category}`}>
            <button type="button" className="recent-list__main" onClick={() => runSearch(item.query, item.category)}>
              <Clock aria-hidden="true" /><span>{item.query}</span><small>{CATEGORIES.find((c) => c.id === item.category)?.label}</small>
            </button>
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => removeRecent(item)} aria-label={`Remove ${item.query} from recent searches`}><X /></button>
          </li>)}
        </ul>
      </section>}
      <section className="section">
        <h2 className="section-title">Browse all</h2>
        <div className="genre-grid">
          {GENRES.map((g) => <button key={g.name} type="button" className="genre-tile" style={{ '--tile': g.color }}
            onClick={() => runSearch(g.query, 'genre')}>{g.name}</button>)}
        </div>
      </section>
    </>}

    {status === 'loading' && !results && <ListSkeleton />}

    {status === 'error' && <EmptyState icon={SearchX} title="Search didn’t work"
      action={<button type="button" className="btn btn--primary" onClick={() => runSearch(query, category)}>Try again</button>}>{error}</EmptyState>}

    {results && status !== 'error' && <div className={`results ${status === 'loading' ? 'is-stale' : ''}`} aria-busy={status === 'loading'}>
      {results.artist && <header className="artist-hero">
        <Artwork src={results.artist.cover} title={results.artist.name} rounded className="artist-hero__art" />
        <div>
          <span className="eyebrow">Artist</span>
          <h1>{results.artist.name}</h1>
          {results.artist.subscribers && <p className="muted">{results.artist.subscribers} subscribers</p>}
        </div>
      </header>}

      {!results.artist && results.tracks.length > 0 && <div className="results__top">
        <section>
          <h2 className="section-title">Top result</h2>
          <TopResult track={results.tracks[0]} tracks={results.tracks} source={source} />
        </section>
        <section className="results__songs-preview desktop-only">
          <h2 className="section-title">Songs</h2>
          <TrackList tracks={results.tracks.slice(0, 4)} source={source} showAlbum={false} numbered={false} />
        </section>
      </div>}

      {results.tracks.length > 0 && <section className="section">
        <h2 className="section-title">{results.artist ? 'Popular' : 'All songs'}</h2>
        <TrackList tracks={results.tracks} source={results.artist ? results.artist.name : source} />
      </section>}

      {results.albums?.length > 0 && (results.category === 'album'
        ? <section className="section"><h2 className="section-title">Albums</h2>
          <div className="card-grid">{results.albums.map((a) => <AlbumCard key={a.id} album={a} onOpen={openAlbum} />)}</div></section>
        : <Shelf title="Discography">{results.albums.map((a) => <AlbumCard key={a.id} album={a} onOpen={openAlbum} />)}</Shelf>)}

      {results.related?.length > 0 && <section className="section">
        <h2 className="section-title">Other artists</h2>
        <div className="chip-row">{results.related.map((a) => <button key={a.name} type="button" className="chip chip--avatar"
          onClick={() => runSearch(a.name, 'artist')}><Artwork src={a.cover} title={a.name} rounded />{a.name}</button>)}</div>
      </section>}

      {!results.tracks.length && !results.albums?.length && <EmptyState icon={SearchX} title={`No results for “${results.query}”`}>
        Check the spelling, try fewer words, or search a different category.
      </EmptyState>}
    </div>}
  </div>;
}
