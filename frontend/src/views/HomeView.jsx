import { useState } from 'react';
import { Bell, Loader2, Pause, Play, RefreshCw, Sparkles, WifiOff, Download, Server } from 'lucide-react';
import OhmMark from '../components/OhmMark';
import { greeting } from '../lib/tracks';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import useHomeFeed from '../hooks/useHomeFeed';
import { ArtistCard, Shelf, TrackCard } from '../components/Shelf';
import { ShelfSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Artwork from '../components/Artwork';
import TrackMenu from '../components/TrackMenu';
import { GENRES } from './genres';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'mixes', label: 'For you', sections: (id) => id === 'for-you' || id === 'on-repeat' || id.startsWith('because-') },
  { id: 'recent', label: 'Recent', sections: (id) => id === 'recent' },
  { id: 'trending', label: 'Trending', sections: (id) => id === 'trending' || id === 'top-artists' },
];

const displayTitle = (section) => (section.id === 'for-you' ? 'Tuned for you' : section.title);
const badgeFor = (section, i) => {
  if (section.id === 'for-you') return String(i + 1).padStart(2, '0');
  if (section.id === 'trending') return i < 3 ? `#${i + 1}` : null;
  return null;
};

function QuickTile({ label, cover, variant, palette, onPlay, active, playing, buffering }) {
  return <button type="button" className={`quick-tile ${active ? 'is-current' : ''}`} onClick={onPlay} aria-label={`Play ${label}`}>
    <Artwork src={cover} title={label} variant={variant} palette={palette} className="quick-tile__art" />
    <span className="quick-tile__label">{label}</span>
    {active && <span className="quick-tile__state" aria-hidden="true">{buffering ? <Loader2 className="spin" /> : playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}</span>}
  </button>;
}

