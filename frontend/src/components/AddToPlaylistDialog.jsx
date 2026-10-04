import { useEffect, useRef } from 'react';
import { Check, Plus } from 'lucide-react';
import Artwork from './Artwork';
import { songCount } from '../lib/collections';

/** Pick which playlist to add songs to, or start a new one with them. */
export default function AddToPlaylistDialog({ open, tracks, playlists, onPick, onCreate, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const ids = new Set((tracks || []).map((t) => t.videoId));
  const subject = tracks?.length === 1 ? `“${tracks[0].title}”` : `${tracks?.length || 0} songs`;

  return <dialog ref={ref} className="dialog dialog--list" aria-labelledby="add-to-playlist-title"
    onCancel={(e) => { e.preventDefault(); onCancel(); }} onClick={(e) => { if (e.target === ref.current) onCancel(); }}>
    <h2 id="add-to-playlist-title">Add to playlist</h2>
    <p>{subject}</p>
    <ul className="playlist-picker">
      <li>
        <button type="button" className="playlist-picker__item" onClick={onCreate}>
          <span className="playlist-picker__new" aria-hidden="true"><Plus /></span>
          <span className="library-item__text"><strong>New playlist</strong></span>
        </button>
      </li>
      {playlists.map((p) => {
        // With one song, say when it's already there (adding again is a no-op on the server).
        const hasAll = ids.size > 0 && [...ids].every((id) => p.tracks.some((t) => t.videoId === id));
        return <li key={p.id}>
          <button type="button" className="playlist-picker__item" onClick={() => onPick(p)} aria-describedby={`pl-${p.id}-meta`}>
            <Artwork src={p.cover} title={p.name} className="playlist-picker__art" />
            <span className="library-item__text">
              <strong>{p.name}</strong>
              <small id={`pl-${p.id}-meta`}>{hasAll ? 'Already added' : songCount(p.tracks.length)}</small>
            </span>
            {hasAll && <Check className="playlist-picker__check" aria-hidden="true" />}
          </button>
        </li>;
      })}
    </ul>
    <div className="dialog__actions">
      <button type="button" className="btn btn--ghost" onClick={onCancel} autoFocus>Cancel</button>
    </div>
  </dialog>;
}
