import { CircleCheck, Download, Loader2, Pause, Play, Shuffle } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { useConnection } from '../context/ConnectionContext';
import { isNativeApp } from '../lib/api';
import Artwork from './Artwork';

/**
 * Download control for a whole playlist or album: Download → Downloading (with count) → Downloaded.
 * Downloading needs the server, so offline it only reports what's already saved.
 */
function DownloadAll({ tracks, title }) {
  const library = useLibrary();
  const { offline } = useConnection();
  const { total, saved, downloading } = library.downloadStatus(tracks);
  if (!total) return null;
  const place = isNativeApp ? 'this phone' : 'your library';

  if (saved === total) {
    return <span className="icon-btn icon-btn--lg download-all is-done" role="img" aria-label={`All ${total} songs downloaded to ${place}`}>
      <CircleCheck />
    </span>;
  }
  if (downloading) {
    return <span className="icon-btn icon-btn--lg download-all" role="status" aria-label={`Downloading ${title}: ${saved} of ${total} saved`}>
      <Loader2 className="spin" />
    </span>;
  }
  if (offline) return null;
  const missing = tracks.filter((t) => t.videoId && !t.localUri && !library.findLocal(t));
  return <button type="button" className="icon-btn icon-btn--lg download-all" onClick={() => library.download(missing)}
    aria-label={saved ? `Download the other ${missing.length} songs of ${title}` : `Download all ${missing.length} songs of ${title}`}>
    <Download />
  </button>;
}

/** "12 of 15 downloaded" under the title, so download progress is visible without opening anything. */
function downloadLine(status) {
  if (!status.total || (!status.saved && !status.downloading)) return null;
  if (status.saved === status.total) return 'Downloaded';
  return `${status.saved} of ${status.total} downloaded${status.downloading ? ' · downloading…' : ''}`;
}

/** Playlist/album header: large cover, mono kicker, display title and the orange Play action. */
export default function CollectionHero({ kicker, title, meta, cover, variant, palette, tracks, source, sourceKind = 'playlist', extraActions, canDownload = true }) {
  const player = usePlayer();
  const library = useLibrary();
  const playingHere = player.source === source && tracks.some((t) => player.isCurrent(t));
  // Offline, Play starts from the first downloaded song rather than refusing a list that begins with a streamed one.
  const firstPlayable = Math.max(0, tracks.findIndex((t) => player.isPlayable(t)));
  const status = canDownload ? library.downloadStatus(tracks) : { total: 0 };
  const downloaded = downloadLine(status);

  return <>
    <header className="collection-hero">
      <Artwork src={cover} title={title} variant={variant} palette={palette} className="collection-hero__art" />
      <div className="collection-hero__text">
        {kicker && <span className="mono-label mono-label--accent">{kicker}</span>}
        <h1 className={title.length > 24 ? 'is-long' : ''}>{title}</h1>
        {meta && <p className="collection-hero__meta">{meta}</p>}
        {downloaded && <p className="collection-hero__downloads">{downloaded}</p>}
      </div>
    </header>
    <div className="action-bar">
      <button type="button" className="icon-btn icon-btn--lg" disabled={!tracks.length} onClick={() => player.shufflePlay(tracks, source, sourceKind)} aria-label={`Shuffle ${title}`}><Shuffle /></button>
      {canDownload && <DownloadAll tracks={tracks} title={title} />}
      {extraActions}
      <button type="button" className="round-btn round-btn--accent action-bar__play" disabled={!tracks.length}
        onClick={() => (playingHere ? player.togglePlay() : player.playFrom(tracks, firstPlayable, source, sourceKind))}
        aria-label={playingHere && player.isPlaying ? `Pause ${title}` : `Play ${title}`}>
        {playingHere && player.isBuffering ? <Loader2 className="spin" /> : playingHere && player.isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
      </button>
    </div>
  </>;
}
