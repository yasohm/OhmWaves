import { BotOff, CircleMinus, CirclePlus, Download, Heart, ListEnd, ListPlus, Loader2, Pause, Play, Sparkles, Trash2, UserCheck } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { warmTrack } from '../lib/api';
import { useLibrary } from '../context/LibraryContext';
import { useConnection } from '../context/ConnectionContext';
import { usePlaylists } from '../context/PlaylistsContext';
import { useAiFilter } from '../context/AiFilterContext';
import Artwork from './Artwork';
import Equalizer from './Equalizer';
import TrackMenu from './TrackMenu';

function TrackRow({ track, position, isCurrent, isPlaying, isBuffering, liked, showAlbum, showReason, unavailable, aiTag, onPlay, onLike, menuItems }) {
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
          {aiTag && <span className="ai-tag" title="Detected as AI-generated">AI</span>}
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
 * `onDelete` enables the delete action (library only); `onRemoveFromPlaylist` the remove action (your playlists).
 * AI-generated songs are left out, except in your own collections (`hideAi={false}`), where they're tagged instead.
 */
export default function TrackList({ tracks: allTracks, source = '', sourceKind = 'playlist', showAlbum = true, showReason = false, onDelete, onRemoveFromPlaylist, numbered = true, hideAi = true }) {
  const player = usePlayer();
  const library = useLibrary();
  const ai = useAiFilter();
  const { requestAddToPlaylist } = usePlaylists();
  const { offline } = useConnection();
  const tracks = hideAi ? ai.visible(allTracks) : allTracks;

  return <ol className={`track-list ${showAlbum ? 'has-album' : ''}`}>
    {tracks.map((track, i) => {
      const isCurrent = player.isCurrent(track);
      const unavailable = !player.isPlayable(track); // offline and not downloaded
      const menuItems = [
        ...(unavailable ? [] : [
          { label: 'Play next', icon: ListPlus, onSelect: () => player.playNext(track) },
          { label: 'Add to queue', icon: ListEnd, onSelect: () => player.addToQueue(track) },
        ]),
        ...(!offline && track.videoId ? [{ label: 'Add to playlist', icon: CirclePlus, onSelect: () => requestAddToPlaylist(track) }] : []),
        ...(!offline && track.videoId && !track.localUri && !library.findLocal(track) ? [{ label: 'Download', icon: Download, onSelect: () => library.download(track) }] : []),
        ...(onRemoveFromPlaylist && !offline ? [{ label: 'Remove from this playlist', icon: CircleMinus, onSelect: () => onRemoveFromPlaylist(track) }] : []),
        ...(!offline && track.videoId ? [ai.isAi(track)
          ? { label: 'Not AI, show it', icon: UserCheck, onSelect: () => ai.markNotAi(track) }
          : { label: 'Mark as AI', icon: BotOff, onSelect: () => ai.markAsAi(track) }] : []),
        ...(onDelete ? [{ label: 'Delete from device', icon: Trash2, tone: 'danger', onSelect: () => onDelete(track) }] : []),
      ];
      return <TrackRow key={`${track.id}-${i}`} track={track} position={numbered ? i + 1 : '•'}
        isCurrent={isCurrent} isPlaying={isCurrent && player.isPlaying} isBuffering={isCurrent && player.isBuffering}
        liked={library.isLiked(track)} showAlbum={showAlbum} showReason={showReason} unavailable={unavailable} aiTag={!hideAi && ai.isAi(track)}
        onPlay={() => player.playFrom(tracks, i, source, sourceKind)} onLike={() => library.toggleLike(track)} menuItems={menuItems} />;
    })}
  </ol>;
}
