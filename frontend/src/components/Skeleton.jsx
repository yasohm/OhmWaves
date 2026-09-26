export function ShelfSkeleton({ count = 6 }) {
  return <div className="shelf" aria-hidden="true">
    <div className="skeleton skeleton--title" />
    <div className="shelf__row">
      {Array.from({ length: count }, (_, i) => <div key={i} className="card card--skeleton">
        <div className="skeleton skeleton--art" /><div className="skeleton skeleton--line" /><div className="skeleton skeleton--line short" />
      </div>)}
    </div>
  </div>;
}

export function ListSkeleton({ rows = 8 }) {
  return <div className="track-list" aria-hidden="true">
    {Array.from({ length: rows }, (_, i) => <div key={i} className="track-row track-row--skeleton">
      <div className="skeleton skeleton--thumb" /><div className="skeleton-stack"><div className="skeleton skeleton--line" /><div className="skeleton skeleton--line short" /></div>
    </div>)}
  </div>;
}
