import { useState, useRef, useEffect } from 'react';

// items: Array<{ label, onClick, danger?, disabled? }>
export default function ActionMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="card-menu" onClick={e => e.stopPropagation()}>
      <button className="card-menu-btn" onClick={() => setOpen(o => !o)} title="Actions">⋮</button>
      {open && (
        <div className="card-menu-dropdown">
          {items.map((item, i) => (
            <button
              key={i}
              style={item.danger ? { color: 'var(--red)' } : {}}
              disabled={item.disabled}
              onClick={() => { item.onClick(); setOpen(false); }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
