import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { ToastProvider } from './context/ToastContext';
import { LibraryProvider } from './context/LibraryContext';
import { PlayerProvider, usePlayer } from './context/PlayerContext';
import { BottomNav, Sidebar } from './components/Navigation';
import PlayerBar from './components/PlayerBar';
import NowPlaying from './components/NowPlaying';
import QueuePanel from './components/QueuePanel';
import DownloadTray from './components/DownloadTray';
import HomeView from './views/HomeView';
import SearchView, { initialSearchState } from './views/SearchView';
import LibraryView from './views/LibraryView';
import AlbumView from './views/AlbumView';

/** Routes live in browser history so Back (and Android's back button) behaves as expected. */
function useRouter(scrollRef) {
  const [route, setRoute] = useState(() => window.history.state?.name ? window.history.state : { name: 'home' });

  useEffect(() => {
    if (!window.history.state?.name) window.history.replaceState({ name: 'home' }, '');
    const onPop = (event) => setRoute(event.state?.name ? event.state : { name: 'home' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((next, { replace = false } = {}) => {
    if (replace) window.history.replaceState(next, ''); else window.history.pushState(next, '');
    setRoute(next);
    if (!next.overlay) scrollRef.current?.scrollTo({ top: 0 });
  }, [scrollRef]);

  return [route, navigate];
}

function Shell() {
  const mainRef = useRef(null);
  const [route, navigate] = useRouter(mainRef);
  const { current } = usePlayer();
  const [queueOpen, setQueueOpen] = useState(false);
  const [searchState, setSearchState] = useState(initialSearchState);
  const [pendingSearch, setPendingSearch] = useState(null);

  const go = useCallback((next, options) => {
    if (next.name === 'search' && next.query) {
      setPendingSearch({ query: next.query, category: next.category });
      navigate({ name: 'search' }, options);
      return;
    }
    navigate(next, options);
  }, [navigate]);

  const openPlayer = () => navigate({ ...route, overlay: 'player' });
  const closePlayer = useCallback(() => window.history.back(), []);
  const clearPending = useCallback(() => setPendingSearch(null), []);

  let view;
  if (route.name === 'search') view = <SearchView state={searchState} setState={setSearchState} navigate={go} pending={pendingSearch} clearPending={clearPending} />;
  else if (route.name === 'library') view = <LibraryView tab={route.tab || 'liked'} navigate={go} />;
  else if (route.name === 'album' && route.album) view = <AlbumView key={route.album.id} album={route.album} />;
  else view = <HomeView navigate={go} />;

  return <div className={`app ${current ? 'has-player' : ''} ${queueOpen && current ? 'has-queue' : ''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <Sidebar route={route} navigate={go} />
    <main id="main" ref={mainRef} className="panel main" tabIndex={-1}>
      {route.name === 'album' && <div className="topbar">
        <button type="button" className="icon-btn icon-btn--soft" onClick={() => window.history.back()} aria-label="Go back"><ChevronLeft /></button>
      </div>}
      {view}
    </main>
    {queueOpen && current && <QueuePanel onClose={() => setQueueOpen(false)} />}
    <PlayerBar onExpand={openPlayer} onToggleQueue={() => setQueueOpen((v) => !v)} queueOpen={queueOpen} />
    <BottomNav route={route} navigate={go} />
    <DownloadTray />
    {route.overlay === 'player' && current && <NowPlaying onClose={closePlayer} />}
  </div>;
}

export default function App() {
  return <ToastProvider>
    <LibraryProvider>
      <PlayerProvider>
        <Shell />
      </PlayerProvider>
    </LibraryProvider>
  </ToastProvider>;
}
