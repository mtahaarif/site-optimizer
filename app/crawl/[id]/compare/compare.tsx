'use client';

import Link from 'next/link';
import type { CrawlHistoryPoint } from '@/src/crawler/store.ts';
import type { Severity } from '@/src/core/scoring/model.ts';
import { SeverityChip, scoreBand } from '../../../ui.tsx';

export interface IssueRef { id: string; title: string; severity: Severity; count: number }

/** Vertical bar series for one metric across crawls; the newest bar is emphasized. */
function BarSeries({
  label, points, value, color,
}: {
  label: string;
  points: CrawlHistoryPoint[];
  value: (p: CrawlHistoryPoint) => number;
  color?: (p: CrawlHistoryPoint) => string;
}) {
  const vals = points.map(value);
  const max = Math.max(1, ...vals);
  return (
    <div className="border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">{label}</h3>
        <span className="tnum font-mono text-[13px] font-bold text-ink">{vals[vals.length - 1] ?? 0}</span>
      </div>
      <div className="mt-4 flex h-[120px] items-end gap-1">
        {points.map((p, i) => {
          const v = value(p);
          const last = i === points.length - 1;
          return (
            <div
              key={p.id}
              title={`${new Date(p.created_at).toLocaleDateString()} · ${v}`}
              className="flex-1"
              style={{
                height: Math.max(2, (v / max) * 120) + 'px',
                background: color ? color(p) : (last ? 'rgb(var(--ink))' : 'rgb(var(--line-strong))'),
                opacity: last ? 1 : 0.75,
              }}
            />
          );
        })}
      </div>
      <p className="mt-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">
        {points.length} crawls · oldest → newest
      </p>
    </div>
  );
}

export function Compare({
  origin, createdAt, history, current, previous,
}: {
  origin: string;
  createdAt: string;
  history: CrawlHistoryPoint[];
  current: IssueRef[];
  previous: IssueRef[] | null;
}) {
  const curIds = new Set(current.map((c) => c.id));
  const prevIds = new Set((previous ?? []).map((c) => c.id));
  const appeared = current.filter((c) => !prevIds.has(c.id));
  const fixed = (previous ?? []).filter((c) => !curIds.has(c.id));
  const shown = history.slice(-24);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={`/crawl/${history[history.length - 1]?.id ?? ''}`} className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink">
          ← Report
        </Link>
        <h1 className="mt-3 text-[28px] font-normal tracking-tight">
          Compare audits · {origin.replace(/^https?:\/\//, '')}
        </h1>
        <p className="mt-1 font-mono text-[11.5px] text-muted">
          {history.length} audits · latest {new Date(createdAt).toLocaleString()}
        </p>
      </div>

      {history.length < 2 ? (
        <p className="border border-line bg-surface p-8 text-center text-[14px] text-muted">
          Only one crawl stored for this site. Run another audit to see trends and the
          appeared / fixed diff.
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <BarSeries
              label="Site health (score)"
              points={shown}
              value={(p) => Math.round(p.score)}
              color={(p) => (p.id === shown[shown.length - 1]?.id ? scoreBand(p.score).color : 'rgb(var(--line-strong))')}
            />
            <BarSeries label="Pages crawled" points={shown} value={(p) => p.pages} />
            <BarSeries label="Issues (checks failed)" points={shown} value={(p) => p.checks_failed} />
          </div>

          {/* per-issue diff vs previous crawl */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="border border-line bg-surface p-5">
              <h2 className="flex items-baseline justify-between font-mono text-[10.5px] font-bold uppercase tracking-[0.18em]">
                <span className="text-opportunity">Fixed since last crawl</span>
                <span className="tnum text-muted">{fixed.length}</span>
              </h2>
              <ul className="mt-4 flex flex-col gap-2">
                {previous === null && <li className="text-[13px] text-muted">No earlier crawl to diff against.</li>}
                {previous !== null && fixed.length === 0 && <li className="text-[13px] text-muted">Nothing newly resolved.</li>}
                {fixed.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 border-l-2 border-opportunity pl-2.5">
                    <SeverityChip severity={c.severity} />
                    <span className="text-[13px] text-ink">{c.title}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border border-line bg-surface p-5">
              <h2 className="flex items-baseline justify-between font-mono text-[10.5px] font-bold uppercase tracking-[0.18em]">
                <span className="text-blocker">Appeared since last crawl</span>
                <span className="tnum text-muted">{appeared.length}</span>
              </h2>
              <ul className="mt-4 flex flex-col gap-2">
                {previous === null && <li className="text-[13px] text-muted">First crawl — everything is new.</li>}
                {previous !== null && appeared.length === 0 && <li className="text-[13px] text-muted">No new regressions. Clean.</li>}
                {appeared.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 border-l-2 border-blocker pl-2.5">
                    <SeverityChip severity={c.severity} />
                    <span className="text-[13px] text-ink">{c.title}</span>
                    {c.count > 0 && <span className="tnum font-mono text-[11px] text-muted">{c.count} pages</span>}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
