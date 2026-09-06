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

// Labels name what the section does rather than what it is called internally.
// Two words each, deliberately: this nav is the only set of internal links on
// every page, and a one-word anchor repeated site-wide passes almost no signal
// about its destination — the `outgoing-one-word-anchor` finding in our own
// audit. Being clearer to a first-time user is the same change.
const ITEMS: Item[] = [
  { href: '/', label: 'Site dashboard', icon: ICON.dashboard, match: (p) => p === '/' },
  { href: '/projects', label: 'Your projects', icon: ICON.crawl, match: (p) => p.startsWith('/project') || p === '/crawls' || p.startsWith('/crawl/') },
  { href: '/insights', label: 'Search insights', icon: ICON.insights, match: (p) => p.startsWith('/insights') },
  { href: '/ai-visibility', label: 'AI visibility', icon: ICON.aivis, match: (p) => p.startsWith('/ai-visibility') },
  { href: '/content', label: 'Content quality', icon: ICON.content, match: (p) => p.startsWith('/content') },
  { href: '/ranks', label: 'Rank tracking', icon: ICON.ranks, match: (p) => p.startsWith('/ranks') },
  { href: '/backlinks', label: 'Backlink monitor', icon: ICON.backlinks, match: (p) => p.startsWith('/backlinks') },
  { href: '/schedule', label: 'Schedule & alerts', icon: ICON.schedule, match: (p) => p.startsWith('/schedule') },
];

export function Sidebar() {
  const pathname = usePathname() || '/';

  return (
    <aside className="nav-rail">
      <Link href="/" className="nav-brand">
        <span aria-hidden="true" className="nav-mark">S</span>{' '}
        <span className="hidden flex-col leading-none lg:flex">
          <span className="nav-wordmark">Site Optimizer</span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto py-3">
        {ITEMS.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            aria-current={it.match(pathname) ? 'page' : undefined}
            title={it.label}
            className="nav-item"
          >
            <span className="nav-marker" />
            <span className="nav-icon">{it.icon}</span>
            <span className="nav-label">{it.label}</span>
          </Link>
        ))}
      </nav>

      <div className="nav-foot">
        <p>Next.js · Postgres</p>
      </div>
    </aside>
  );
}
