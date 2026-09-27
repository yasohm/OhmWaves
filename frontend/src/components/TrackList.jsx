import { Download, Heart, ListEnd, ListPlus, Loader2, Pause, Play, Sparkles, Trash2 } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { warmTrack } from '../lib/api';
import { useLibrary } from '../context/LibraryContext';
import { useConnection } from '../context/ConnectionContext';
import Artwork from './Artwork';
import Equalizer from './Equalizer';
import TrackMenu from './TrackMenu';

function TrackRow({ track, position, isCurrent, isPlaying, isBuffering, liked, showAlbum, showReason, unavailable, onPlay, onLike, menuItems }) {
  const state = isCurrent ? (isPlaying ? 'playing' : 'paused') : 'idle';
  return <li className={`track-row ${isCurrent ? 'is-current' : ''} ${unavailable ? 'is-unavailable' : ''}`}>
    <button type="button" className="track-row__main" onClick={onPlay} onPointerEnter={() => warmTrack(track)} onFocus={() => warmTrack(track)}
      aria-label={isCurrent && isPlaying ? `Pause ${track.title}` : `Play ${track.title} by ${track.artist}${unavailable ? ' (not downloaded, unavailable offline)' : ''}`}>
      <span className="track-row__index" aria-hidden="true">
        {isCurrent && isBuffering ? <Loader2 className="spin" />
          : isCurrent ? <><Equalizer paused={state === 'paused'} />{isPlaying ? <Pause className="hover-only" fill="currentColor" /> : <Play className="hover-only" fill="currentColor" />}</>
            : <><span className="num">{position}</span><Play className="hover-only" fill="currentColor" /></>}
      </span>
      <Artwork src={track.cover} title={track.title} className="track-row__art" />
      <span className="track-row__text">
        <strong>{track.title}</strong>
        <small>
          {showReason && track.reason ? <><Sparkles aria-hidden="true" className="reason-icon" />{track.reason}</> : track.artist}
        </small>
      </span>
    </button>
    {showAlbum && <span className="track-row__album">{track.album}</span>}
    <button type="button" className={`icon-btn like-btn ${liked ? 'is-liked' : ''}`} onClick={onLike}
      aria-label={liked ? `Remove ${track.title} from Liked Songs` : `Add ${track.title} to Liked Songs`} aria-pressed={liked}>
      <Heart fill={liked ? 'currentColor' : 'none'} />
    </button>
    <span className="track-row__duration">{track.duration}</span>
    {menuItems.length ? <TrackMenu label={`More options for ${track.title}`} items={menuItems} /> : <span className="icon-btn" aria-hidden="true" />}
  </li>;
}

/**
 * Spotify-style track list. `source` labels the queue ("Playing from …").
 * `onDelete` enables the delete action (library only).
 */
export default function TrackList({ tracks, source = '', sourceKind = 'playlist', showAlbum = true, showReason = false, onDelete, numbered = true }) {
  const player = usePlayer();
  const library = useLibrary();
  const { offline } = useConnection();

  return <ol className={`track-list ${showAlbum ? 'has-album' : ''}`}>
    {tracks.map((track, i) => {
      const isCurrent = player.isCurrent(track);
      const unavailable = !player.isPlayable(track); // offline and not downloaded
      const menuItems = [
        ...(unavailable ? [] : [
          { label: 'Play next', icon: ListPlus, onSelect: () => player.playNext(track) },
          { label: 'Add to queue', icon: ListEnd, onSelect: () => player.addToQueue(track) },
        ]),
        ...(!offline && track.videoId && !track.localUri && !library.findLocal(track) ? [{ label: 'Download', icon: Download, onSelect: () => library.download(track) }] : []),
        ...(onDelete ? [{ label: 'Delete from device', icon: Trash2, tone: 'danger', onSelect: () => onDelete(track) }] : []),
      ];
      return <TrackRow key={`${track.id}-${i}`} track={track} position={numbered ? i + 1 : '•'}
        isCurrent={isCurrent} isPlaying={isCurrent && player.isPlaying} isBuffering={isCurrent && player.isBuffering}
        liked={library.isLiked(track)} showAlbum={showAlbum} showReason={showReason} unavailable={unavailable}
        onPlay={() => player.playFrom(tracks, i, source, sourceKind)} onLike={() => library.toggleLike(track)} menuItems={menuItems} />;
    })}
  </ol>;
}
