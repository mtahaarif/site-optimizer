'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Severity } from '@/src/core/scoring/model.ts';
import { ScoreDial, SeverityChip, scoreBand } from '../../ui.tsx';

export interface IssueRef { id: string; title: string; severity: Severity }

export interface ProjectCrawl {
  id: string; created_at: number; score: number;
  issues: number; blockers: number; criticals: number; warnings: number;
}

export interface ProjectData {
  origin: string;
  crawls: ProjectCrawl[];
  fixedSinceFirst: IssueRef[];
  appearedSinceFirst: IssueRef[];
}

const SEV_COLOR: Record<Severity, string> = {
  blocker: 'rgb(var(--blocker))',
  critical: 'rgb(var(--critical))',
  warning: 'rgb(var(--warning))',
  opportunity: 'rgb(var(--opportunity))',
  notice: 'rgb(var(--notice))',
};

const fmtDate = (ts: number) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const fmtFull = (ts: number) => new Date(ts).toLocaleString();

/** Floating readout shown while hovering a chart. */
function Tip({ left, children }: { left: string; children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap border border-ink bg-surface px-2.5 py-1.5 text-[11px] leading-relaxed shadow-sm"
      style={{ left }}
    >
      {children}
    </div>
  );
}

/** Score across every audit, with a hover readout of the exact value. */
export function ScoreTrend({ crawls }: { crawls: ProjectCrawl[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 200, PAD = 28;
  const n = crawls.length;
  const x = (i: number) => (n <= 1 ? W / 2 : PAD + (i / (n - 1)) * (W - PAD * 2));
  const y = (s: number) => PAD + (1 - s / 100) * (H - PAD * 2);
  const pts = crawls.map((c, i) => `${x(i)},${y(c.score)}`).join(' ');
  const last = crawls[n - 1]!;
  const hc = hover !== null ? crawls[hover] : null;

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0) return;
    const vx = ((e.clientX - r.left) / r.width) * W;          // container px -> viewBox units
    const frac = n <= 1 ? 0 : (vx - PAD) / (W - PAD * 2);
    setHover(Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1)))));
  }

  return (
    <div className="border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Technical health over time</h3>
        <span className="tnum font-mono text-[13px] font-bold" style={{ color: scoreBand((hc ?? last).score).color }}>
          {(hc ?? last).score.toFixed(0)}
        </span>
      </div>

      <div className="relative mt-3" onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {hc && (
          <Tip left={`${(x(hover!) / W) * 100}%`}>
            <span className="font-medium text-ink">{hc.score.toFixed(1)}</span>
            <span className="text-muted"> · {fmtFull(hc.created_at)}</span>
          </Tip>
        )}
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }}>
          {[0, 50, 100].map((g) => (
            <g key={g}>
              <line x1={PAD} x2={W - PAD} y1={y(g)} y2={y(g)} style={{ stroke: 'rgb(var(--line))' }} strokeWidth="1" />
              <text x={4} y={y(g) + 3} style={{ fontSize: 10, fill: 'rgb(var(--muted))' }}>{g}</text>
            </g>
          ))}
          {hc && <line x1={x(hover!)} x2={x(hover!)} y1={PAD} y2={H - PAD} style={{ stroke: 'rgb(var(--line-strong))' }} strokeWidth="1" />}
          {n > 1 && <polyline points={pts} fill="none" style={{ stroke: 'rgb(var(--ink))' }} strokeWidth="2" />}
          {crawls.map((c, i) => (
            <circle key={c.id} cx={x(i)} cy={y(c.score)} r={hover === i ? 6 : i === n - 1 ? 5 : 3}
              style={{ fill: scoreBand(c.score).color }} />
          ))}
        </svg>
      </div>

      <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted">
        <span>{fmtDate(crawls[0]!.created_at)}</span>
        <span>{n} {n === 1 ? 'audit' : 'audits'}</span>
        <span>{fmtDate(last.created_at)}</span>
      </div>
    </div>
  );
}

