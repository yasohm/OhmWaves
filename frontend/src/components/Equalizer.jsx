/** Animated "now playing" bars; freezes when paused. */
export default function Equalizer({ paused }) {
  return <span className={`equalizer ${paused ? 'is-paused' : ''}`} aria-hidden="true"><i /><i /><i /></span>;
}
