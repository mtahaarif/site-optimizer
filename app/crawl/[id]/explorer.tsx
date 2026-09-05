'use client';

import { useMemo, useState } from 'react';
import type { AuditReport, PageSummary } from '@/src/crawler/audit.ts';
import { scoreBand, shortUrl } from '../../ui.tsx';

/**
 * Page Explorer — a per-URL table over the crawl, with importance and health
 * columns and the segment presets a large-site audit needs. Every column is
 * data the crawl already produced; Segments are two importance presets plus a
 * URL-pattern filter (their whole "segments" feature, essentially).
 */

type Segment = 'all' | 'top10' | 'top25' | 'indexable' | 'orphans';
type SortKey = 'importance' | 'depth' | 'score' | 'issues' | 'inDegree' | 'url';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'all', label: 'All pages' },
  { key: 'top10', label: 'Top 10% important' },
  { key: 'top25', label: 'Top 25% important' },
  { key: 'indexable', label: 'Indexable only' },
  { key: 'orphans', label: 'Orphans' },
];

function pageType(p: PageSummary): string {
  let path = '/';
  try { path = new URL(p.url).pathname; } catch { /* keep default */ }
  if (path === '/' || path === '') return 'Home';
  if (/\/(blog|news|article|post|insights)\b/i.test(path)) return 'Blog';
  if (/\/(service|services|product|products|pricing)\b/i.test(path)) return 'Service';
  if (/\/(about|contact|team|careers|company)\b/i.test(path)) return 'Info';
  return p.strategy ? p.strategy.toUpperCase() : 'Page';
}

const YesNo = ({ v }: { v: boolean }) =>
  v ? <span className="text-opportunity">yes</span> : <span className="text-muted">—</span>;

export function PageExplorer({ report }: { report: AuditReport }) {
  const [segment, setSegment] = useState<Segment>('all');
  const [pattern, setPattern] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('importance');
  const [asc, setAsc] = useState(false);

  const html = useMemo(() => report.pages.filter((p) => p.isHtml), [report]);

  // Importance thresholds for the segment presets.
  const rankThreshold = useMemo(() => {
    const ranks = [...html].map((p) => p.pageRank).sort((a, b) => b - a);
    const at = (pct: number) => ranks[Math.max(0, Math.ceil(ranks.length * pct) - 1)] ?? 0;
    return { top10: at(0.1), top25: at(0.25) };
  }, [html]);

  const rows = useMemo(() => {
    let out = html;
    if (segment === 'top10') out = out.filter((p) => p.pageRank >= rankThreshold.top10);
    else if (segment === 'top25') out = out.filter((p) => p.pageRank >= rankThreshold.top25);
    else if (segment === 'indexable') out = out.filter((p) => p.indexable);
    else if (segment === 'orphans') out = out.filter((p) => (p.inDegree ?? 0) === 0);
    if (pattern.trim()) {
      const q = pattern.trim().toLowerCase();
      out = out.filter((p) => p.url.toLowerCase().includes(q));
    }
    const dir = asc ? 1 : -1;
    const key = (p: PageSummary): number | string =>
      sortKey === 'importance' ? p.pageRank
        : sortKey === 'depth' ? p.depth
          : sortKey === 'score' ? p.score
            : sortKey === 'issues' ? p.issueCount
              : sortKey === 'inDegree' ? (p.inDegree ?? 0)
                : p.url;
    return [...out].sort((a, b) => {
      const ka = key(a), kb = key(b);
      return typeof ka === 'string' ? (ka as string).localeCompare(kb as string) * dir : ((ka as number) - (kb as number)) * dir;
    });
  }, [html, segment, pattern, sortKey, asc, rankThreshold]);

  const orphanCount = html.filter((p) => (p.inDegree ?? 0) === 0).length;

  const th = (key: SortKey, label: string, align = 'left') => (
    <th
      className={'cursor-pointer select-none pb-2 pr-3 text-[10px] uppercase tracking-[0.1em] hover:text-ink ' + (align === 'right' ? 'text-right' : 'text-left')}
      onClick={() => { if (sortKey === key) setAsc(!asc); else { setSortKey(key); setAsc(false); } }}
    >
      {label}{sortKey === key ? (asc ? ' ▲' : ' ▼') : ''}
    </th>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* segment + pattern controls */}
      <div className="flex flex-wrap items-center gap-2">
        {SEGMENTS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSegment(s.key)}
            className={
              'border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ' +
              (segment === s.key ? 'border-ink bg-ink text-ground' : 'border-line text-muted hover:border-ink hover:text-ink')
            }
          >
            {s.label}{s.key === 'orphans' && orphanCount ? ` (${orphanCount})` : ''}
          </button>
        ))}
        <input
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
          placeholder="URL contains…"
          className="ml-auto w-[220px] border border-line bg-ground px-2.5 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-ink"
        />
      </div>

      <p className="font-mono text-[11px] text-muted">{rows.length} of {html.length} pages</p>

      <div className="scroll-x">
        <table className="w-full min-w-[1000px] border-collapse font-mono text-[12px]">
          <caption className="sr-only">Every crawled page with type, sitemap membership and score</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              {th('url', 'Page')}
              <th className="pb-2 pr-3 text-left text-[10px] uppercase tracking-[0.1em]">Type</th>
              {th('depth', 'Depth', 'right')}
              {th('importance', 'Importance', 'right')}
              <th className="pb-2 pr-3 text-left text-[10px] uppercase tracking-[0.1em]">Sitemap</th>
              {th('inDegree', 'Linked', 'right')}
              <th className="pb-2 pr-3 text-left text-[10px] uppercase tracking-[0.1em]">Hreflang</th>
              <th className="pb-2 pr-3 text-left text-[10px] uppercase tracking-[0.1em]">Indexable</th>
              {th('score', 'Score', 'right')}
              {th('issues', 'Issues', 'right')}
            </tr>
          </thead>
          <tbody className="tnum">
            {rows.map((p) => {
              const orphan = (p.inDegree ?? 0) === 0;
              return (
                <tr key={p.url} className="border-b border-line/60 hover:bg-surface-2">
                  <td className="max-w-[280px] truncate py-2 pr-3">
                    <a href={p.url} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">
                      {shortUrl(p.url, 40)}
                    </a>
                  </td>
                  <td className="py-2 pr-3 text-muted">{pageType(p)}</td>
                  <td className="py-2 pr-3 text-right text-muted">{p.depth}</td>
                  <td className="py-2 pr-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span className="text-ink">{p.pageRank.toFixed(3)}</span>
                      <span className="h-[3px] w-10 bg-line"><span className="block h-full bg-ink" style={{ width: Math.min(100, p.pageRank * 100) + '%' }} /></span>
                    </div>
                  </td>
                  <td className="py-2 pr-3"><YesNo v={p.inSitemap} /></td>
                  <td className={'py-2 pr-3 text-right ' + (orphan ? 'text-blocker' : 'text-muted')}>
                    {orphan ? 'orphan' : (p.inDegree ?? 0)}
                  </td>
                  <td className="py-2 pr-3"><YesNo v={p.hasHreflang ?? false} /></td>
                  <td className="py-2 pr-3">{p.indexable ? <span className="text-opportunity">yes</span> : <span className="text-blocker">no</span>}</td>
                  <td className="py-2 pr-3 text-right font-bold" style={{ color: scoreBand(p.score).color }}>{p.score.toFixed(0)}</td>
                  <td className="py-2 pr-3 text-right text-muted">{p.issueCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