/** Issue counts per audit, stacked by priority, with a hover breakdown. */
export function IssuesTrend({ crawls }: { crawls: ProjectCrawl[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...crawls.map((c) => c.blockers + c.criticals + c.warnings));
  const n = crawls.length;
  const hc = hover !== null ? crawls[hover] : null;

  return (
    <div className="border border-line bg-surface p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Issues over time</h3>
        <span className="tnum font-mono text-[13px] font-bold text-ink">
          {(hc ?? crawls[n - 1]!).issues}
        </span>
      </div>

      <div className="relative mt-4" onMouseLeave={() => setHover(null)}>
        {hc && (
          <Tip left={`${((hover! + 0.5) / n) * 100}%`}>
            <div className="font-medium text-ink">{hc.issues} issues · {fmtFull(hc.created_at)}</div>
            <div className="mt-0.5 flex gap-2.5 font-mono text-[10px]">
              <span style={{ color: SEV_COLOR.blocker }}>{hc.blockers} blocker</span>
              <span style={{ color: SEV_COLOR.critical }}>{hc.criticals} critical</span>
              <span style={{ color: SEV_COLOR.warning }}>{hc.warnings} warning</span>
            </div>
          </Tip>
        )}
        <div className="flex h-[160px] items-end gap-1">
          {crawls.map((c, i) => {
            const seg = (v: number, color: string) => (
              <div style={{ height: `${(v / max) * 150}px`, background: color }} />
            );
            return (
              <div key={c.id} onMouseEnter={() => setHover(i)}
                className="flex flex-1 cursor-default flex-col justify-end"
                style={{ opacity: hover === null || hover === i ? 1 : 0.45 }}>
                {seg(c.warnings, SEV_COLOR.warning)}
                {seg(c.criticals, SEV_COLOR.critical)}
                {seg(c.blockers, SEV_COLOR.blocker)}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[9.5px] uppercase tracking-[0.08em] text-muted">
        <span className="flex items-center gap-1.5"><i className="h-2 w-2" style={{ background: SEV_COLOR.blocker }} />Blocker</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2" style={{ background: SEV_COLOR.critical }} />Critical</span>
        <span className="flex items-center gap-1.5"><i className="h-2 w-2" style={{ background: SEV_COLOR.warning }} />Warning</span>
      </div>
    </div>
  );
}

/** Current score plus how far it has moved since the very first audit. */
export function ProjectScoreCard({ crawls }: { crawls: ProjectCrawl[] }) {
  const first = crawls[0]!;
  const latest = crawls[crawls.length - 1]!;
  const delta = Math.round((latest.score - first.score) * 10) / 10;

  return (
    <div className="flex flex-col gap-5 border border-line bg-surface p-6 lg:flex-row lg:items-center">
      <ScoreDial score={latest.score} />
      <div className="flex-1">
        <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">Technical health</h2>
        {crawls.length > 1 ? (
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            <span className="text-[16px] font-medium" style={{ color: delta === 0 ? 'rgb(var(--muted))' : delta > 0 ? 'rgb(var(--opportunity))' : 'rgb(var(--blocker))' }}>
              {delta > 0 ? '+' : ''}{delta}
            </span>{' '}
            since the first audit ({first.score.toFixed(0)} on {new Date(first.created_at).toLocaleDateString()}).
            {' '}That&rsquo;s {delta > 0 ? 'an improvement' : delta < 0 ? 'a drop' : 'no change'} across {crawls.length} audits.
          </p>
        ) : (
          <p className="mt-2 text-[14px] text-muted">First audit — this is your baseline. Run another to see the trend.</p>
        )}
      </div>
    </div>
  );
}

/** Every audit for this project, newest first. */
export function ProjectAudits({ crawls }: { crawls: ProjectCrawl[] }) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[520px] border-collapse font-mono text-[12px]">
        <caption className="sr-only">Every audit of this project by date, score and issue count</caption>
        <thead>
          <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.1em] text-muted">
            <th className="pb-2 pr-4">Date</th>
            <th className="pb-2 pr-4 text-right">Score</th>
            <th className="pb-2 pr-4 text-right">vs previous</th>
            <th className="pb-2 pr-4 text-right">Issues</th>
            <th className="pb-2"></th>
          </tr>
        </thead>
        <tbody className="tnum">
          {[...crawls].reverse().map((c, ri, arr) => {
            const prev = arr[ri + 1];
            const d = prev ? Math.round((c.score - prev.score) * 10) / 10 : null;
            return (
              <tr key={c.id} className="border-b border-line/60 hover:bg-surface-2">
                <td className="py-2 pr-4 text-muted">{fmtFull(c.created_at)}</td>
                <td className="py-2 pr-4 text-right font-bold" style={{ color: scoreBand(c.score).color }}>{c.score.toFixed(0)}</td>
                <td className="py-2 pr-4 text-right">
                  {d === null ? <span className="text-muted">—</span>
                    : d === 0 ? <span className="text-muted">±0</span>
                      : <span style={{ color: d > 0 ? 'rgb(var(--opportunity))' : 'rgb(var(--blocker))' }}>{d > 0 ? '+' : ''}{d}</span>}
                </td>
                <td className="py-2 pr-4 text-right text-muted">{c.issues}</td>
                <td className="py-2 text-right">
                  <Link href={`/crawl/${c.id}`} className="text-accent hover:underline">Open report →</Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** What has been resolved and what is new, measured against the first audit. */
export function ProjectDiff({ fixed, appeared }: { fixed: IssueRef[]; appeared: IssueRef[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="border border-line bg-surface p-5">
        <h2 className="flex items-baseline justify-between font-mono text-[10.5px] font-bold uppercase tracking-[0.18em]">
          <span className="text-opportunity">Fixed since first audit</span>
          <span className="tnum text-muted">{fixed.length}</span>
        </h2>
        <ul className="mt-4 flex flex-col gap-2">
          {fixed.length === 0 && <li className="text-[13px] text-muted">Nothing resolved yet.</li>}
          {fixed.map((c) => (
            <li key={c.id} className="flex items-center gap-2 border-l-2 border-opportunity pl-2.5">
              <SeverityChip severity={c.severity} /><span className="text-[13px] text-ink">{c.title}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="border border-line bg-surface p-5">
        <h2 className="flex items-baseline justify-between font-mono text-[10.5px] font-bold uppercase tracking-[0.18em]">
          <span className="text-blocker">New since first audit</span>
          <span className="tnum text-muted">{appeared.length}</span>
        </h2>
        <ul className="mt-4 flex flex-col gap-2">
          {appeared.length === 0 && <li className="text-[13px] text-muted">No new issues. Clean.</li>}
          {appeared.map((c) => (
            <li key={c.id} className="flex items-center gap-2 border-l-2 border-blocker pl-2.5">
              <SeverityChip severity={c.severity} /><span className="text-[13px] text-ink">{c.title}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
