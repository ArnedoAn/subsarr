import type { ReactNode } from 'react';

export function MobileStickyActionBar({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="md:hidden fixed left-3 right-3 bottom-[78px] z-30">
      <div className="bg-surface-container-highest border border-outline-variant/30 rounded-lg shadow-2xl px-3 py-2.5">
        {children}
      </div>
    </div>
  );
}
