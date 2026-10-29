'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';
import { Dialog } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { CommandPalette, NAVIGATION_COMMANDS } from '@/components/ui/command-palette';
import { useToast } from '@/components/ui/toast';
import { useJobEvents } from '@/lib/job-events';
import { useApiQuery } from '@/lib/use-api-query';
import type { BudgetStatus } from '@/lib/types';

interface SessionNotification { id: string; jobId: string; message: string; failed: boolean; time: number }
const primary = [NAVIGATION_COMMANDS[0], NAVIGATION_COMMANDS[1], NAVIGATION_COMMANDS[2], NAVIGATION_COMMANDS[4]];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<SessionNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const toast = useToast();
  const budget = useApiQuery<BudgetStatus>('/settings/budget', { intervalMs: 60000 });
  const refreshBudget = budget.refetch;
  const active = NAVIGATION_COMMANDS.find(link => link.href === '/' ? pathname === '/' || pathname.startsWith('/library/') : pathname.startsWith(link.href)) ?? NAVIGATION_COMMANDS[0];
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandsOpen(open => !open); } };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);
  useJobEvents(data => {
    const phase = data.phase ?? data.type;
    if (!['completed', 'failed', 'cancelled'].includes(phase ?? '')) return;
    const id = `${data.jobId}:${phase}:${data.timestamp ?? ''}`;
    const message = data.message || `Translation ${phase}`;
    setNotifications(current => [{ id, jobId: data.jobId, message, failed: phase === 'failed', time: Date.now() }, ...current].slice(0, 50));
    setUnread(count => Math.min(count + 1, 50));
    if (phase === 'failed') toast.error(message); else toast.info(message);
    refreshBudget();
  });
  const isActive = (href: string) => href === active.href;
  return <div className="min-h-screen bg-background text-on-surface">
    <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] btn btn-primary">Skip to content</a>
    <header className="fixed top-0 left-0 right-0 z-40 h-14 bg-surface-container-low border-b border-outline-variant/20 flex items-center px-3 md:px-4 gap-2">
      <button type="button" onClick={() => setCollapsed(value => !value)} className="btn btn-ghost btn-icon hidden md:flex" aria-label="Toggle sidebar" aria-expanded={!collapsed}><Icon name="menu" /></button>
      <Link href="/" className="font-bold text-primary hidden md:block">Subsarr</Link>
      <div className="md:hidden flex items-center gap-2 min-w-0"><Icon name={active.icon} /><span className="truncate text-sm font-semibold">{active.label}</span></div>
      <div className="flex-1" />
      <Link href="/settings?section=usage" aria-label={budget.error ? 'Budget unavailable; open usage settings' : 'Open budget and usage settings'} title={budget.error?.message ?? (budget.data?.budgetUsd == null ? 'Monthly spend · no budget configured' : 'Monthly translation budget')} className={`text-xs rounded px-2 py-1 min-w-0 ${budget.data?.level === 'exceeded' ? 'text-error bg-error/10' : budget.data?.level === 'warning' ? 'text-warning bg-warning/10' : 'text-on-surface-variant'}`}>
        {budget.data ? <><span>${budget.data.spentUsd.toFixed(2)}</span><span className="hidden sm:inline">{budget.data.budgetUsd == null ? ' spent' : ` / $${budget.data.budgetUsd.toFixed(2)}`}</span>{budget.data.level !== 'ok' && <span aria-label={budget.data.level}> !</span>}{budget.error && <span title="Last known budget; refresh failed"> · stale</span>}</> : budget.error ? 'Budget unavailable' : 'Budget…'}
      </Link>
      <button type="button" className="btn btn-ghost btn-icon" aria-label="Search commands (Control K)" onClick={() => setCommandsOpen(true)}><Icon name="search" /></button>
      <button type="button" className="btn btn-ghost btn-icon relative" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => { setNotificationsOpen(true); setUnread(0); }}><Icon name="notifications" />{unread > 0 && <span className="absolute top-0 right-0 rounded-full bg-primary text-on-primary px-1 text-[9px]">{unread}</span>}</button>
      <ThemeToggle />
    </header>
    <aside className={`fixed top-14 bottom-0 left-0 z-30 bg-surface-container-low border-r border-outline-variant/20 hidden md:flex flex-col transition-[width] ${collapsed ? 'w-[60px]' : 'w-[220px]'}`}>
      <nav aria-label="Main navigation" className="flex-1 py-4 overflow-y-auto">
        {NAVIGATION_COMMANDS.map((link, index) => <div key={link.href}>{index === 5 && !collapsed && <p className="px-4 pt-6 pb-2 text-[10px] uppercase text-on-surface-variant">Tools</p>}<Link href={link.href} title={collapsed ? link.label : undefined} aria-label={collapsed ? link.label : undefined} aria-current={isActive(link.href) ? 'page' : undefined} className={`flex items-center gap-3 px-4 py-3 text-sm ${isActive(link.href) ? 'text-primary bg-primary/8' : 'text-on-surface-variant hover:bg-surface-container-high'}`}><Icon name={link.icon} />{!collapsed && <span className="truncate">{link.label}</span>}</Link></div>)}
      </nav>
      {!collapsed && <button type="button" className="m-3 btn btn-secondary text-xs" onClick={() => setCommandsOpen(true)}>Search commands <kbd className="ml-auto">Ctrl K</kbd></button>}
    </aside>
    <main id="main-content" tabIndex={-1} className={`pt-14 pb-[calc(84px+env(safe-area-inset-bottom))] md:pb-0 min-h-screen bg-surface transition-[margin-left] ${collapsed ? 'md:ml-[60px]' : 'md:ml-[220px]'}`}><div className="max-w-6xl mx-auto px-4 md:px-8 py-6 md:py-8 min-w-0">{children}</div></main>
    <nav aria-label="Mobile navigation" className="fixed bottom-0 left-0 right-0 z-40 bg-surface-container-low border-t border-outline-variant/20 md:hidden pb-[env(safe-area-inset-bottom)]"><ul className="grid grid-cols-5 h-[72px]">{primary.map(link => <li key={link.href} className="min-w-0"><Link href={link.href} aria-current={isActive(link.href) ? 'page' : undefined} className={`h-full flex flex-col items-center justify-center gap-1 text-[10px] ${isActive(link.href) ? 'text-primary' : 'text-on-surface-variant'}`}><Icon name={link.icon} /><span className="truncate max-w-full px-1">{link.label}</span></Link></li>)}<li><button type="button" className={`w-full h-full flex flex-col items-center justify-center gap-1 text-[10px] ${!primary.some(link => link.href === active.href) ? 'text-primary' : 'text-on-surface-variant'}`} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen(true)}><Icon name="more_horiz" />More</button></li></ul></nav>
    <Dialog open={moreOpen} onClose={() => setMoreOpen(false)} title="More"><nav aria-label="More navigation" className="space-y-2">{NAVIGATION_COMMANDS.filter(link => !primary.some(entry => entry.href === link.href)).map(link => <Link key={link.href} href={link.href} onClick={() => setMoreOpen(false)} className="flex items-center gap-3 p-3 rounded hover:bg-surface-container-high"><Icon name={link.icon} />{link.label}</Link>)}<button type="button" className="btn btn-secondary w-full" onClick={() => { setMoreOpen(false); setCommandsOpen(true); }}>Search commands</button></nav></Dialog>
    <Dialog open={notificationsOpen} onClose={() => setNotificationsOpen(false)} title="Session notifications"><div className="flex justify-between gap-3 mb-3"><p className="text-xs text-on-surface-variant">Kept for this browser session only</p><button type="button" className="btn btn-ghost btn-xs" disabled={!notifications.length} onClick={() => { setNotifications([]); setUnread(0); }}>Clear</button></div>{!notifications.length ? <p className="text-sm text-on-surface-variant">No completed or failed translations this session.</p> : <ul className="space-y-2">{notifications.map(item => <li key={item.id}><Link href={`/activity?tab=history&q=${encodeURIComponent(item.jobId)}`} onClick={() => setNotificationsOpen(false)} className="block rounded border border-outline-variant/30 p-3 hover:bg-surface-container-high"><p className={`break-words text-sm ${item.failed ? 'text-error' : ''}`}>{item.message}</p><time className="text-xs text-on-surface-variant">{new Date(item.time).toLocaleTimeString()}</time></Link></li>)}</ul>}</Dialog>
    <CommandPalette open={commandsOpen} onClose={() => setCommandsOpen(false)} />
  </div>;
}
