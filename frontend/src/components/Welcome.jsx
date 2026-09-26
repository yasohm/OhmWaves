import { useEffect, useRef } from 'react';
import { Omega } from 'lucide-react';

// Layered sine "currents": brightest in front, fading to grey behind.
const WAVES = [
  { amp: 60, freq: 1.3, phase: 0.2, y: 150, color: '#ff6a2b', opacity: 1, width: 3 },
  { amp: 48, freq: 1.1, phase: 1.1, y: 170, color: '#ff6a2b', opacity: 0.55, width: 2.5 },
  { amp: 52, freq: 1.2, phase: 2.0, y: 190, color: '#c4522a', opacity: 0.5, width: 2 },
  { amp: 40, freq: 1.0, phase: 2.8, y: 205, color: '#8a8780', opacity: 0.6, width: 2 },
  { amp: 44, freq: 0.9, phase: 3.6, y: 225, color: '#6b6963', opacity: 0.45, width: 1.5 },
  { amp: 36, freq: 1.15, phase: 4.3, y: 245, color: '#4a4945', opacity: 0.5, width: 1.5 },
  { amp: 30, freq: 0.8, phase: 5.1, y: 265, color: '#3a3936', opacity: 0.5, width: 1.2 },
];

const wavePath = ({ amp, freq, phase, y }) => {
  const points = [];
  for (let x = 0; x <= 400; x += 8) points.push(`${x},${(y + amp * Math.sin((x / 400) * Math.PI * 2 * freq + phase)).toFixed(1)}`);
  return `M${points.join(' L')}`;
};

/** First-run screen. OhmWave is local, so there is no sign-up: every action leads straight into music. */
export default function Welcome({ onStart, onBrowse, onLibrary }) {
  const dialogRef = useRef(null);
  // Move focus into the dialog for screen readers without drawing a ring on the first button.
  useEffect(() => { dialogRef.current?.focus(); }, []);

  return <section ref={dialogRef} tabIndex={-1} className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <svg className="welcome__waves" viewBox="0 0 400 340" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {[...WAVES].reverse().map((w, i) => <path key={i} d={wavePath(w)} fill="none" stroke={w.color} strokeOpacity={w.opacity} strokeWidth={w.width}
        style={{ animationDelay: `${-i * 1.3}s` }} />)}
    </svg>
    <div className="welcome__content">
      <div className="welcome__brand">
        <Omega aria-hidden="true" strokeWidth={2.6} />
        <span className="mono-label">Music · Mixes · Downloads</span>
      </div>
      <h1 id="welcome-title">OhmWave</h1>
      <p>Every track, every mood, at full current. Start listening in seconds.</p>
      <div className="welcome__actions">
        <button type="button" className="btn btn--primary btn--block" onClick={onStart}>Start listening</button>
        <button type="button" className="btn btn--outline btn--block" onClick={onBrowse}>Browse by current</button>
        <button type="button" className="btn btn--text" onClick={onLibrary}>Open my library</button>
      </div>
    </div>
  </section>;
}
