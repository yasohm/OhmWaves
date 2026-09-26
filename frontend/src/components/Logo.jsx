export default function Logo({ compact = false }) {
  return <span className="logo" aria-label="OhmWave">
    <svg viewBox="0 0 64 64" aria-hidden="true" className="logo__mark">
      <rect width="64" height="64" rx="16" fill="var(--brand-teal)" />
      <path d="M8 34h9l4-10 6 22 6-30 6 26 4-8h13" fill="none" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    {!compact && <span className="logo__word">OhmWave</span>}
  </span>;
}
