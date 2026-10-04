import { useMemo } from 'react';
import { ListMusic, Pencil, Search, Trash2 } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { usePlaylists } from '../context/PlaylistsContext';
import { useConnection } from '../context/ConnectionContext';
import { useAiFilter } from '../context/AiFilterContext';
import useHomeFeed from '../hooks/useHomeFeed';
import { totalDurationLabel } from '../lib/tracks';
import { albumKey, firstCover, primaryArtist, songCount, sortAlbumTracks } from '../lib/collections';
import CollectionHero from '../components/CollectionHero';
import TrackList from '../components/TrackList';
import TrackMenu from '../components/TrackMenu';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';

export const sectionTitle = (section) => (section.id === 'for-you' ? 'Tuned for you' : section.title);

/** Liked Songs, one of your playlists, a Home mix ("See all"), or a downloaded album or artist, shown as a playlist page. */
export default function CollectionView({ route, navigate }) {
  const library = useLibrary();
  const playlists = usePlaylists();
  const { offline } = useConnection();
  const ai = useAiFilter();
  const { feed, status } = useHomeFeed({ refreshOnMount: false });
  const playlist = route.kind === 'playlist' ? playlists.getPlaylist(route.id) : null;

  const config = useMemo(() => {
    if (route.kind === 'liked') {
      return { title: 'Liked Songs', kicker: 'Playlist', variant: 'bands', tracks: library.preferLocal(library.likes), ready: true,
        empty: ['Songs you like will appear here', 'Tap the heart on any song to save it here. Likes also teach your recommendations.'] };
    }
    if (route.kind === 'playlist') {
      if (!playlist) return { title: 'Playlist', kicker: 'Playlist', tracks: [], ready: playlists.status !== 'loading', missing: true };
      const tracks = library.preferLocal(playlist.tracks);
      return { title: playlist.name, kicker: 'Playlist', cover: firstCover(tracks), tracks, ready: true,
        empty: ['Let’s find something for your playlist', offline ? 'Connect to your OhmWaves server to add songs.' : 'Search for songs, then choose “Add to playlist” from their menu.'] };
    }
    if (route.kind === 'local-album') {
      const tracks = sortAlbumTracks(library.downloadedTracks.filter((t) => albumKey(t) === route.id));
      return { title: route.album, kicker: `Album · ${route.artist}`, cover: tracks[0]?.cover, tracks, ready: library.filesState !== 'loading',
        kind: 'album', onDelete: true, empty: ['No songs from this album on your device', 'Download the album again to listen offline.'] };
    }
    if (route.kind === 'local-artist') {
      const key = (route.artist || '').toLowerCase();
      const tracks = library.downloadedTracks.filter((t) => primaryArtist(t.artist).toLowerCase() === key);
      return { title: route.artist, kicker: 'Artist · Downloaded', cover: tracks[0]?.cover, tracks, ready: library.filesState !== 'loading',
        kind: 'artist', onDelete: true, empty: ['No songs by this artist on your device', 'Download some of their songs to listen offline.'] };
    }
    const section = feed?.sections.find((s) => s.id === route.id);
    return section
      ? { title: sectionTitle(section), kicker: section.id === 'trending' ? 'Chart' : 'Made for you · OhmWaves', tracks: library.preferLocal(ai.visible(section.tracks)),
        ready: true, showReason: section.id === 'for-you', empty: ['Nothing in this mix yet', 'Keep listening and OhmWaves will fill it in.'] }
      : { title: 'Mix', kicker: 'Made for you', tracks: [], ready: status !== 'loading', empty: ['Nothing in this mix yet', 'Keep listening and OhmWaves will fill it in.'] };
  }, [route, library, playlist, playlists.status, offline, feed, status, ai]);

  if (config.missing && config.ready) {
    return <div className="page"><EmptyState icon={ListMusic} title="This playlist doesn’t exist anymore"
      action={<button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'library', tab: 'playlists' }, { replace: true })}>Go to your playlists</button>}>
      It may have been deleted on another device.
    </EmptyState></div>;
  }

  const meta = [songCount(config.tracks.length), totalDurationLabel(config.tracks)].filter(Boolean).join(' · ');
  const playlistMenu = playlist && !offline && <TrackMenu label={`More options for ${playlist.name}`} triggerClass="icon-btn icon-btn--lg" items={[
    { label: 'Add songs', icon: Search, onSelect: () => navigate({ name: 'search' }) },
    { label: 'Rename', icon: Pencil, onSelect: () => playlists.requestRename(playlist) },
    { label: 'Delete playlist', icon: Trash2, tone: 'danger', onSelect: () => playlists.requestDelete(playlist, () => window.history.back()) },
  ]} />;
  const isLocal = route.kind === 'local-album' || route.kind === 'local-artist';
  const [emptyTitle, emptyText] = config.empty || [];

  return <div className="page page--collection">
    <CollectionHero kicker={config.kicker} title={config.title} meta={meta} cover={config.cover} variant={config.variant}
      tracks={config.tracks} source={config.title} sourceKind={config.kind || 'playlist'} extraActions={playlistMenu} />
    {!config.ready && <ListSkeleton />}
    {config.ready && (config.tracks.length
      ? <TrackList tracks={config.tracks} source={config.title} sourceKind={config.kind || 'playlist'} showReason={config.showReason}
        showAlbum={route.kind !== 'local-album'} onDelete={config.onDelete ? library.requestDelete : undefined}
        onRemoveFromPlaylist={playlist ? (track) => playlists.removeTrack(playlist, track) : undefined}
        hideAi={route.kind === 'section'} />
      : <EmptyState icon={ListMusic} title={emptyTitle}
        action={!offline && !isLocal && <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>Find music</button>}>
        {emptyText}
      </EmptyState>)}
  </div>;
}
