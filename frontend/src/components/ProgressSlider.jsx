import { useState } from 'react';

/** Accessible range slider with a filled track; commits on release to avoid seek spam while dragging. */
export default function ProgressSlider({ value, max, onCommit, label, step = 1, className = '', formatValue }) {
  const [dragValue, setDragValue] = useState(null);
  const shown = dragValue ?? value;
  const percent = max > 0 ? Math.min(100, (shown / max) * 100) : 0;
  const commit = () => { if (dragValue !== null) { onCommit(dragValue); setDragValue(null); } };
  return <input
    type="range"
    className={`slider ${className}`}
    min="0"
    max={max || 0}
    step={step}
    value={Math.min(shown, max || 0)}
    style={{ '--fill': `${percent}%` }}
    aria-label={label}
    aria-valuetext={formatValue ? formatValue(shown) : undefined}
    disabled={!max}
    onChange={(e) => setDragValue(Number(e.target.value))}
    onPointerUp={commit}
    onKeyUp={commit}
    onBlur={commit}
  />;
}
