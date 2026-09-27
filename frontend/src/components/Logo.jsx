import OhmMark from './OhmMark';

export default function Logo({ compact = false }) {
  return <span className="logo" aria-label="OhmWaves">
    <OhmMark className="logo__mark" />
    {!compact && <span className="logo__word">OhmWaves</span>}
  </span>;
}
