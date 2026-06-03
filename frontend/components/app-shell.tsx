'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { appStrings } from '@/lib/app-strings';

const navLinks = [
  { href: '/', label: appStrings.nav.library, icon: 'video_library' },
  { href: '/dashboard', label: appStrings.nav.dashboard, icon: 'dashboard' },
  { href: '/jobs', label: appStrings.nav.jobs, icon: 'work_history' },
  { href: '/rename', label: appStrings.nav.rename, icon: 'drive_file_rename_outline' },
  { href: '/archive', label: appStrings.nav.logs, icon: 'terminal' },
  { href: '/settings', label: appStrings.nav.settings, icon: 'settings' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const activeLink = useMemo(
    () =>
      navLinks.find((link) =>
        link.href === '/' ? pathname === '/' : pathname.startsWith(link.href),
      ) ?? navLinks[0],
    [pathname],
  );

  return (
    <div className="min-h-screen bg-background text-on-surface">
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-surface-container-low border-b border-outline-variant/20 flex items-center px-3 md:px-4 gap-3">
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="btn btn-ghost btn-icon hidden md:!flex"
          aria-label="Toggle sidebar"
        >
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>

        <div className="md:hidden flex items-center gap-2 min-w-0">
          <span
            className="material-symbols-outlined text-[20px] text-primary"
            style={{ fontVariationSettings: 'FILL 1' }}
          >
            {activeLink.icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface truncate">{activeLink.label}</p>
            <p className="text-[10px] uppercase tracking-wide text-on-surface-variant">
              Subsarr
            </p>
          </div>
        </div>

        <Link
          href="/"
          className="hidden md:block text-base font-bold tracking-tight text-primary select-none"
        >
          Subsarr
        </Link>

        <div className="flex-1" />

        <ThemeToggle />

        {pathname !== '/settings' && (
          <Link
            href="/settings"
            className="md:hidden btn btn-ghost btn-icon"
            aria-label="Open settings"
          >
            <span className="material-symbols-outlined text-[20px]">settings</span>
          </Link>
        )}

        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const active =
              link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <aside
        className={`
          fixed top-14 bottom-0 left-0 z-30
          bg-surface-container-low flex flex-col
          transition-[width] duration-250 ease-in-out
          border-r border-outline-variant/20
          ${collapsed ? 'w-[60px]' : 'w-[220px]'}
          hidden md:flex
        `}
      >
        <SidebarContent collapsed={collapsed} pathname={pathname} />
      </aside>

      <main
        className={`pt-14 pb-[84px] md:pb-0 min-h-screen bg-surface transition-[margin-left] duration-250 ease-in-out ${
          collapsed ? 'md:ml-[60px]' : 'md:ml-[220px]'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8">{children}</div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-40 h-[72px] bg-surface-container-low border-t border-outline-variant/20 md:hidden">
        <ul className="h-full grid grid-cols-6">
          {navLinks.map((link) => {
            const active =
              link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
            return (
              <li key={link.href} className="min-w-0">
                <Link
                  href={link.href}
                  className={`h-full flex flex-col items-center justify-center gap-1 text-[10px] font-medium ${
                    active ? 'text-primary' : 'text-on-surface-variant'
                  }`}
                >
                  <span
                    className="material-symbols-outlined text-[19px]"
                    style={{ fontVariationSettings: active ? 'FILL 1' : 'FILL 0' }}
                  >
                    {link.icon}
                  </span>
                  <span className="truncate max-w-[54px]">{link.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function SidebarContent({
  collapsed,
  pathname,
}: {
  collapsed: boolean;
  pathname: string;
}) {
  return (
    <>
      <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {navLinks.map((link) => {
          const active =
            link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              title={collapsed ? link.label : undefined}
              className={`
                flex items-center gap-3 px-4 py-2.5 text-sm font-medium
                transition-all duration-150 relative group
                ${
                  active
                    ? 'text-primary bg-primary/8'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }
                ${
                  active
                    ? 'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-primary before:rounded-r'
                    : ''
                }
              `}
            >
              <span
                className="material-symbols-outlined text-[20px] flex-shrink-0"
                style={{ fontVariationSettings: active ? 'FILL 1' : 'FILL 0' }}
              >
                {link.icon}
              </span>
              {!collapsed && <span className="truncate">{link.label}</span>}
              {collapsed && (
                <span className="absolute left-full ml-2 px-2 py-1 text-xs rounded bg-surface-container-highest text-on-surface whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-50">
                  {link.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className={`border-t border-outline-variant/20 ${collapsed ? 'p-2' : 'px-4 py-3'}`}>
        <a
          href="https://github.com/yourusername/subsarr"
          target="_blank"
          rel="noopener noreferrer"
          title={collapsed ? 'Documentation' : undefined}
          className="flex items-center gap-3 text-xs text-on-surface-variant hover:text-on-surface transition-colors py-1"
        >
          <span className="material-symbols-outlined text-[18px] flex-shrink-0">
            description
          </span>
          {!collapsed && <span>Docs</span>}
        </a>
      </div>
    </>
  );
}
