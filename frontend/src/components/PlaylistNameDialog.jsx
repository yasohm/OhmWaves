import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

const MAX_NAME = 100;

/** Name a new playlist or rename one. `onSubmit(name)` may be async; the dialog stays open (and busy) until it settles. */
export default function PlaylistNameDialog({ open, title, initialName = '', confirmLabel, onSubmit, onCancel }) {
  const ref = useRef(null);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) { setName(initialName); setBusy(false); dialog.showModal(); }
    if (!open && dialog.open) dialog.close();
  }, [open, initialName]);

  const trimmed = name.trim();
  const submit = async (event) => {
    event.preventDefault();
    if (!trimmed || busy) return;
    setBusy(true);
    try { await onSubmit(trimmed); } finally { setBusy(false); }
  };

  return <dialog ref={ref} className="dialog" aria-labelledby="playlist-name-title"
    onCancel={(e) => { e.preventDefault(); if (!busy) onCancel(); }}
    onClick={(e) => { if (e.target === ref.current && !busy) onCancel(); }}>
    <form onSubmit={submit}>
      <h2 id="playlist-name-title">{title}</h2>
      <label className="dialog__field">
        <span>Name</span>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={MAX_NAME}
          placeholder="My playlist" autoComplete="off" autoFocus required />
      </label>
      <div className="dialog__actions">
        <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn--primary" disabled={!trimmed || busy}>
          {busy && <Loader2 className="spin" aria-hidden="true" />}{confirmLabel}
        </button>
      </div>
    </form>
  </dialog>;
}