function FeatureCard({ track, tracks }) {
  const player = usePlayer();
  const active = player.isCurrent(track);
  return <section className="feature-card" aria-label="New on the wire">
    <Artwork src={track.cover} title={track.title} className="feature-card__art" />
    <div className="feature-card__text">
      <span className="mono-label mono-label--accent">New on the wire</span>
      <h2>{track.title}</h2>
      <p>Song · {track.artist}</p>
    </div>
    <button type="button" className="round-btn round-btn--cream" onClick={() => player.playFrom(tracks, 0, 'Trending worldwide')}
      aria-label={active && player.isPlaying ? `Pause ${track.title}` : `Play ${track.title}`}>
      {active && player.isBuffering ? <Loader2 className="spin" /> : active && player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
    </button>
  </section>;
}

export default function HomeView({ navigate, onShowWelcome, onChangeServer }) {
  const { feed, status, refreshing, reload } = useHomeFeed();
  const player = usePlayer();
  const { likes, jobs } = useLibrary();
  const [filter, setFilter] = useState('all');
  const downloading = Object.values(jobs).some((j) => j.status !== (j.device ? 'saved' : 'completed'));

  const sections = feed?.sections || [];
  const recent = sections.find((s) => s.id === 'recent')?.tracks || [];
  const forYou = sections.find((s) => s.id === 'for-you')?.tracks || [];
  const trending = sections.find((s) => s.id === 'trending')?.tracks || [];
  const quickSource = recent.length ? { tracks: recent, label: 'Recently played' } : { tracks: forYou.length ? forYou : trending, label: forYou.length ? 'Tuned for you' : 'Trending worldwide' };
  const quickPicks = quickSource.tracks.slice(0, likes.length ? 5 : 6);
  const active = FILTERS.find((f) => f.id === filter);
  const shelves = sections.filter((s) => (active.sections ? active.sections(s.id) : s.id !== 'recent' || recent.length > 6));
  const firstShelfIndex = shelves.findIndex((s) => s.kind === 'tracks');

  return <div className="page page--home">
    <header className="home-top">
      <OhmMark className="home-top__logo mobile-only" />
      <h1>{greeting()}</h1>
      <div className="home-top__actions">
        <button type="button" className="icon-btn icon-btn--lg" onClick={() => navigate({ name: 'library', tab: 'downloaded' })}
          aria-label={downloading ? 'Downloads in progress' : 'Downloads'}>
          <Bell />{downloading && <span className="dot" aria-hidden="true" />}
        </button>
        <TrackMenu label="Account and settings" triggerClass="avatar" trigger={<span aria-hidden="true">Y</span>} items={[
          { label: 'Refresh recommendations', icon: RefreshCw, onSelect: reload },
          { label: 'Download settings', icon: Download, onSelect: () => navigate({ name: 'library', tab: 'downloaded' }) },
          { label: 'Show welcome screen', icon: Sparkles, onSelect: onShowWelcome },
          ...(onChangeServer ? [{ label: 'Change server', icon: Server, onSelect: onChangeServer }] : []),
        ]} />
      </div>
    </header>

    <div className="chip-row" role="group" aria-label="Filter home">
      {FILTERS.map((f) => <button key={f.id} type="button" className={`chip ${filter === f.id ? 'is-active' : ''}`}
        aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      {refreshing && status === 'ready' && <Loader2 className="spin chip-row__spinner" aria-label="Refreshing" />}
    </div>

    {filter === 'all' && (quickPicks.length > 0 || likes.length > 0) && <div className="quick-grid">
      {likes.length > 0 && <QuickTile label="Liked Songs" variant="bands" onPlay={() => player.playFrom(likes, 0, 'Liked Songs')}
        active={player.source === 'Liked Songs' && likes.some((t) => player.isCurrent(t))} playing={player.isPlaying} buffering={player.isBuffering} />}
      {quickPicks.map((track, i) => <QuickTile key={track.id} label={track.title} cover={track.cover}
        onPlay={() => player.playFrom(quickSource.tracks, i, quickSource.label)}
        active={player.isCurrent(track)} playing={player.isPlaying} buffering={player.isBuffering} />)}
    </div>}

    {status === 'loading' && <><ShelfSkeleton /><ShelfSkeleton /></>}

    {status === 'error' && <EmptyState icon={WifiOff} title="Couldn’t load your home feed"
      action={<div className="empty-state__actions">
        <button type="button" className="btn btn--primary" onClick={reload}>Try again</button>
        {onChangeServer && <button type="button" className="btn btn--outline" onClick={onChangeServer}>Change server</button>}
      </div>}>
      Make sure the OhmWaves server is running on your computer and connected to the internet.
    </EmptyState>}

    {status === 'ready' && feed.cold_start && filter === 'all' && <section className="welcome-card">
      <span className="mono-label mono-label--accent">Start your current</span>
      <h2>Your mixes start here</h2>
      <p>Play, like and skip. OhmWaves learns your taste and tells you why each pick was chosen.</p>
      <div className="chip-row">
        {GENRES.slice(0, 6).map((g) => <button key={g.name} type="button" className="chip chip--outline" onClick={() => navigate({ name: 'search', query: g.query, category: 'genre' })}>{g.name}</button>)}
      </div>
    </section>}

    {status === 'ready' && shelves.map((section, n) => <div key={section.id}>
      {section.kind === 'artists'
        ? <Shelf title={section.title} subtitle={section.subtitle}>
          {section.artists.map((artist) => <ArtistCard key={artist.name} artist={artist}
            onOpen={(name) => navigate({ name: 'search', query: name, category: 'artist' })} />)}
        </Shelf>
        : <Shelf title={displayTitle(section)} subtitle={section.id === 'for-you' ? null : section.subtitle}
          onSeeAll={() => navigate({ name: 'collection', kind: 'section', id: section.id })}>
          {section.tracks.map((track, i) => <TrackCard key={`${track.id}-${i}`} track={track} tracks={section.tracks} index={i}
            source={displayTitle(section)} badge={badgeFor(section, i)} />)}
        </Shelf>}
      {filter === 'all' && n === firstShelfIndex && trending[0] && <FeatureCard track={trending[0]} tracks={trending} />}
    </div>)}

    {status === 'ready' && shelves.length === 0 && filter !== 'all' && <EmptyState icon={Sparkles} title="Nothing here yet">
      Keep listening. This view fills in as OhmWaves learns what you like.
    </EmptyState>}
  </div>;
}
