'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export function Dialog({ open, onClose, title, children, className = '' }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); closeRef.current(); }} onClick={event => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) closeRef.current(); } }} className={`shared-dialog ${className}`}>
      <div className="flex items-center justify-between gap-4 border-b border-outline-variant/30 p-4">
        <h2 id={titleId} className="text-lg font-semibold min-w-0 break-words">{title}</h2>
        <button type="button" className="btn btn-ghost btn-icon" aria-label="Close dialog" onClick={onClose}>×</button>
      </div>
      <div className="p-4">{children}</div>
    </dialog>
  );
}
