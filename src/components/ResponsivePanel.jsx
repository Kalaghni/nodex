import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export const COMPACT_QUERY = '(max-width: 1023px)';

export function useCompactLayout() {
  const [compact, setCompact] = useState(() => window.matchMedia(COMPACT_QUERY).matches);
  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const update = () => setCompact(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return compact;
}

// Keep the same controls in the desktop layout and a native modal on phones.
// <dialog> supplies focus containment, Escape, and focus restoration.
export default function ResponsivePanel({ id, title, compact, open, onClose, className, children }) {
  const dialogRef = useRef(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [compact, open]);

  if (!compact) return <div id={id} className={className}>{children}</div>;
  return (
    <dialog
      ref={dialogRef}
      id={id}
      className="nx-mobile-panel"
      aria-labelledby={`${id}-title`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="nx-panel-header">
        <h2 id={`${id}-title`} className="font-semibold text-lg">{title}</h2>
        <button type="button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}>
          <X size={22} />
        </button>
      </div>
      <div className={`nx-panel-body ${id === 'editor-actions' ? 'nx-actions-body' : 'p-4'}`}>
        {children}
      </div>
    </dialog>
  );
}
