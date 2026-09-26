import { useEffect, useRef } from 'react';

/** Native <dialog>: focus trapping, Escape to cancel and inert background come for free. */
export default function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'danger', onConfirm, onCancel }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onCancel(); }} onClick={(e) => { if (e.target === ref.current) onCancel(); }}>
    <h2>{title}</h2>
    <p>{message}</p>
    <div className="dialog__actions">
      <button type="button" className="btn btn--ghost" onClick={onCancel} autoFocus>Cancel</button>
      <button type="button" className={`btn ${tone === 'danger' ? 'btn--danger' : 'btn--primary'}`} onClick={onConfirm}>{confirmLabel}</button>
    </div>
  </dialog>;
}
