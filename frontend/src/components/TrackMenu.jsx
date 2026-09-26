import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

/**
 * Overflow menu for a track. Keyboard: Enter/Space opens, arrows move, Escape closes and restores focus.
 * `items`: [{ label, icon, onSelect, tone }]
 */
export default function TrackMenu({ items, label, trigger, triggerClass = 'icon-btn' }) {
  const [open, setOpen] = useState(false);
  const [placeUp, setPlaceUp] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const rect = buttonRef.current.getBoundingClientRect();
    setPlaceUp(window.innerHeight - rect.bottom < 64 + items.length * 44);
    menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    const close = (event) => { if (!wrapRef.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open, items.length]);

  const onKeyDown = (event) => {
    const entries = [...menuRef.current.querySelectorAll('[role="menuitem"]')];
    const at = entries.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); buttonRef.current.focus(); }
    if (event.key === 'ArrowDown') { event.preventDefault(); entries[(at + 1) % entries.length].focus(); }
    if (event.key === 'ArrowUp') { event.preventDefault(); entries[(at - 1 + entries.length) % entries.length].focus(); }
    if (event.key === 'Tab') setOpen(false);
  };

  return <div className="menu-wrap" ref={wrapRef}>
    <button ref={buttonRef} type="button" className={triggerClass} aria-haspopup="menu" aria-expanded={open} aria-label={label}
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>
      {trigger || <MoreHorizontal />}
    </button>
    {open && <div ref={menuRef} className={`menu ${placeUp ? 'menu--up' : ''}`} role="menu" onKeyDown={onKeyDown}>
      {items.map(({ label: itemLabel, icon: Icon, onSelect, tone }) => <button key={itemLabel} type="button" role="menuitem"
        className={`menu__item ${tone === 'danger' ? 'menu__item--danger' : ''}`}
        onClick={(e) => { e.stopPropagation(); setOpen(false); onSelect(); }}>
        {Icon && <Icon aria-hidden="true" />}{itemLabel}
      </button>)}
    </div>}
  </div>;
}
