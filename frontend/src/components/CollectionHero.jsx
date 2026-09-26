import { Download, Loader2, Pause, Play, Shuffle } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import Artwork from './Artwork';

/** Playlist/album header: large cover, mono kicker, display title and the orange Play action. */
export default function CollectionHero({ kicker, title, meta, cover, variant, palette, tracks, source, sourceKind = 'playlist', extraActions }) {
  const player = usePlayer();
  const { download } = useLibrary();
  const playingHere = player.source === source && tracks.some((t) => player.isCurrent(t));
  const downloadable = tracks.filter((t) => t.videoId);

  return <>
    <header className="collection-hero">
      <Artwork src={cover} title={title} variant={variant} palette={palette} className="collection-hero__art" />
      <div className="collection-hero__text">
        {kicker && <span className="mono-label mono-label--accent">{kicker}</span>}
        <h1 className={title.length > 24 ? 'is-long' : ''}>{title}</h1>
        {meta && <p className="collection-hero__meta">{meta}</p>}
      </div>
    </header>
    <div className="action-bar">
      <button type="button" className="icon-btn icon-btn--lg" disabled={!tracks.length} onClick={() => player.shufflePlay(tracks, source, sourceKind)} aria-label={`Shuffle ${title}`}><Shuffle /></button>
      {downloadable.length > 0 && <button type="button" className="icon-btn icon-btn--lg" onClick={() => download(downloadable)} aria-label={`Download all ${downloadable.length} tracks`}><Download /></button>}
      {extraActions}
      <button type="button" className="round-btn round-btn--accent action-bar__play" disabled={!tracks.length}
        onClick={() => (playingHere ? player.togglePlay() : player.playFrom(tracks, 0, source, sourceKind))}
        aria-label={playingHere && player.isPlaying ? `Pause ${title}` : `Play ${title}`}>
        {playingHere && player.isBuffering ? <Loader2 className="spin" /> : playingHere && player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
    </div>
  </>;
}
