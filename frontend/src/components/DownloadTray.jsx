import { Download } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';

/** Compact progress for background downloads, replacing the old blocking modal. */
export default function DownloadTray() {
  const { jobs } = useLibrary();
  const active = Object.entries(jobs);
  if (!active.length) return null;
  return <aside className="download-tray" aria-label="Downloads">
    {active.map(([id, job]) => {
      const total = job.total || 1;
      const prepared = (job.completed || 0) + (job.status === 'completed' ? 0 : (job.current_percent || 0) / 100);
      // Phone downloads have two legs: the server converts, then the phone copies. Each is half the bar.
      const done = job.device ? job.status === 'saved' : job.status === 'completed';
      const fraction = done ? 1 : job.device ? (prepared + (job.saved || 0) + (job.saving || 0)) / (2 * total) : prepared / total;
      const detail = done ? (job.device ? 'Saved to your phone' : 'Saved to your library')
        : job.status === 'queued' ? 'Waiting…'
          : job.device && job.status === 'completed' ? `Saving to phone • ${job.saved || 0} of ${job.total}`
            : `${job.completed || 0} of ${job.total} • ${Math.round(job.current_percent || 0)}%`;
      return <div key={id} className="download-tray__item">
        <Download aria-hidden="true" />
        <div className="download-tray__text">
          <strong>{job.label}</strong>
          <small>{detail}</small>
          <progress max="1" value={Math.min(1, fraction)} aria-label={`Download progress for ${job.label}`} />
        </div>
      </div>;
    })}
  </aside>;
}
