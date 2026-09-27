import { ListMusic } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import useHomeFeed from '../hooks/useHomeFeed';
import { totalDurationLabel } from '../lib/tracks';
import CollectionHero from '../components/CollectionHero';
import TrackList from '../components/TrackList';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';

const songs = (n) => `${n} ${n === 1 ? 'song' : 'songs'}`;
export const sectionTitle = (section) => (section.id === 'for-you' ? 'Tuned for you' : section.title);

/** Liked Songs, a Home mix ("See all"), or a downloaded album, shown as a playlist page. */
export default function CollectionView({ route, navigate }) {
  const library = useLibrary();
  const { feed, status } = useHomeFeed({ refreshOnMount: false });

  let config;
  if (route.kind === 'liked') {
    config = { title: 'Liked Songs', kicker: 'Playlist', variant: 'bands', tracks: library.likes, ready: true };
  } else if (route.kind === 'local-album') {
    const tracks = library.downloadedTracks.filter((t) => t.artist === route.artist && t.album === route.album);
    config = { title: route.album, kicker: `Album · ${route.artist}`, cover: tracks[0]?.cover, tracks, ready: library.filesState !== 'loading', kind: 'album', onDelete: true };
  } else {
    const section = feed?.sections.find((s) => s.id === route.id);
    config = section
      ? { title: sectionTitle(section), kicker: section.id === 'trending' ? 'Chart' : 'Made for you · OhmWaves', tracks: section.tracks, ready: true, showReason: section.id === 'for-you' }
      : { title: 'Mix', kicker: 'Made for you', tracks: [], ready: status !== 'loading' };
  }

  const meta = [songs(config.tracks.length), totalDurationLabel(config.tracks)].filter(Boolean).join(' · ');

  return <div className="page page--collection">
    <CollectionHero kicker={config.kicker} title={config.title} meta={meta} cover={config.cover} variant={config.variant}
      tracks={config.tracks} source={config.title} sourceKind={config.kind || 'playlist'} />
    {!config.ready && <ListSkeleton />}
    {config.ready && (config.tracks.length
      ? <TrackList tracks={config.tracks} source={config.title} sourceKind={config.kind || 'playlist'} showReason={config.showReason}
        showAlbum={route.kind !== 'local-album'} onDelete={config.onDelete ? library.requestDelete : undefined} />
      : <EmptyState icon={ListMusic} title={route.kind === 'liked' ? 'Songs you like will appear here' : 'Nothing in this mix yet'}
        action={<button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>Find music</button>}>
        {route.kind === 'liked' ? 'Tap the heart on any song to save it here. Likes also teach your recommendations.' : 'Keep listening and OhmWaves will fill it in.'}
      </EmptyState>)}
  </div>;
}
