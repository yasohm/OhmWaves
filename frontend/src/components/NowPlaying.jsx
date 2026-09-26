import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, Heart, ListMusic } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import useDominantColor from '../hooks/useDominantColor';
import Artwork from './Artwork';
import QueuePanel from './QueuePanel';
import { Timeline, TransportControls } from './PlayerBar';

/** Immersive full-screen player tinted by the artwork, with an inline queue. */
export default function NowPlaying({ onClose }) {
  const { current, source } = usePlayer();
  const { isLiked, toggleLike, download, findLocal } = useLibrary();
  const color = useDominantColor(current?.cover);
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
  const canDownload = current.videoId && !findLocal(current);

  return <section className="now-playing" role="dialog" aria-modal="true" aria-label="Now playing" style={{ '--dominant': color }}>
    <header className="now-playing__header">
      <button ref={closeRef} type="button" className="icon-btn icon-btn--soft" onClick={onClose} aria-label="Close full screen player"><ChevronDown /></button>
      <div className="now-playing__source">
        <small>Playing from</small>
        <strong>{source || 'Your queue'}</strong>
      </div>
      <button type="button" className={`icon-btn icon-btn--soft toggle ${showQueue ? 'is-on' : ''}`} onClick={() => setShowQueue((v) => !v)}
        aria-pressed={showQueue} aria-label={showQueue ? 'Show artwork' : 'Show queue'}><ListMusic /></button>
    </header>

    <div className={`now-playing__body ${showQueue ? 'show-queue' : ''}`}>
      <div className="now-playing__art-wrap">
        <Artwork src={current.cover} title={current.title} className="now-playing__art" />
      </div>
      {showQueue && <div className="now-playing__queue"><QueuePanel embedded /></div>}
    </div>

    <div className="now-playing__controls">
      <div className="now-playing__meta">
        <div className="now-playing__titles">
          <h2>{current.title}</h2>
          <p>{current.artist}</p>
        </div>
        {canDownload && <button type="button" className="icon-btn icon-btn--soft" onClick={() => download(current)} aria-label={`Download ${current.title}`}><Download /></button>}
        <button type="button" className={`icon-btn icon-btn--soft like-btn ${liked ? 'is-liked' : ''}`} onClick={() => toggleLike(current)}
          aria-pressed={liked} aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}><Heart fill={liked ? 'currentColor' : 'none'} /></button>
      </div>
      <Timeline className="timeline--stacked" />
      <TransportControls size="lg" />
    </div>
  </section>;
}
