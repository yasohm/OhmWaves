import { Download, Loader2, Pause, Play, Shuffle } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import useDominantColor, { FALLBACK_COLOR } from '../hooks/useDominantColor';
import Artwork from './Artwork';

/** Playlist/album header: tinted by artwork, with the primary Play action front and centre. */
export default function CollectionHero({ kicker, title, meta, cover, icon: Icon, iconClass = '', color, tracks, source, extraActions }) {
  const player = usePlayer();
  const { download } = useLibrary();
  const artColor = useDominantColor(cover);
  const tint = color || (cover ? artColor : FALLBACK_COLOR);
  const playingHere = player.source === source && tracks.some((t) => player.isCurrent(t));
  const downloadable = tracks.filter((t) => t.videoId);

  return <>
    <header className="collection-hero" style={{ '--dominant': tint }}>
      {Icon ? <span className={`collection-hero__art collection-hero__art--icon ${iconClass}`}><Icon aria-hidden="true" fill="currentColor" /></span>
        : <Artwork src={cover} title={title} className="collection-hero__art" />}
      <div className="collection-hero__text">
        {kicker && <span className="eyebrow">{kicker}</span>}
        <h1 className={title.length > 28 ? 'is-long' : ''}>{title}</h1>
        {meta && <p className="collection-hero__meta">{meta}</p>}
      </div>
    </header>
    <div className="action-bar" style={{ '--dominant': tint }}>
      <button type="button" className="play-btn play-btn--lg" disabled={!tracks.length}
        onClick={() => (playingHere ? player.togglePlay() : player.playFrom(tracks, 0, source))}
        aria-label={playingHere && player.isPlaying ? `Pause ${title}` : `Play ${title}`}>
        {playingHere && player.isBuffering ? <Loader2 className="spin" /> : playingHere && player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
      <button type="button" className="icon-btn icon-btn--lg" disabled={!tracks.length} onClick={() => player.shufflePlay(tracks, source)} aria-label={`Shuffle ${title}`}><Shuffle /></button>
      {downloadable.length > 0 && <button type="button" className="icon-btn icon-btn--lg" onClick={() => download(downloadable)} aria-label={`Download all ${downloadable.length} tracks`}><Download /></button>}
      {extraActions}
    </div>
  </>;
}
