import { Heart, ListMusic, Loader2, Maximize2, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { usePlayer, useProgress } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { formatTime } from '../lib/tracks';
import useDominantColor from '../hooks/useDominantColor';
import Artwork from './Artwork';
import ProgressSlider from './ProgressSlider';

export function PlayButton({ size = 'md', className = '' }) {
  const { isPlaying, isBuffering, togglePlay, current } = usePlayer();
  return <button type="button" className={`play-btn play-btn--${size} ${className}`} onClick={togglePlay} disabled={!current}
    aria-label={isPlaying ? 'Pause' : 'Play'}>
    {isBuffering && isPlaying ? <Loader2 className="spin" /> : isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
  </button>;
}

export function TransportControls({ size = 'md' }) {
  const { shuffle, repeat, toggleShuffle, cycleRepeat, next, previous } = usePlayer();
  const RepeatIcon = repeat === 'one' ? Repeat1 : Repeat;
  const repeatLabel = { off: 'Enable repeat', all: 'Repeat one', one: 'Disable repeat' }[repeat];
  return <div className={`transport transport--${size}`}>
    <button type="button" className={`icon-btn toggle ${shuffle ? 'is-on' : ''}`} onClick={toggleShuffle} aria-pressed={shuffle} aria-label={shuffle ? 'Disable shuffle' : 'Enable shuffle'}><Shuffle /></button>
    <button type="button" className="icon-btn" onClick={previous} aria-label="Previous"><SkipBack fill="currentColor" /></button>
    <PlayButton size={size} />
    <button type="button" className="icon-btn" onClick={() => next(true)} aria-label="Next"><SkipForward fill="currentColor" /></button>
    <button type="button" className={`icon-btn toggle ${repeat !== 'off' ? 'is-on' : ''}`} onClick={cycleRepeat} aria-label={repeatLabel}><RepeatIcon /></button>
  </div>;
}

export function Timeline({ className = '' }) {
  const { time, duration, seek } = useProgress();
  return <div className={`timeline ${className}`}>
    <span className="timeline__time">{formatTime(time)}</span>
    <ProgressSlider value={time} max={duration} onCommit={seek} label="Seek" step={0.5}
      formatValue={(v) => `${formatTime(v)} of ${formatTime(duration)}`} />
    <span className="timeline__time">{formatTime(duration)}</span>
  </div>;
}

function MiniProgress() {
  const { time, duration } = useProgress();
  return <span className="mini-progress" style={{ '--fill': `${duration ? (time / duration) * 100 : 0}%` }} aria-hidden="true" />;
}

function VolumeControl() {
  const { volume, setVolume } = usePlayer();
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  return <div className="volume">
    <button type="button" className="icon-btn" onClick={() => setVolume(volume === 0 ? 0.8 : 0)} aria-label={volume === 0 ? 'Unmute' : 'Mute'}><Icon /></button>
    <ProgressSlider value={volume} max={1} step={0.01} onCommit={setVolume} label="Volume" formatValue={(v) => `${Math.round(v * 100)}%`} />
  </div>;
}

/** Desktop: full three-column player bar. Mobile: floating mini player above the tab bar. */
export default function PlayerBar({ onExpand, onToggleQueue, queueOpen }) {
  const { current, source } = usePlayer();
  const { isLiked, toggleLike } = useLibrary();
  const color = useDominantColor(current?.cover);
  if (!current) return null;
  const liked = isLiked(current);

  return <section className="player-bar" aria-label="Player" style={{ '--dominant': color }}>
    <div className="player-bar__track">
      <button type="button" className="player-bar__art" onClick={onExpand} aria-label="Open now playing">
        <Artwork src={current.cover} title={current.title} />
      </button>
      <button type="button" className="player-bar__text" onClick={onExpand} aria-label={`Now playing: ${current.title} by ${current.artist}. Open full player`}>
        <strong>{current.title}</strong>
        <small>{current.artist}</small>
      </button>
      <button type="button" className={`icon-btn like-btn ${liked ? 'is-liked' : ''}`} onClick={() => toggleLike(current)}
        aria-pressed={liked} aria-label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}>
        <Heart fill={liked ? 'currentColor' : 'none'} />
      </button>
      <PlayButton size="sm" className="mobile-only" />
    </div>
    <div className="player-bar__center desktop-only">
      <TransportControls size="sm" />
      <Timeline />
    </div>
    <div className="player-bar__extras desktop-only">
      {source && <span className="player-bar__source" title={`Playing from ${source}`}>{source}</span>}
      <button type="button" className={`icon-btn toggle ${queueOpen ? 'is-on' : ''}`} onClick={onToggleQueue} aria-pressed={queueOpen} aria-label="Queue"><ListMusic /></button>
      <VolumeControl />
      <button type="button" className="icon-btn" onClick={onExpand} aria-label="Full screen player"><Maximize2 /></button>
    </div>
    <MiniProgress />
  </section>;
}
