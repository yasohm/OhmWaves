import { Download } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';

/** Compact progress for background downloads, replacing the old blocking modal. */
export default function DownloadTray() {
  const { jobs } = useLibrary();
  const active = Object.entries(jobs);
  if (!active.length) return null;
  return <aside className="download-tray" aria-label="Downloads">
    {active.map(([id, job]) => {
      const done = job.status === 'completed';
      const fraction = done ? 1 : ((job.completed || 0) + (job.current_percent || 0) / 100) / (job.total || 1);
      return <div key={id} className="download-tray__item">
        <Download aria-hidden="true" />
        <div className="download-tray__text">
          <strong>{job.label}</strong>
          <small>{done ? 'Saved to your library' : job.status === 'queued' ? 'Waiting…' : `${job.completed || 0} of ${job.total} • ${Math.round(job.current_percent || 0)}%`}</small>
          <progress max="1" value={Math.min(1, fraction)} aria-label={`Download progress for ${job.label}`} />
        </div>
      </div>;
    })}
  </aside>;
}
