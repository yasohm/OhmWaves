import { useMemo } from 'react';
import { CloudOff, Heart, Play, Server, Shuffle, Sparkles, Wifi } from 'lucide-react';
import OhmMark from '../components/OhmMark';
import { greeting } from '../lib/tracks';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { useConnection } from '../context/ConnectionContext';
import TrackList from '../components/TrackList';
import TrackMenu from '../components/TrackMenu';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';

const SOURCE = 'Downloads';
const sizeLabel = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

/** Home while offline: everything saved on this phone, ready to play without the server. */
export default function OfflineHome({ navigate, onShowWelcome, onChangeServer }) {
  const player = usePlayer();
  const library = useLibrary();
  const { offlineMode, setOfflineMode, check } = useConnection();
  const tracks = library.downloadedTracks;
  const totalMb = useMemo(() => tracks.reduce((sum, t) => sum + (t.sizeMb || 0), 0), [tracks]);
  const likedHere = useMemo(() => library.likes.filter((t) => library.findLocal(t)).length, [library]);
  const playingHere = player.source === SOURCE && tracks.some((t) => player.isCurrent(t));

  return <div className="page page--home">
    <header className="home-top">
      <OhmMark className="home-top__logo mobile-only" />
      <h1>{greeting()}</h1>
      <div className="home-top__actions">
        <TrackMenu label="Account and settings" triggerClass="avatar" trigger={<span aria-hidden="true">Y</span>} items={[
          offlineMode
            ? { label: 'Turn off offline mode', icon: Wifi, onSelect: () => setOfflineMode(false) }
            : { label: 'Try to reconnect', icon: Wifi, onSelect: check },
          { label: 'Show welcome screen', icon: Sparkles, onSelect: onShowWelcome },
          ...(onChangeServer ? [{ label: 'Change server', icon: Server, onSelect: onChangeServer }] : []),
        ]} />
      </div>
    </header>

    {library.filesState === 'loading' && <ListSkeleton />}

    {library.filesState !== 'loading' && !tracks.length && <EmptyState icon={CloudOff} title="No music on this phone yet"
      action={<button type="button" className="btn btn--primary" onClick={() => (offlineMode ? setOfflineMode(false) : check())}>
        {offlineMode ? 'Turn off offline mode' : 'Try to reconnect'}
      </button>}>
      Songs you download play here without a connection. Connect to your OhmWaves server, then tap Download on any song.
    </EmptyState>}

    {tracks.length > 0 && <>
      <section className="offline-hero" aria-labelledby="offline-hero-title">
        <span className="mono-label mono-label--accent">On this phone</span>
        <h2 id="offline-hero-title">Your downloads</h2>
        <p>{tracks.length} {tracks.length === 1 ? 'song' : 'songs'} · {sizeLabel(totalMb)}</p>
        <div className="offline-hero__actions">
          <button type="button" className="btn btn--primary" onClick={() => (playingHere ? player.togglePlay() : player.playFrom(tracks, 0, SOURCE))}>
            <Play fill="currentColor" aria-hidden="true" />{playingHere && player.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="btn btn--outline" onClick={() => player.shufflePlay(tracks, SOURCE)}>
            <Shuffle aria-hidden="true" />Shuffle
          </button>
          {likedHere > 0 && <button type="button" className="btn btn--text" onClick={() => navigate({ name: 'collection', kind: 'liked' })}>
            <Heart aria-hidden="true" />Liked · {likedHere} saved
          </button>}
        </div>
      </section>
      <TrackList tracks={tracks} source={SOURCE} onDelete={library.requestDelete} />
    </>}
  </div>;
}
