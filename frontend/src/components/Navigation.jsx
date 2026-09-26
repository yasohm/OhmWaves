import { Download, Heart, Home, Library, Search } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import Logo from './Logo';

export const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'library', label: 'Your Library', shortLabel: 'Library', icon: Library },
];

const isActive = (route, id) => route.name === id || (id === 'library' && route.name === 'library');

export function Sidebar({ route, navigate }) {
  const { likes, files, jobs } = useLibrary();
  const activeDownloads = Object.values(jobs).filter((j) => j.status !== 'completed').length;
  const collections = [
    { tab: 'liked', label: 'Liked Songs', meta: `${likes.length} ${likes.length === 1 ? 'song' : 'songs'}`, icon: Heart, className: 'collection-icon--liked' },
    { tab: 'downloads', label: 'Downloads', meta: activeDownloads ? `${activeDownloads} in progress…` : `${files.length} on this device`, icon: Download, className: 'collection-icon--downloads' },
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
      <h2 className="eyebrow">Collections</h2>
      <ul>
        {collections.map(({ tab, label, meta, icon: Icon, className }) => {
          const active = route.name === 'library' && (route.tab || 'liked') === tab;
          return <li key={tab}>
            <button type="button" className={`collection-link ${active ? 'is-active' : ''}`} onClick={() => navigate({ name: 'library', tab })}
              aria-current={active ? 'page' : undefined}>
              <span className={`collection-icon ${className}`}><Icon aria-hidden="true" fill={tab === 'liked' ? 'currentColor' : 'none'} /></span>
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
