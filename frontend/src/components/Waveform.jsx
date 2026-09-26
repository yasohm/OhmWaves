import { useMemo, useRef, useState } from 'react';
import { useProgress } from '../context/PlayerContext';
import { formatTime, hueFor } from '../lib/tracks';

const BARS = 56;

/** Stable, natural-looking bar heights per track (a visual signature, not decoded audio). */
function barsFor(seed) {
  let state = hueFor(seed) * 7919 + 1;
  const rand = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
  let prev = 0.5;
  return Array.from({ length: BARS }, (_, i) => {
    const envelope = 0.55 + 0.45 * Math.sin((i / BARS) * Math.PI * 1.6 + 0.4);
    prev = prev * 0.35 + rand() * 0.65;
    return Math.max(0.18, Math.min(1, prev * envelope + 0.12));
  });
}

/** Waveform scrubber: drag, tap or use arrow keys to seek. */
export default function Waveform({ seed }) {
  const { time, duration, seek } = useProgress();
  const bars = useMemo(() => barsFor(seed), [seed]);
  const ref = useRef(null);
  const [drag, setDrag] = useState(null);
  const ratio = drag ?? (duration ? time / duration : 0);

  const ratioAt = (clientX) => {
    const rect = ref.current.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const onPointerDown = (e) => { if (!duration) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(ratioAt(e.clientX)); };
  const onPointerMove = (e) => { if (drag !== null) setDrag(ratioAt(e.clientX)); };
  const onPointerUp = () => { if (drag !== null) { seek(drag * duration); setDrag(null); } };
  const onKeyDown = (e) => {
    const step = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5 }[e.key];
    if (step) { e.preventDefault(); seek(Math.min(duration, Math.max(0, time + step))); }
    if (e.key === 'Home') { e.preventDefault(); seek(0); }
    if (e.key === 'End') { e.preventDefault(); seek(Math.max(0, duration - 1)); }
  };
  const shownTime = drag !== null ? drag * duration : time;

  return <div className="waveform">
    <div ref={ref} className="waveform__bars" role="slider" tabIndex={duration ? 0 : -1} aria-label="Seek"
      aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(shownTime)}
      aria-valuetext={`${formatTime(shownTime)} of ${formatTime(duration)}`}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => setDrag(null)} onKeyDown={onKeyDown}>
      {bars.map((h, i) => <span key={i} className={(i + 0.5) / BARS <= ratio ? 'is-played' : ''} style={{ height: `${h * 100}%` }} />)}
    </div>
    <div className="waveform__times mono">
      <span>{formatTime(shownTime)}</span>
      <span>-{formatTime(Math.max(0, duration - shownTime))}</span>
    </div>
  </div>;
}
