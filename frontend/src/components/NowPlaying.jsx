import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Heart, ListMusic, Share, Speaker, UserRound } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { useToast } from '../context/ToastContext';
import Artwork from './Artwork';
import QueuePanel from './QueuePanel';
import TrackMenu from './TrackMenu';
import Waveform from './Waveform';
import { TransportControls } from './PlayerBar';

const KIND_LABEL = { playlist: 'playlist', album: 'album', artist: 'artist', search: 'search' };

/** Full-screen player: large art, waveform scrubber, orange transport, device row and "Up next". */
export default function NowPlaying({ onClose, onOpenArtist }) {
  const { current, source, sourceKind, queue, index, jumpTo } = usePlayer();
  const { isLiked, toggleLike, download, findLocal } = useLibrary();
  const { notify } = useToast();
  const [showQueue, setShowQueue] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); previousFocus?.focus?.(); };
  }, [onClose]);

  if (!current) return null;
  const liked = isLiked(current);
  const canDownload = current.videoId && !current.localUri && !findLocal(current);
  const upNext = queue[index + 1];
  const artistName = current.artist.split(',')[0].trim();

  const share = async () => {
    const url = current.videoId ? `https://music.youtube.com/watch?v=${current.videoId}` : null;
    const text = `${current.title} · ${current.artist}`;
    try {
      if (navigator.share) { await navigator.share({ title: current.title, text, url: url || undefined }); return; }
      await navigator.clipboard.writeText(url || text);
      notify(url ? 'Link copied' : 'Song name copied');
    } catch (error) {
      if (error?.name !== 'AbortError') notify('Couldn’t share this song.', { tone: 'error' });
    }
  };

  return <section className="now-playing" role="dialog" aria-modal="true" aria-label="Now playing">
    <header className="now-playing__header">
      <button ref={closeRef} type="button" className="icon-btn icon-btn--lg" onClick={onClose} aria-label="Close player"><ChevronDown /></button>
      <div className="now-playing__source">
        <span className="mono-label">Playing from {KIND_LABEL[sourceKind] || 'playlist'}</span>
        <strong>{source || 'Your queue'}</strong>
      </div>
      <TrackMenu label="More options" triggerClass="icon-btn icon-btn--lg" items={[
        { label: `Go to ${artistName}`, icon: UserRound, onSelect: () => onOpenArtist(artistName) },
        ...(canDownload ? [{ label: 'Download', icon: Download, onSelect: () => download(current) }] : []),
        { label: 'Share', icon: Share, onSelect: share },
      ]} />
    </header>

    <div className="now-playing__stage">
      {showQueue
        ? <div className="now-playing__queue"><QueuePanel embedded /></div>
        : <Artwork src={current.cover} title={current.title} className="now-playing__art" />}
    </div>

    <div className="now-playing__controls">
      <div className="now-playing__meta">
        <div className="now-playing__titles">
          <h2>{current.title}</h2>
          <p>{current.artist}</p>
        </div>
        <button type="button" className={`icon-btn icon-btn--lg like-btn ${liked ? 'is-liked' : ''}`} onClick={() => toggleLike(current)}
          aria-pressed={liked} aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}><Heart fill={liked ? 'currentColor' : 'none'} /></button>
      </div>

      <Waveform seed={current.id} />
      <TransportControls size="lg" />

      <div className="device-row">
        <span className="device-row__device"><Speaker aria-hidden="true" /><span className="mono-label mono-label--accent">This device</span></span>
        <div className="device-row__actions">
          {canDownload && <button type="button" className="icon-btn" onClick={() => download(current)} aria-label={`Download ${current.title}`}><Download /></button>}
          <button type="button" className="icon-btn" onClick={share} aria-label="Share"><Share /></button>
          <button type="button" className={`icon-btn toggle ${showQueue ? 'is-on' : ''}`} onClick={() => setShowQueue((v) => !v)}
            aria-pressed={showQueue} aria-label={showQueue ? 'Hide queue' : 'Show queue'}><ListMusic /></button>
        </div>
      </div>

      <button type="button" className="up-next" onClick={() => upNext && jumpTo(upNext.qid)} disabled={!upNext}
        aria-label={upNext ? `Up next: ${upNext.title} by ${upNext.artist}. Play now` : 'Up next: autoplay will pick a song for you'}>
        <Artwork src={upNext?.cover} title={upNext?.title || 'autoplay'} variant={upNext ? undefined : 'stripes'} className="up-next__art" />
        <span className="up-next__text">
          <span className="mono-label">Up next</span>
          <strong>{upNext ? `${upNext.title} · ${upNext.artist}` : 'Autoplay will pick something for you'}</strong>
        </span>
      </button>
    </div>
  </section>;
}
