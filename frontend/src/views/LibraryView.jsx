import { useMemo, useState } from 'react';
import { Download, Heart, RefreshCw, Search, WifiOff } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';
import { totalDurationLabel } from '../lib/tracks';
import CollectionHero from '../components/CollectionHero';
import TrackList from '../components/TrackList';
import EmptyState from '../components/EmptyState';
import ConfirmDialog from '../components/ConfirmDialog';
import { ListSkeleton } from '../components/Skeleton';

const FORMATS = ['mp3', 'm4a', 'flac', 'opus', 'wav'];
const QUALITIES = ['320', '256', '192', '128'];

function Filter({ value, onChange, label }) {
  return <label className="filter-field">
    <Search aria-hidden="true" />
    <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={label} aria-label={label} />
  </label>;
}

const matches = (track, text) => !text || `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(text.toLowerCase());

export default function LibraryView({ tab = 'liked', navigate }) {
  const library = useLibrary();
  const [filter, setFilter] = useState('');
  const [pendingDelete, setPendingDelete] = useState(null);
  const isLiked = tab === 'liked';
  const all = isLiked ? library.likes : library.downloadedTracks;
  const tracks = useMemo(() => all.filter((t) => matches(t, filter)), [all, filter]);

  const tabs = <div className="chip-row" role="tablist" aria-label="Library sections">
    {[['liked', 'Liked Songs'], ['downloads', 'Downloads']].map(([id, label]) => <button key={id} type="button" role="tab"
      aria-selected={tab === id} className={`chip ${tab === id ? 'is-active' : ''}`}
      onClick={() => { setFilter(''); navigate({ name: 'library', tab: id }, { replace: true }); }}>{label}</button>)}
  </div>;

  const meta = [`${all.length} ${all.length === 1 ? 'song' : 'songs'}`, isLiked ? totalDurationLabel(all) : `${all.reduce((sum, t) => sum + (t.sizeMb || 0), 0).toFixed(0)} MB on this device`].filter(Boolean).join(' • ');

  return <div className="page page--collection">
    <div className="mobile-only library-tabs">{tabs}</div>
    <CollectionHero
      kicker={isLiked ? 'Collection' : 'On this device'}
      title={isLiked ? 'Liked Songs' : 'Downloads'}
      meta={meta}
      icon={isLiked ? Heart : Download}
      iconClass={isLiked ? 'collection-icon--liked' : 'collection-icon--downloads'}
      color={isLiked ? '80 56 160' : '14 80 60'}
      tracks={tracks}
      source={isLiked ? 'Liked Songs' : 'Downloads'}
      extraActions={!isLiked && <button type="button" className="icon-btn icon-btn--lg" onClick={library.refreshFiles} aria-label="Refresh downloads"><RefreshCw /></button>}
    />

    <div className="toolbar">
      <div className="desktop-only">{tabs}</div>
      {all.length > 0 && <Filter value={filter} onChange={setFilter} label={`Find in ${isLiked ? 'Liked Songs' : 'Downloads'}`} />}
      {!isLiked && <div className="download-settings" role="group" aria-label="Download settings">
        <label>Format
          <select value={library.settings.format} onChange={(e) => library.setSettings({ format: e.target.value })}>
            {FORMATS.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </label>
        <label>Quality
          <select value={library.settings.quality} onChange={(e) => library.setSettings({ quality: e.target.value })}>
            {QUALITIES.map((q) => <option key={q} value={q}>{q} kbps</option>)}
          </select>
        </label>
      </div>}
    </div>

    {!isLiked && library.filesState === 'loading' && <ListSkeleton />}
    {!isLiked && library.filesState === 'error' && <EmptyState icon={WifiOff} title="Couldn’t read your downloads"
      action={<button type="button" className="btn btn--primary" onClick={library.refreshFiles}>Try again</button>}>The OhmWave server may be offline.</EmptyState>}

    {(isLiked || library.filesState === 'ready') && (all.length === 0
      ? <EmptyState icon={isLiked ? Heart : Download} title={isLiked ? 'Songs you like will appear here' : 'No downloads yet'}
        action={<button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>Find music</button>}>
        {isLiked ? 'Tap the heart on any song to save it here. Likes also teach your recommendations.' : 'Download songs to listen offline. They’ll be saved with cover art and tags.'}
      </EmptyState>
      : tracks.length === 0
        ? <EmptyState icon={Search} title={`Nothing matches “${filter}”`}>Try a different title or artist.</EmptyState>
        : <TrackList tracks={tracks} source={isLiked ? 'Liked Songs' : 'Downloads'} onDelete={isLiked ? undefined : setPendingDelete} />)}

    <ConfirmDialog open={!!pendingDelete} title="Delete from this device?"
      message={pendingDelete ? `“${pendingDelete.title}” will be permanently removed from your downloads.` : ''}
      confirmLabel="Delete" onCancel={() => setPendingDelete(null)}
      onConfirm={() => { library.deleteFile(pendingDelete); setPendingDelete(null); }} />
  </div>;
}
