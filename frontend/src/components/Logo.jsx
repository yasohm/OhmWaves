import { Omega } from 'lucide-react';

export default function Logo({ compact = false }) {
  return <span className="logo" aria-label="OhmWave">
    <Omega className="logo__mark" aria-hidden="true" strokeWidth={2.6} />
    {!compact && <span className="logo__word">OhmWave</span>}
  </span>;
}
