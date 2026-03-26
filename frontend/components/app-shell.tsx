'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/', label: 'Library', icon: 'video_library' },
  { href: '/jobs', label: 'Jobs', icon: 'work_history' },
  { href: '/archive', label: 'Archive', icon: 'terminal' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* Top Navigation Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 h-16 bg-background flex items-center justify-between px-6 border-b border-cyan-400/15">
        <div className="flex items-center gap-8">
          <Link href="/" className="text-xl font-black tracking-tighter text-primary">
            SUBSARR
          </Link>
          <nav className="hidden md:flex gap-6 items-center">
            <Link
              href="/"
              className="font-headline tracking-[0.05em] uppercase text-sm font-bold text-on-surface opacity-70 hover:text-primary hover:opacity-100 transition-all duration-200"
            >
              Library
            </Link>
            <Link
              href="/jobs"
              className="font-headline tracking-[0.05em] uppercase text-sm font-bold text-on-surface opacity-70 hover:text-primary hover:opacity-100 transition-all duration-200"
            >
              Jobs
            </Link>
            <Link
              href="/archive"
              className="font-headline tracking-[0.05em] uppercase text-sm font-bold text-on-surface opacity-70 hover:text-primary hover:opacity-100 transition-all duration-200"
            >
              Archive
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative group">
            <input
              className="bg-surface-container text-xs font-headline tracking-widest px-4 py-2 w-48 focus:ring-1 focus:ring-primary text-primary placeholder-primary/50"
              placeholder="NODE SEARCH..."
              type="text"
            />
          </div>
          <Link href="/settings" className="material-symbols-outlined text-primary hover:text-primary/70 transition-colors">
            settings_input_component
          </Link>
        </div>
      </header>

      {/* Side Navigation */}
      <aside className="fixed left-0 top-16 bottom-0 w-64 bg-surface-container flex flex-col pt-8 pb-4 border-r border-cyan-400/15">
        <div className="px-6 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-surface-container-highest rounded-lg flex items-center justify-center text-primary">
              <span className="material-symbols-outlined" style={{ fontVariationSettings: 'FILL 1' }}>
                terminal
              </span>
            </div>
            <div>
              <h3 className="text-xs font-bold tracking-widest text-on-surface uppercase">OPERATIONS</h3>
              <p className="text-[10px] text-primary/60 font-mono">Precision Node 04</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          {links.map((link) => {
            const isActive = pathname === link.href || (link.href === '/' && pathname === '/');
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-6 py-3 font-body text-xs font-medium tracking-wide transition-all duration-200 hover:bg-surface-container-highest ${
                  isActive
                    ? 'text-primary bg-primary/10 border-l-4 border-primary'
                    : 'text-on-surface opacity-60 hover:opacity-100'
                }`}
              >
                <span className="material-symbols-outlined text-base">{link.icon}</span>
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-6 mt-auto border-t border-primary/5 pt-4">
          <a
            href="https://github.com/yourusername/subsarr"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 py-2 font-body text-xs text-on-surface opacity-60 hover:opacity-100 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">description</span>
            Documentation
          </a>
        </div>
      </aside>

      {/* Main Content */}
      <main className="ml-64 pt-16 min-h-screen bg-surface">
        <div className="max-w-6xl mx-auto px-8 py-12">{children}</div>
      </main>
    </div>
  );
}
