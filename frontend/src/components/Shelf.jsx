import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pause, Play } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import Artwork from './Artwork';
import Equalizer from './Equalizer';

/** Horizontally scrolling row of cards with desktop scroll buttons. */
export function Shelf({ title, subtitle, children, action }) {
  const rowRef = useRef(null);
  const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.8, behavior: 'smooth' });
  return <section className="shelf">
    <header className="shelf__header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="shelf__controls">
        {action}
        <button type="button" className="icon-btn icon-btn--soft desktop-only" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}><ChevronLeft /></button>
        <button type="button" className="icon-btn icon-btn--soft desktop-only" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}><ChevronRight /></button>
      </div>
    </header>
    <div className="shelf__row" ref={rowRef}>{children}</div>
  </section>;
}

export function TrackCard({ track, tracks, index, source }) {
  const player = usePlayer();
  const isCurrent = player.isCurrent(track);
  const active = isCurrent && player.isPlaying;
  return <article className={`card ${isCurrent ? 'is-current' : ''}`}>
    <button type="button" className="card__hit" onClick={() => player.playFrom(tracks, index, source)}
      aria-label={active ? `Pause ${track.title}` : `Play ${track.title} by ${track.artist}`}>
      <span className="card__art">
        <Artwork src={track.cover} title={track.title} />
        <span className={`play-fab ${isCurrent ? 'is-visible' : ''}`} aria-hidden="true">
          {isCurrent && player.isBuffering ? <Loader2 className="spin" /> : active ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
        </span>
      </span>
      <strong className="card__title">{isCurrent && <Equalizer paused={!player.isPlaying} />}{track.title}</strong>
      <small className="card__subtitle">{track.reason || track.artist}</small>
    </button>
  </article>;
}

export function ArtistCard({ artist, onOpen }) {
  return <article className="card card--artist">
    <button type="button" className="card__hit" onClick={() => onOpen(artist.name)} aria-label={`Open ${artist.name}`}>
      <span className="card__art"><Artwork src={artist.cover} title={artist.name} rounded /></span>
      <strong className="card__title">{artist.name}</strong>
      <small className="card__subtitle">Artist</small>
    </button>
  </article>;
}

export function AlbumCard({ album, onOpen }) {
  return <article className="card">
    <button type="button" className="card__hit" onClick={() => onOpen(album)} aria-label={`Open album ${album.title}`}>
      <span className="card__art"><Artwork src={album.cover} title={album.title} /></span>
      <strong className="card__title">{album.title}</strong>
      <small className="card__subtitle">{[album.year, album.type || 'Album'].filter(Boolean).join(' • ')}</small>
    </button>
  </article>;
}
