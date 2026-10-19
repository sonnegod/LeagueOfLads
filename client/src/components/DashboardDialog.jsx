import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

export default function DashboardDialog({ title, onClose, children }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    return () => { element.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return createPortal(<dialog ref={dialog} className="dashboard-dialog" aria-labelledby={titleId}
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" autoFocus onClick={onClose}>Close</button></header>
    <div className="dashboard-dialog-body">{children}</div>
  </dialog>, document.body);
}
