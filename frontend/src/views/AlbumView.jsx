import { useEffect, useState } from 'react';
import { Disc3 } from 'lucide-react';
import { api } from '../lib/api';
import { normalizeTrack, totalDurationLabel } from '../lib/tracks';
import CollectionHero from '../components/CollectionHero';
import TrackList from '../components/TrackList';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';

export default function AlbumView({ album }) {
  const [tracks, setTracks] = useState(album.tracks);
  const [status, setStatus] = useState(album.tracks ? 'ready' : 'loading');

  useEffect(() => {
    if (album.tracks || !album.id) return undefined;
    const controller = new AbortController();
    api.get(`/api/album/${encodeURIComponent(album.id)}`, { signal: controller.signal })
      .then((data) => {
        setTracks((data.tracks || []).map((t) => normalizeTrack(t, { cover: album.cover, album: album.title })));
        setStatus('ready');
      })
      .catch((error) => { if (error.name !== 'AbortError') setStatus('error'); });
    return () => controller.abort();
  }, [album]);

  const list = tracks || [];
  const meta = [album.artist, album.year, list.length ? `${list.length} ${list.length === 1 ? 'song' : 'songs'}` : '', totalDurationLabel(list)].filter(Boolean).join(' · ');

  return <div className="page page--collection">
    <CollectionHero kicker={album.type || 'Album'} title={album.title} meta={meta} cover={album.cover} tracks={list} source={album.title} sourceKind="album" />
    {status === 'loading' && <ListSkeleton />}
    {status === 'error' && <EmptyState icon={Disc3} title="Couldn’t load this album">Check your connection and try again.</EmptyState>}
    {status === 'ready' && (list.length
      ? <TrackList tracks={list} source={album.title} sourceKind="album" showAlbum={false} />
      : <EmptyState icon={Disc3} title="No playable tracks">This album has no tracks available to stream.</EmptyState>)}
  </div>;
}
