import { useMemo } from 'react';
import { CloudOff, Play, Server, Shuffle, Sparkles, Wifi } from 'lucide-react';
import OhmMark from '../components/OhmMark';
import { greeting } from '../lib/tracks';
import { groupAlbums, groupArtists, songCount } from '../lib/collections';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { usePlaylists } from '../context/PlaylistsContext';
import { useConnection } from '../context/ConnectionContext';
import { CollectionCard, Shelf } from '../components/Shelf';
import TrackList from '../components/TrackList';
import TrackMenu from '../components/TrackMenu';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';

const SOURCE = 'Downloads';
const sizeLabel = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);

/**
 * Home while offline: everything saved on this phone, organised like the library. Playlists (with Liked Songs),
 * albums and artists each open their page; only the songs saved here play.
 */
export default function OfflineHome({ navigate, onShowWelcome, onChangeServer }) {
  const player = usePlayer();
  const library = useLibrary();
  const { playlists } = usePlaylists();
  const { offlineMode, setOfflineMode, check } = useConnection();
  const tracks = library.downloadedTracks;
  const totalMb = useMemo(() => tracks.reduce((sum, t) => sum + (t.sizeMb || 0), 0), [tracks]);
  const playingHere = player.source === SOURCE && tracks.some((t) => player.isCurrent(t));

  // Only collections with something to play offline.
  const playlistCards = useMemo(() => {
    const withSaved = (title, list, open, variant) => {
      const local = library.preferLocal(list);
      const { total, saved } = library.downloadStatus(local);
      if (!saved) return null;
      return { key: open.id || open.kind, title, variant, cover: variant ? null : local.find((t) => t.localUri && t.cover)?.cover,
        subtitle: saved === total ? songCount(total) : `${saved} of ${songCount(total)}`, open };
    };
    return [
      withSaved('Liked Songs', library.likes, { name: 'collection', kind: 'liked' }, 'bands'),
      ...playlists.map((p) => withSaved(p.name, p.tracks, { name: 'collection', kind: 'playlist', id: p.id })),
    ].filter(Boolean);
  }, [library, playlists]);
  const albums = useMemo(() => groupAlbums(tracks), [tracks]);
  const artists = useMemo(() => groupArtists(tracks), [tracks]);

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
      Songs, albums and playlists you download play here without a connection. Connect to your OhmWaves server, then tap Download.
    </EmptyState>}

    {tracks.length > 0 && <>
      <section className="offline-hero" aria-labelledby="offline-hero-title">
        <span className="mono-label mono-label--accent">On this phone</span>
        <h2 id="offline-hero-title">Your downloads</h2>
        <p>{songCount(tracks.length)} · {sizeLabel(totalMb)}</p>
        <div className="offline-hero__actions">
          <button type="button" className="btn btn--primary" onClick={() => (playingHere ? player.togglePlay() : player.playFrom(tracks, 0, SOURCE))}>
            <Play fill="currentColor" aria-hidden="true" />{playingHere && player.isPlaying ? 'Pause' : 'Play'}
          </button>
          <button type="button" className="btn btn--outline" onClick={() => player.shufflePlay(tracks, SOURCE)}>
            <Shuffle aria-hidden="true" />Shuffle
          </button>
        </div>
      </section>

      {playlistCards.length > 0 && <Shelf title="Playlists" onSeeAll={() => navigate({ name: 'library', tab: 'playlists' })}>
        {playlistCards.map((c) => <CollectionCard key={c.key} title={c.title} subtitle={c.subtitle} cover={c.cover} variant={c.variant}
          onOpen={() => navigate(c.open)} />)}
      </Shelf>}

      {albums.length > 0 && <Shelf title="Albums" onSeeAll={() => navigate({ name: 'library', tab: 'albums' })}>
        {albums.map((a) => <CollectionCard key={a.key} title={a.title} subtitle={a.artist} cover={a.cover}
          onOpen={() => navigate({ name: 'collection', kind: 'local-album', id: a.key, artist: a.artist, album: a.title })} />)}
      </Shelf>}

      {artists.length > 0 && <Shelf title="Artists" onSeeAll={() => navigate({ name: 'library', tab: 'artists' })}>
        {artists.map((a) => <CollectionCard key={a.key} title={a.name} subtitle={songCount(a.count)} cover={a.cover} rounded
          onOpen={() => navigate({ name: 'collection', kind: 'local-artist', artist: a.name })} />)}
      </Shelf>}

      <section className="shelf" aria-labelledby="offline-songs-title">
        <header className="shelf__header">
          <div className="shelf__titles"><h2 id="offline-songs-title">All songs</h2></div>
        </header>
        <TrackList tracks={tracks} source={SOURCE} onDelete={library.requestDelete} />
      </section>
    </>}
  </div>;
}
