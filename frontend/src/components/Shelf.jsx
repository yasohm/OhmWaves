import { useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pause, Play } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { warmTrack } from '../lib/api';
import Artwork from './Artwork';
import Equalizer from './Equalizer';

/** Horizontally scrolling row with a display heading and a mono "SEE ALL" action. */
export function Shelf({ title, subtitle, children, onSeeAll }) {
  const rowRef = useRef(null);
  const scroll = (dir) => rowRef.current?.scrollBy({ left: dir * rowRef.current.clientWidth * 0.8, behavior: 'smooth' });
  return <section className="shelf">
    <header className="shelf__header">
      <div className="shelf__titles">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="shelf__controls">
        <button type="button" className="icon-btn icon-btn--sm desktop-only" onClick={() => scroll(-1)} aria-label={`Scroll ${title} left`}><ChevronLeft /></button>
        <button type="button" className="icon-btn icon-btn--sm desktop-only" onClick={() => scroll(1)} aria-label={`Scroll ${title} right`}><ChevronRight /></button>
        {onSeeAll && <button type="button" className="see-all" onClick={onSeeAll} aria-label={`See all: ${title}`}>See all</button>}
      </div>
    </header>
    <div className="shelf__row" ref={rowRef}>{children}</div>
  </section>;
}

export function TrackCard({ track, tracks, index, source, badge }) {
  const player = usePlayer();
  const isCurrent = player.isCurrent(track);
  const active = isCurrent && player.isPlaying;
  return <article className={`card ${isCurrent ? 'is-current' : ''}`}>
    <button type="button" className="card__hit" onClick={() => player.playFrom(tracks, index, source)}
      onPointerEnter={() => warmTrack(track)} onFocus={() => warmTrack(track)} onTouchStart={() => warmTrack(track)}
      aria-label={active ? `Pause ${track.title}` : `Play ${track.title} by ${track.artist}`}>
      <span className="card__art">
        <Artwork src={track.cover} title={track.title} />
        {badge && <span className="badge" aria-hidden="true">{badge}</span>}
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
      <small className="card__subtitle">{[album.type || 'Album', album.year].filter(Boolean).join(' · ')}</small>
    </button>
  </article>;
}

/** A playlist, album or artist from your library, opening its page. */
export function CollectionCard({ title, subtitle, cover, variant, rounded = false, onOpen }) {
  return <article className={`card ${rounded ? 'card--artist' : ''}`}>
    <button type="button" className="card__hit" onClick={onOpen} aria-label={`Open ${title}${subtitle ? `, ${subtitle}` : ''}`}>
      <span className="card__art"><Artwork src={cover} title={title} variant={variant} rounded={rounded} /></span>
      <strong className="card__title">{title}</strong>
      {subtitle && <small className="card__subtitle">{subtitle}</small>}
    </button>
  </article>;
}
