'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/**
 * Persistent vertical navigation, MyAIO-style: an icon rail that widens to show
 * labels on large screens. Lives in the root layout so it survives navigation.
 */

type Item = { href: string; label: string; icon: React.ReactNode; match: (p: string) => boolean };

const s = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

const ICON = {
  dashboard: (
    <svg {...s}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></svg>
  ),
  crawl: (
    <svg {...s}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
  ),
  insights: (
    <svg {...s}><path d="M3 3v18h18" /><path d="m7 14 4-4 3 3 5-6" /></svg>
  ),
  aivis: (
    <svg {...s}><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="M12 8.5 13.4 11 16 12l-2.6 1-1.4 2.5L10.6 13 8 12l2.6-1z" /></svg>
  ),
  content: (
    <svg {...s}><path d="M4 4h16v16H4z" /><path d="M8 9h8M8 13h8M8 17h5" /></svg>
  ),
  ranks: (
    <svg {...s}><path d="M5 21V9M12 21V4M19 21v-8" /></svg>
  ),
  backlinks: (
    <svg {...s}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></svg>
  ),
  schedule: (
    <svg {...s}><rect x="3" y="4" width="18" height="18" rx="0" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
  ),
};

const ITEMS: Item[] = [
  { href: '/', label: 'Dashboard', icon: ICON.dashboard, match: (p) => p === '/' },
  { href: '/projects', label: 'Projects', icon: ICON.crawl, match: (p) => p.startsWith('/project') || p === '/crawls' || p.startsWith('/crawl/') },
  { href: '/insights', label: 'Insights', icon: ICON.insights, match: (p) => p.startsWith('/insights') },
  { href: '/ai-visibility', label: 'AI visibility', icon: ICON.aivis, match: (p) => p.startsWith('/ai-visibility') },
  { href: '/content', label: 'Content', icon: ICON.content, match: (p) => p.startsWith('/content') },
  { href: '/ranks', label: 'Ranks', icon: ICON.ranks, match: (p) => p.startsWith('/ranks') },
  { href: '/backlinks', label: 'Backlinks', icon: ICON.backlinks, match: (p) => p.startsWith('/backlinks') },
  { href: '/schedule', label: 'Schedule', icon: ICON.schedule, match: (p) => p.startsWith('/schedule') },
];

export function Sidebar() {
  const pathname = usePathname() || '/';

  return (
    <aside className="sticky top-0 z-20 flex h-screen w-[64px] shrink-0 flex-col border-r border-line bg-surface lg:w-[220px]">
      <Link
        href="/"
        className="flex h-[60px] items-center gap-2.5 border-b border-line px-4 no-underline"
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center border border-ink text-[13px] font-normal text-ink">
          S
        </span>
        <span className="hidden flex-col leading-none lg:flex">
          <span className="text-[14px] font-normal tracking-tight text-ink">SiteOptimizer</span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-3">
        {ITEMS.map((it) => {
          const active = it.match(pathname);
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={active ? 'page' : undefined}
              title={it.label}
              className={
                'group relative mx-2 flex items-center gap-3 px-3 py-2.5 no-underline transition-colors ' +
                (active
                  ? 'bg-surface-2 text-ink'
                  : 'text-muted hover:bg-surface-2 hover:text-ink')
              }
            >
              <span
                className={
                  'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 bg-ink transition-opacity ' +
                  (active ? 'opacity-100' : 'opacity-0')
                }
              />
              <span className="grid h-[18px] w-[18px] shrink-0 place-items-center">{it.icon}</span>
              <span className="hidden text-[13px] font-normal lg:block">{it.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="hidden border-t border-line px-4 py-3 lg:block">
        <p className="font-mono text-[9px] uppercase leading-relaxed tracking-[0.12em] text-muted">
          Next.js · Postgres
        </p>
      </div>
    </aside>
  );
}
