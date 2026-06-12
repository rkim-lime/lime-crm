import { useEffect } from 'react';
import { createPortal } from 'react-dom';

export default function SlidePanel({ title, onClose, children, width = 520 }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return createPortal(
    <div className="slide-panel-overlay" onClick={onClose}>
      <div className="slide-panel" style={{ width, maxWidth: 'calc(100vw - 48px)' }} onClick={e => e.stopPropagation()}>
        <div className="slide-panel-header">
          <span className="slide-panel-title">{title}</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="slide-panel-body">{children}</div>
      </div>
    </div>,
    document.body
  );
}

export function PanelFooter({ children }) {
  return <div className="slide-panel-footer">{children}</div>;
}
