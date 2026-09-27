import { CloudOff, Loader2 } from 'lucide-react';
import { useConnection } from '../context/ConnectionContext';

/** Shown on every screen while the phone app is offline, with a way back online. */
export default function OfflineBanner() {
  const { offline, offlineMode, checking, check, setOfflineMode } = useConnection();
  if (!offline) return null;
  return <div className="offline-banner" role="status">
    <CloudOff aria-hidden="true" />
    <span className="offline-banner__text">
      <strong>{offlineMode ? 'Offline mode' : 'You’re offline'}</strong>
      <small>Only music saved on this phone plays</small>
    </span>
    {offlineMode
      ? <button type="button" className="btn btn--outline btn--sm" onClick={() => setOfflineMode(false)}>Go online</button>
      : <button type="button" className="btn btn--outline btn--sm" onClick={check} disabled={checking}>
        {checking ? <><Loader2 className="spin" aria-hidden="true" />Checking…</> : 'Retry'}
      </button>}
  </div>;
}
