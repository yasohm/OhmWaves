import { useCallback, useEffect, useState } from 'react';
import { Heart, Loader2, Pause, Play, RefreshCw, Sparkles, WifiOff } from 'lucide-react';
import { api, USER_ID, warmTrack } from '../lib/api';
import { greeting, normalizeTrack } from '../lib/tracks';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { ArtistCard, Shelf, TrackCard } from '../components/Shelf';
import { ShelfSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Artwork from '../components/Artwork';
import { GENRES } from './genres';

// Stale-while-revalidate: coming back to Home is instant, then quietly refreshes.
let cachedFeed = null;

function useHomeFeed() {
  const [feed, setFeed] = useState(cachedFeed);
  const [status, setStatus] = useState(cachedFeed ? 'ready' : 'loading');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await api.get(`/api/home/${USER_ID}`);
      const sections = (data.sections || []).map((s) => ({
        ...s,
        // Reasons only add information in the personal mix, not in "Because you like X".
        tracks: (s.tracks || []).map((t) => normalizeTrack(s.id === 'for-you' ? t : { ...t, reason: null })),
      }));
      cachedFeed = { ...data, sections };
      (sections.find((s) => s.id === 'for-you') || sections[0])?.tracks.slice(0, 3).forEach(warmTrack);
      setFeed(cachedFeed);
      setStatus('ready');
    } catch (error) {
      if (!cachedFeed) setStatus('error');
      setFeed((f) => (f ? { ...f, error: error.message } : f));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  return { feed, status, refreshing, reload: load };
}

function QuickTile({ label, cover, icon: Icon, onPlay, active, playing, buffering }) {
  return <button type="button" className={`quick-tile ${active ? 'is-current' : ''}`} onClick={onPlay} aria-label={`Play ${label}`}>
    {Icon ? <span className="quick-tile__art collection-icon--liked"><Icon aria-hidden="true" fill="currentColor" /></span>
      : <Artwork src={cover} title={label} className="quick-tile__art" />}
    <span className="quick-tile__label">{label}</span>
    <span className="play-fab play-fab--sm" aria-hidden="true">{active && buffering ? <Loader2 className="spin" /> : active && playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</span>
  </button>;
}

export default function HomeView({ navigate }) {
  const { feed, status, refreshing, reload } = useHomeFeed();
  const player = usePlayer();
  const { likes } = useLibrary();

  const recent = feed?.sections.find((s) => s.id === 'recent')?.tracks || [];
  const quickPicks = recent.slice(0, likes.length ? 5 : 6);
  const shelves = feed?.sections.filter((s) => s.id !== 'recent' || recent.length > 6) || [];

  return <div className="page page--home">
    <div className="page-glow" aria-hidden="true" />
    <header className="page-header">
      <div>
        <h1>{greeting()}</h1>
        {feed?.top_artists?.length > 0 && <p className="muted">Tuned to {feed.top_artists.slice(0, 3).join(', ')} and more</p>}
      </div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={reload} disabled={refreshing} aria-label="Refresh recommendations">
        <RefreshCw className={refreshing ? 'spin' : ''} aria-hidden="true" /><span className="desktop-only">Refresh</span>
      </button>
    </header>

    {(quickPicks.length > 0 || likes.length > 0) && <div className="quick-grid">
      {likes.length > 0 && <QuickTile label="Liked Songs" icon={Heart} onPlay={() => player.playFrom(likes, 0, 'Liked Songs')}
        active={player.source === 'Liked Songs' && likes.some((t) => player.isCurrent(t))} playing={player.isPlaying} buffering={player.isBuffering} />}
      {quickPicks.map((track, i) => <QuickTile key={track.id} label={track.title} cover={track.cover}
        onPlay={() => player.playFrom(recent, i, 'Recently played')}
        active={player.isCurrent(track)} playing={player.isPlaying} buffering={player.isBuffering} />)}
    </div>}

    {status === 'loading' && <><ShelfSkeleton /><ShelfSkeleton /></>}

    {status === 'error' && <EmptyState icon={WifiOff} title="Couldn’t load your home feed"
      action={<button type="button" className="btn btn--primary" onClick={reload}>Try again</button>}>
      Make sure the OhmWave server is running and connected to the internet.
    </EmptyState>}

    {status === 'ready' && feed.cold_start && <section className="welcome-card">
      <Sparkles aria-hidden="true" />
      <div>
        <h2>Your mixes start here</h2>
        <p>Play, like and skip songs. OhmWave learns your taste and builds personal mixes, and every pick tells you why it was chosen.</p>
        <div className="chip-row">
          {GENRES.slice(0, 6).map((g) => <button key={g.name} type="button" className="chip" onClick={() => navigate({ name: 'search', query: g.query, category: 'genre' })}>{g.name}</button>)}
        </div>
      </div>
    </section>}

    {status === 'ready' && shelves.map((section) => section.kind === 'artists'
      ? <Shelf key={section.id} title={section.title} subtitle={section.subtitle}>
        {section.artists.map((artist) => <ArtistCard key={artist.name} artist={artist}
          onOpen={(name) => navigate({ name: 'search', query: name, category: 'artist' })} />)}
      </Shelf>
      : <Shelf key={section.id} title={section.title} subtitle={section.subtitle}>
        {section.tracks.map((track, i) => <TrackCard key={`${track.id}-${i}`} track={track} tracks={section.tracks} index={i} source={section.title} />)}
      </Shelf>)}
  </div>;
}
