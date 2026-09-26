import { Home, Library, Search } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import Logo from './Logo';
import Artwork from './Artwork';

export const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Your Library', shortLabel: 'Library', icon: Library },
];

const isActive = (route, id) => route.name === id || (id === 'library' && (route.name === 'collection' || route.name === 'album'));

export function Sidebar({ route, navigate }) {
  const { likes, files, jobs } = useLibrary();
  const activeDownloads = Object.values(jobs).filter((j) => j.status !== 'completed').length;
  const collections = [
    { id: 'liked', label: 'Liked Songs', meta: `Playlist · ${likes.length} ${likes.length === 1 ? 'song' : 'songs'}`, variant: 'bands', route: { name: 'collection', kind: 'liked' } },
    { id: 'downloaded', label: 'Downloaded', meta: activeDownloads ? `${activeDownloads} in progress…` : `${files.length} on this device`, variant: 'stripes', route: { name: 'library', tab: 'downloaded' } },
  ];
  return <aside className="sidebar" aria-label="Sidebar">
    <div className="panel sidebar__nav">
      <Logo />
      <nav aria-label="Main">
        <ul>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => <li key={id}>
            <button type="button" className={`nav-link ${isActive(route, id) ? 'is-active' : ''}`}
              aria-current={isActive(route, id) ? 'page' : undefined} onClick={() => navigate({ name: id })}>
              <Icon aria-hidden="true" />{label}
            </button>
          </li>)}
        </ul>
      </nav>
    </div>
    <div className="panel sidebar__library">
      <h2 className="mono-label">Collections</h2>
      <ul>
        {collections.map(({ id, label, meta, variant, route: target }) => {
          const active = id === 'liked' ? route.name === 'collection' && route.kind === 'liked' : route.name === 'library' && route.tab === 'downloaded';
          return <li key={id}>
            <button type="button" className={`collection-link ${active ? 'is-active' : ''}`} onClick={() => navigate(target)}
              aria-current={active ? 'page' : undefined}>
              <Artwork title={label} variant={variant} className="collection-link__art" />
              <span className="collection-link__text"><strong>{label}</strong><small>{meta}</small></span>
            </button>
          </li>;
        })}
      </ul>
    </div>
  </aside>;
}

export function BottomNav({ route, navigate }) {
  return <nav className="bottom-nav" aria-label="Main">
    {NAV_ITEMS.map(({ id, label, shortLabel, icon: Icon }) => <button key={id} type="button"
      className={isActive(route, id) ? 'is-active' : ''} aria-current={isActive(route, id) ? 'page' : undefined}
      onClick={() => navigate({ name: id })}>
      <Icon aria-hidden="true" /><span>{shortLabel || label}</span>
    </button>)}
  </nav>;
}
