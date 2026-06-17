import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

const MENU_HEIGHT = 150; // estimated max dropdown height

// items: Array<{ label, onClick, danger?, disabled? }>
export default function ActionMenu({ items }) {
  const [open, setOpen]   = useState(false);
  const [pos,  setPos]    = useState({ top: 0, left: 0, openUp: false });
  const btnRef = useRef(null);

  const close = useCallback(() => setOpen(false), []);

  const handleOpen = () => {
    if (open) { close(); return; }
    const rect = btnRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const openUp = spaceBelow < MENU_HEIGHT;
    setPos({
      top:    openUp ? rect.top   : rect.bottom + 4,
      left:   rect.right,
      openUp,
    });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown   = (e) => { if (!btnRef.current?.contains(e.target)) close(); };
    const onScroll = () => close();
    const onResize = () => close();
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll',     onScroll, true);
    window.addEventListener('resize',     onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll',     onScroll, true);
      window.removeEventListener('resize',     onResize);
    };
  }, [open, close]);

  return (
    <div className="card-menu" onClick={e => e.stopPropagation()}>
      <button ref={btnRef} className="card-menu-btn" onClick={handleOpen} title="Actions">⋮</button>
      {open && createPortal(
        <div
          className="card-menu-dropdown"
          style={{
            position:  'fixed',
            top:       pos.openUp ? undefined : pos.top,
            bottom:    pos.openUp ? window.innerHeight - pos.top : undefined,
            left:      pos.left,
            transform: 'translateX(-100%)',
            zIndex:    1000,
          }}
        >
          {items.map((item, i) => (
            <button
              key={i}
              style={item.danger ? { color: 'var(--red)' } : {}}
              disabled={item.disabled}
              onClick={() => { item.onClick(); close(); }}
            >
              {item.label}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
