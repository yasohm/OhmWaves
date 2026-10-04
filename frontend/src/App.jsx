import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, CloudOff } from 'lucide-react';
import { ToastProvider } from './context/ToastContext';
import { LibraryProvider } from './context/LibraryContext';
import { PlaylistsProvider } from './context/PlaylistsContext';
import { ConnectionProvider, readOfflineMode, saveOfflineMode, useConnection } from './context/ConnectionContext';
import { PlayerProvider, usePlayer } from './context/PlayerContext';
import { BottomNav, Sidebar } from './components/Navigation';
import PlayerBar from './components/PlayerBar';
import NowPlaying from './components/NowPlaying';
import QueuePanel from './components/QueuePanel';
import DownloadTray from './components/DownloadTray';
import HomeView from './views/HomeView';
import OfflineHome from './views/OfflineHome';
import OfflineBanner from './components/OfflineBanner';
import EmptyState from './components/EmptyState';
import SearchView, { initialSearchState } from './views/SearchView';
import LibraryView from './views/LibraryView';
import AlbumView from './views/AlbumView';
import CollectionView from './views/CollectionView';
import Welcome from './components/Welcome';
import ConnectServer from './components/ConnectServer';
import { isNativeApp, needsServer, setServer } from './lib/api';
import { primaryArtist } from './lib/collections';

const WELCOME_KEY = 'ohmwave:welcomed';
const hasSeenWelcome = () => { try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return true; } };

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
  const { current, playerRequests } = usePlayer();
  const { offline } = useConnection();
  const [queueOpen, setQueueOpen] = useState(false);
  const [searchState, setSearchState] = useState(initialSearchState);
  const [pendingSearch, setPendingSearch] = useState(null);
  const [showWelcome, setShowWelcome] = useState(() => !hasSeenWelcome());

  const go = useCallback((next, options) => {
    if (next.name === 'search' && next.query) {
      setPendingSearch({ query: next.query, category: next.category });
      navigate({ name: 'search' }, options);
      return;
    }
    navigate(next, options);
  }, [navigate]);

  const openPlayer = () => navigate({ ...route, overlay: 'player' });
  // Tapping the phone's media notification opens the full-screen player (once there is a track to show).
  const handledRequests = useRef(0);
  useEffect(() => {
    if (!current || playerRequests === handledRequests.current) return;
    handledRequests.current = playerRequests;
    if (route.overlay !== 'player') navigate({ ...route, overlay: 'player' });
  }, [playerRequests, current, route, navigate]);
  const closePlayer = useCallback(() => window.history.back(), []);
  const clearPending = useCallback(() => setPendingSearch(null), []);
  const finishWelcome = (next) => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* shows again next time */ }
    setShowWelcome(false);
    if (next) go(next);
  };
  // From the full-screen player: replace its history entry so Back doesn't reopen it.
  const changeServer = () => { setServer(''); window.location.reload(); };
  // Offline, an artist opens the songs of theirs saved on this phone (search needs the server).
  const openArtist = (name) => go(offline ? { name: 'collection', kind: 'local-artist', artist: primaryArtist(name) }
    : { name: 'search', query: name, category: 'artist' }, { replace: true });

  let view;
  if (offline && route.name === 'search') view = <div className="page"><EmptyState icon={CloudOff} title="Search needs your OhmWaves server"
    action={<button type="button" className="btn btn--primary" onClick={() => go({ name: 'home' })}>Play your downloads</button>}>
    You’re offline. Everything you’ve downloaded still plays.
  </EmptyState></div>;
  else if (route.name === 'search') view = <SearchView state={searchState} setState={setSearchState} navigate={go} pending={pendingSearch} clearPending={clearPending} />;
  else if (route.name === 'library') view = <LibraryView tab={route.tab || 'playlists'} navigate={go} />;
  else if (route.name === 'collection') view = <CollectionView key={`${route.kind}-${route.id || route.album || route.artist || ''}`} route={route} navigate={go} />;
  else if (route.name === 'album' && route.album) view = <AlbumView key={route.album.id} album={route.album} />;
  else if (offline) view = <OfflineHome navigate={go} onShowWelcome={() => setShowWelcome(true)} onChangeServer={changeServer} />;
  else view = <HomeView navigate={go} onShowWelcome={() => setShowWelcome(true)} onChangeServer={isNativeApp ? changeServer : undefined} />;

  return <div className={`app ${current ? 'has-player' : ''} ${queueOpen && current ? 'has-queue' : ''}`}>
    <a className="skip-link" href="#main">Skip to content</a>
    <Sidebar route={route} navigate={go} />
    <main id="main" ref={mainRef} className="panel main" tabIndex={-1}>
      {(route.name === 'album' || route.name === 'collection') && <div className="topbar">
        <button type="button" className="icon-btn icon-btn--soft" onClick={() => window.history.back()} aria-label="Go back"><ChevronLeft /></button>
      </div>}
      <OfflineBanner />
      {view}
    </main>
    {queueOpen && current && <QueuePanel onClose={() => setQueueOpen(false)} />}
    <PlayerBar onExpand={openPlayer} onToggleQueue={() => setQueueOpen((v) => !v)} queueOpen={queueOpen} />
    <BottomNav route={route} navigate={go} />
    <DownloadTray />
    {route.overlay === 'player' && current && <NowPlaying onClose={closePlayer} onOpenArtist={openArtist} />}
    {showWelcome && <Welcome onStart={() => finishWelcome()} onBrowse={() => finishWelcome({ name: 'search' })} onLibrary={() => finishWelcome({ name: 'library' })} />}
  </div>;
}

export default function App() {
  // The phone app needs to know where the server is before anything loads, unless it's playing downloads offline.
  const [connected, setConnected] = useState(() => !needsServer() || readOfflineMode());
  const playOffline = () => { saveOfflineMode(true); setConnected(true); };
  if (!connected) return <ConnectServer onConnected={() => setConnected(true)} onPlayOffline={playOffline} />;
  return <ToastProvider>
    <ConnectionProvider onNeedServer={() => setConnected(false)}>
      <LibraryProvider>
        <PlaylistsProvider>
          <PlayerProvider>
            <Shell />
          </PlayerProvider>
        </PlaylistsProvider>
      </LibraryProvider>
    </ConnectionProvider>
  </ToastProvider>;
}
