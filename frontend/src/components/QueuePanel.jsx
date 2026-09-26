import { Sparkles, X } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import Artwork from './Artwork';
import Equalizer from './Equalizer';

function QueueItem({ track, onPlay, onRemove, current, paused }) {
  return <li className={`queue-item ${current ? 'is-current' : ''}`}>
    <button type="button" className="queue-item__main" onClick={onPlay} disabled={current} aria-label={current ? `${track.title}, now playing` : `Play ${track.title}`}>
      <Artwork src={track.cover} title={track.title} />
      <span className="queue-item__text"><strong>{current && <Equalizer paused={paused} />}{track.title}</strong><small>{track.artist}</small></span>
    </button>
    {onRemove && <button type="button" className="icon-btn icon-btn--sm" onClick={onRemove} aria-label={`Remove ${track.title} from queue`}><X /></button>}
  </li>;
}

/** Now playing, user-queued "Next up" and ML-powered "Autoplay" sections. */
export default function QueuePanel({ onClose, embedded = false }) {
  const { queue, index, current, isPlaying, jumpTo, removeFromQueue, source } = usePlayer();
  const upcoming = queue.slice(index + 1);
  const manual = upcoming.filter((t) => !t.autoplay);
  const auto = upcoming.filter((t) => t.autoplay);
  const content = <>
    {current ? <>
      <h3 className="mono-label">Now playing</h3>
      <ul className="queue-list"><QueueItem track={current} current paused={!isPlaying} /></ul>
      {manual.length > 0 && <>
        <h3 className="mono-label">Next {source ? `from ${source}` : 'up'}</h3>
        <ul className="queue-list">{manual.map((t) => <QueueItem key={t.qid} track={t} onPlay={() => jumpTo(t.qid)} onRemove={() => removeFromQueue(t.qid)} />)}</ul>
      </>}
      <h3 className="mono-label mono-label--accent"><Sparkles aria-hidden="true" />Autoplay: picked for you</h3>
      {auto.length > 0
        ? <ul className="queue-list">{auto.map((t) => <QueueItem key={t.qid} track={t} onPlay={() => jumpTo(t.qid)} onRemove={() => removeFromQueue(t.qid)} />)}</ul>
        : <p className="muted small">Similar songs will appear here as your queue runs low.</p>}
    </> : <p className="muted">Play something to build your queue.</p>}
  </>;
  if (embedded) return <div className="queue-embedded">{content}</div>;
  return <aside className="panel queue-panel" aria-label="Queue">
    <header className="queue-panel__header">
      <h2>Queue</h2>
      <button type="button" className="icon-btn" onClick={onClose} aria-label="Close queue"><X /></button>
    </header>
    <div className="queue-panel__body">{content}</div>
  </aside>;
}
