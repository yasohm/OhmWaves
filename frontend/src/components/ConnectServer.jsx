import { useEffect, useState } from 'react';
import { CloudOff, Loader2, Wifi } from 'lucide-react';
import OhmMark from './OhmMark';
import { DEFAULT_SERVER, getServer, normalizeServer, setServer } from '../lib/api';
import { readIndex } from '../lib/offline';

async function probe(base) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${base}/api/library`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.files)) throw new Error('not an OhmWaves server');
  } finally {
    clearTimeout(timer);
  }
}

/** Native app only: find the OhmWaves server running on the user's computer. */
export default function ConnectServer({ onConnected, onPlayOffline }) {
  const [address, setAddress] = useState(() => (getServer() || DEFAULT_SERVER).replace(/^http:\/\//, ''));
  const [status, setStatus] = useState('idle'); // idle | checking | error
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(0); // songs already on this phone, playable without a server
  useEffect(() => { readIndex().then((entries) => setSaved(entries.length)); }, []);

  const connect = async (event) => {
    event.preventDefault();
    const base = normalizeServer(address);
    if (!base) { setStatus('error'); setError('Enter your computer’s address, for example 192.168.1.20:5000.'); return; }
    setStatus('checking');
    setError('');
    try {
      await probe(base);
      setServer(base);
      onConnected();
    } catch (err) {
      setStatus('error');
      setError(err.name === 'AbortError' || err instanceof TypeError
        ? `Couldn’t reach ${base}. Check that “python app.py” is running on your computer and that your phone is on the same Wi‑Fi.`
        : `${base} answered, but it doesn’t look like an OhmWaves server.`);
    }
  };

  return <section className="welcome connect" aria-labelledby="connect-title">
    <div className="welcome__content">
      <div className="welcome__brand">
        <OhmMark />
        <span className="mono-label">Connect your library</span>
      </div>
      <h1 id="connect-title">OhmWaves</h1>
      <p>Your music lives on your computer. Enter the address of the OhmWaves server running there.</p>
      <form className="connect__form" onSubmit={connect} noValidate>
        <label className="mono-label" htmlFor="server-address">Server address</label>
        <div className="connect__field">
          <Wifi aria-hidden="true" />
          <input id="server-address" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false}
            value={address} onChange={(e) => setAddress(e.target.value)} placeholder="192.168.1.20:5000"
            aria-invalid={status === 'error'} aria-describedby="connect-help" />
        </div>
        <p id="connect-help" className={`connect__help ${status === 'error' ? 'is-error' : ''}`} role={status === 'error' ? 'alert' : undefined}>
          {status === 'error' ? error : 'On your computer, run “python app.py”. The address is its local IP and port 5000.'}
        </p>
        <button type="submit" className="btn btn--primary btn--block" disabled={status === 'checking'}>
          {status === 'checking' ? <><Loader2 className="spin" aria-hidden="true" />Connecting…</> : 'Connect'}
        </button>
        {saved > 0 && <button type="button" className="btn btn--outline btn--block" onClick={onPlayOffline}>
          <CloudOff aria-hidden="true" />Play {saved} downloaded {saved === 1 ? 'song' : 'songs'} offline
        </button>}
      </form>
    </div>
  </section>;
}
