import { useCallback, useEffect, useMemo, useState } from 'react';
import { BotOff, CloudOff, ShieldCheck, WifiOff } from 'lucide-react';
import { api } from '../lib/api';
import { normalizeTrack } from '../lib/tracks';
import { useAiFilter } from '../context/AiFilterContext';
import { useConnection } from '../context/ConnectionContext';
import TrackList from '../components/TrackList';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';

const REASONS = {
  you: () => 'You marked it as AI',
  listed: () => 'Confirmed AI artist',
  model: (p) => `Detected by OhmWaves${p != null ? ` · ${Math.round(p * 100)}% sure` : ''}`,
};
const percent = (value) => `${Math.round(value * 100)}%`;

/** The AI music filter: on/off, what it has hidden and why, and a way to bring back anything it got wrong. */
export default function AiHiddenView() {
  const ai = useAiFilter();
  const { remember } = ai;
  const { offline } = useConnection();
  const [status, setStatus] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error

  const load = useCallback(async () => {
    setState('loading');
    try {
      const [summary, flagged] = await Promise.all([api.get('/api/ai-filter'), api.get('/api/ai-filter/flagged')]);
      setStatus(summary);
      const list = flagged.tracks || [];
      remember(list.map((t) => t.videoId)); // so their menus offer "Not AI, show it"
      setTracks(list.map((t) => ({ ...normalizeTrack(t), reason: (REASONS[t.ai?.reason] || REASONS.model)(t.ai?.probability) })));
      setState('ready');
    } catch {
      setState('error');
    }
  }, [remember]);
  useEffect(() => { if (!offline) load(); }, [offline, load]);

  // Songs you mark "Not AI" leave the list straight away.
  const shown = useMemo(() => tracks.filter((t) => ai.isAi(t)), [tracks, ai]);
  const held = status?.model?.held_out;

  if (offline) {
    return <div className="page"><EmptyState icon={CloudOff} title="The AI filter needs your OhmWaves server">
      Songs already hidden stay hidden while you’re offline.
    </EmptyState></div>;
  }

  return <div className="page page--ai-filter">
    <header className="page-head">
      <h1 className="page-title">AI music filter</h1>
    </header>

    <section className="ai-filter-card" aria-labelledby="ai-filter-title">
      <div className="ai-filter-card__row">
        <ShieldCheck aria-hidden="true" className="ai-filter-card__icon" />
        <div>
          <h2 id="ai-filter-title">Show only human-made music</h2>
          <p>AI-generated songs are left out of search, Home, albums and mixes. In your own playlists and downloads they’re tagged <span className="ai-tag">AI</span> instead.</p>
        </div>
        <button type="button" role="switch" aria-checked={ai.enabled} className={`switch ${ai.enabled ? 'is-on' : ''}`}
          onClick={() => ai.setEnabled(!ai.enabled)} aria-labelledby="ai-filter-title"><span /></button>
      </div>
      {status && <dl className="ai-filter-card__stats">
        <div><dt>Songs checked</dt><dd>{status.checked}</dd></div>
        <div><dt>Hidden as AI</dt><dd>{status.hidden}</dd></div>
        <div><dt>Known AI artists</dt><dd>{status.known_ai_artists}</dd></div>
        <div><dt>Detector</dt><dd>{status.model ? `Trained ${status.model.version.slice(0, 8)}` : 'Not trained yet'}</dd></div>
      </dl>}
      {held && <p className="ai-filter-card__note">
        In testing on artists it had never heard, the detector caught {percent(held.ai_caught)} of AI songs and wrongly flagged {percent(held.human_wrongly_flagged)} of human ones. If it gets one wrong, choose <strong>Not AI, show it</strong> from the song’s menu.
      </p>}
    </section>

    <h2 className="section-title">Hidden songs</h2>
    {state === 'loading' && <ListSkeleton />}
    {state === 'error' && <EmptyState icon={WifiOff} title="Couldn’t load the AI filter"
      action={<button type="button" className="btn btn--primary" onClick={load}>Try again</button>}>Check that your OhmWaves server is running.</EmptyState>}
    {state === 'ready' && (shown.length
      ? <TrackList tracks={shown} source="Hidden as AI" hideAi={false} showReason showAlbum={false} />
      : <EmptyState icon={BotOff} title="Nothing hidden yet">Songs the filter catches show up here, so you can bring back any it got wrong.</EmptyState>)}

    <p className="credit">{status?.credit || 'AI artist data by Soul Over AI (https://souloverai.com), CC BY 4.0.'}</p>
  </div>;
}
