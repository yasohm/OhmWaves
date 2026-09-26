import { hueFor } from '../lib/tracks';

// The OhmWave generative cover language: stripes, rings, bursts and bands in paired colours.
export const PALETTES = [
  ['#3d6bff', '#0f1a3d'], // electric blue
  ['#9aa13a', '#1f2410'], // olive
  ['#ff6a2b', '#1a1a18'], // current orange
  ['#e8a6a0', '#3a1f1c'], // clay pink
  ['#f2b84b', '#1a1a18'], // amber
  ['#1f8a80', '#0f2624'], // teal
];
const VARIANTS = ['stripes', 'rings', 'burst', 'rings-corner'];

function Stripes({ fg }) {
  return <g transform="rotate(-45 50 50)">
    {Array.from({ length: 10 }, (_, i) => <rect key={i} x={-50 + i * 20} y="-50" width="10" height="200" fill={fg} />)}
  </g>;
}

function Rings({ fg, bg, cx = 50, cy = 50 }) {
  // Largest first, alternating colours, so each ring paints over the previous one.
  return <>{Array.from({ length: 12 }, (_, i) => 12 - i).map((n) => <circle key={n} cx={cx} cy={cy} r={n * 9} fill={n % 2 ? fg : bg} />)}</>;
}

function Burst({ fg }) {
  const rays = 24;
  return <>{Array.from({ length: rays / 2 }, (_, i) => {
    const a1 = (i * 2 * Math.PI * 2) / rays;
    const a2 = a1 + (2 * Math.PI) / rays;
    return <path key={i} d={`M50 50 L${50 + 90 * Math.cos(a1)} ${50 + 90 * Math.sin(a1)} L${50 + 90 * Math.cos(a2)} ${50 + 90 * Math.sin(a2)} Z`} fill={fg} />;
  })}</>;
}

/**
 * Deterministic pattern cover. Pass `seed` (usually a title) for stable art per item,
 * or force `variant`/`palette` for fixed collections such as Liked Songs.
 */
export default function PatternArt({ seed = '', variant, palette, className = '' }) {
  const hash = hueFor(seed);
  const kind = variant || VARIANTS[hash % VARIANTS.length];
  const [fg, bg] = palette || PALETTES[Math.floor(hash / VARIANTS.length) % PALETTES.length];
  return <svg className={`pattern-art ${className}`} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    {kind === 'bands' ? <>
      <rect width="100" height="34" fill="#ff6a2b" /><rect y="33" width="100" height="34" fill="#f2efe6" /><rect y="66" width="100" height="34" fill="#1d1d1b" />
    </> : <>
      <rect width="100" height="100" fill={bg} />
      {kind === 'stripes' && <Stripes fg={fg} />}
      {kind === 'rings' && <Rings fg={fg} bg={bg} />}
      {kind === 'rings-corner' && <Rings fg={fg} bg={bg} cx={30} cy={70} />}
      {kind === 'burst' && <Burst fg={fg} />}
    </>}
  </svg>;
}

/** Quarter-ring motif used in the corner of Browse tiles. */
export function CornerRings({ color }) {
  return <svg className="corner-rings" viewBox="0 0 60 60" aria-hidden="true">
    {[54, 44, 34, 24, 14].map((r) => <circle key={r} cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="5" />)}
    <circle cx="60" cy="60" r="4" fill={color} />
  </svg>;
}
