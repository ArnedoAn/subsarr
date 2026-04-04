'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from '@/components/theme-toggle';
import { useEffect, useState } from 'react';

const navLinks = [
  { href: '/',        label: 'Library',  icon: 'video_library' },
  { href: '/jobs',    label: 'Jobs',     icon: 'work_history'  },
  { href: '/archive', label: 'Logs',     icon: 'terminal'      },
  { href: '/settings',label: 'Settings', icon: 'settings'      },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  /* Close mobile drawer on navigation */
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  /* Lock body scroll when mobile drawer open */
  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [mobileOpen]);

  return (
    <div className="min-h-screen bg-background text-on-surface">
      {/* ─── Top Header ─── */}
      <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-surface-container-low flex items-center px-4 gap-3">
        {/* Hamburger — always visible */}
        {/* Un solo botón por viewport: .btn fuerza display y anula `hidden` sin !important */}
        <button
          onClick={() => {
            if (window.innerWidth < 768) {
              setMobileOpen(v => !v);
            } else {
              setCollapsed(v => !v);
            }
          }}
          className="btn btn-ghost btn-icon md:!hidden"
          aria-label="Toggle navigation"
        >
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>
        <button
          onClick={() => setCollapsed(v => !v)}
          className="btn btn-ghost btn-icon !hidden md:!flex"
          aria-label="Toggle sidebar"
        >
          <span className="material-symbols-outlined text-[20px]">menu</span>
        </button>

        {/* Logo */}
        <Link href="/" className="text-base font-bold tracking-tight text-primary select-none">
          Subsarr
        </Link>

        {/* Spacer */}
        <div className="flex-1" />

        <ThemeToggle />

        {/* Header actions */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map(link => {
            const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
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

      {/* ─── Mobile overlay ─── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden fade-in"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ─── Sidebar ─── */}
      <aside
        className={`
          fixed top-14 bottom-0 left-0 z-50
          bg-surface-container-low flex flex-col
          transition-[width] duration-250 ease-in-out
          border-r border-outline-variant/20
          ${collapsed ? 'w-[60px]' : 'w-[220px]'}
          hidden md:flex
        `}
      >
        <SidebarContent collapsed={collapsed} pathname={pathname} />
      </aside>

      {/* Mobile Drawer */}
      <aside
        className={`
          fixed top-14 bottom-0 left-0 z-50 w-[220px]
          bg-surface-container-low flex flex-col
          border-r border-outline-variant/20
          md:hidden
          ${mobileOpen ? 'drawer-open' : 'translate-x-[-100%]'}
        `}
        style={{ transform: mobileOpen ? undefined : 'translateX(-100%)' }}
      >
        <SidebarContent collapsed={false} pathname={pathname} />
      </aside>

      {/* ─── Main Content ─── */}
      <main
        className={`pt-14 min-h-screen bg-surface transition-[margin-left] duration-250 ease-in-out ${
          collapsed ? 'md:ml-[60px]' : 'md:ml-[220px]'
        }`}
      >
        <div className="max-w-6xl mx-auto px-4 md:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}

function SidebarContent({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  return (
    <>
      {/* Nav Links */}
      <nav className="flex-1 py-4 space-y-0.5 overflow-y-auto overflow-x-hidden">
        {navLinks.map(link => {
          const active = link.href === '/' ? pathname === '/' : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              title={collapsed ? link.label : undefined}
              className={`
                flex items-center gap-3 px-4 py-2.5 text-sm font-medium
                transition-all duration-150 relative group
                ${active
                  ? 'text-primary bg-primary/8'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                }
                ${active ? 'before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:bg-primary before:rounded-r' : ''}
              `}
            >
              <span
                className="material-symbols-outlined text-[20px] flex-shrink-0"
                style={{ fontVariationSettings: active ? 'FILL 1' : 'FILL 0' }}
              >
                {link.icon}
              </span>
              {!collapsed && (
                <span className="truncate">{link.label}</span>
              )}
              {collapsed && (
                <span className="absolute left-full ml-2 px-2 py-1 text-xs rounded bg-surface-container-highest text-on-surface whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-lg z-50">
                  {link.label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className={`border-t border-outline-variant/20 ${collapsed ? 'p-2' : 'px-4 py-3'}`}>
        <a
          href="https://github.com/yourusername/subsarr"
          target="_blank"
          rel="noopener noreferrer"
          title={collapsed ? 'Documentation' : undefined}
          className="flex items-center gap-3 text-xs text-on-surface-variant hover:text-on-surface transition-colors py-1"
        >
          <span className="material-symbols-outlined text-[18px] flex-shrink-0">description</span>
          {!collapsed && <span>Docs</span>}
        </a>
      </div>
    </>
  );
}
