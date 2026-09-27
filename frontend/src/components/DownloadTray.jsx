import { ArrowDown, Check } from 'lucide-react';
import { useLibrary } from '../context/LibraryContext';

/** How far along a job is (0–1), whether it's finished, and a short status line. */
function progressOf(job) {
  const total = job.total || 1;
  const prepared = (job.completed || 0) + (job.status === 'completed' ? 0 : (job.current_percent || 0) / 100);
  // Phone downloads have two legs: the server converts, then the phone copies. Each is half the bar.
  const done = job.device ? job.status === 'saved' : job.status === 'completed';
  const fraction = done ? 1 : job.device ? (prepared + (job.saved || 0) + (job.saving || 0)) / (2 * total) : prepared / total;
  const finished = job.device ? (job.saved || 0) : (job.completed || 0);
  const detail = done ? (job.device ? 'Saved to your phone' : 'Saved to your library')
    : job.status === 'queued' ? 'Waiting…'
      : job.device && job.status === 'completed' ? `Saving to phone · ${finished} of ${job.total}`
        : `${finished} of ${job.total} tracks`;
  return { fraction: Math.min(1, fraction), done, detail, total: job.total || 1 };
}

const RING = 2 * Math.PI * 15;

/** Slim download bar docked above the mini player, one line for all active downloads. */
export default function DownloadTray() {
  const { jobs } = useLibrary();
  const active = Object.values(jobs);
  if (!active.length) return null;

  const items = active.map((job) => ({ job, ...progressOf(job) }));
  const done = items.every((i) => i.done);
  const tracks = items.reduce((sum, i) => sum + i.total, 0);
  const fraction = items.reduce((sum, i) => sum + i.fraction * i.total, 0) / tracks;
  const percent = Math.round(fraction * 100);
  const single = items.length === 1 ? items[0] : null;
  const title = done ? 'Downloaded' : 'Downloading';
  const subject = single ? single.job.label : `${items.length} downloads`;
  const detail = single ? single.detail : `${items.filter((i) => i.done).length} of ${items.length} finished`;

  return <aside className={`download-bar ${done ? 'is-done' : ''}`} aria-label="Downloads">
    <span className="download-bar__ring" role="progressbar" aria-label="Download progress"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15" className="download-bar__track" />
        <circle cx="18" cy="18" r="15" className="download-bar__fill" style={{ strokeDasharray: RING, strokeDashoffset: RING * (1 - fraction) }} />
      </svg>
      {done ? <Check aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
    </span>
    <span className="download-bar__text" role="status">
      <strong><span className="download-bar__verb">{title}</span> {subject}</strong>
      <small>{detail}</small>
    </span>
    {!done && <span className="download-bar__percent mono" aria-hidden="true">{percent}%</span>}
  </aside>;
}
