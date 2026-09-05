'use client';

import { useMemo } from 'react';
import type { AuditReport } from '@/src/crawler/audit.ts';
import { computePillars, narratePillars } from '@/src/core/scoring/pillars.ts';

/**
 * Four-pillar rollup card + a one-line, deterministic narration. Presentation
 * over the same outcomes the site score uses — legible to a non-specialist, and
 * grounded in real GSC signal where connected.
 */
export function PillarCard({ report }: { report: AuditReport }) {
  const { pillars, narration } = useMemo(() => {
    const p = computePillars({
      outcomes: report.outcomes,
      gscConnected: report.traffic?.gsc?.connected ?? false,
      totalImpressions: report.traffic?.gsc?.totalImpressions ?? 0,
    });
    return { pillars: p, narration: narratePillars(p, report.score) };
  }, [report]);

  const band = (s: number) =>
    s >= 75 ? 'rgb(var(--opportunity))' : s >= 50 ? 'rgb(var(--warning))' : 'rgb(var(--blocker))';

  return (
    <section className="border border-line bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          Health pillars
        </h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
          {report.traffic?.gsc?.connected ? 'GSC-grounded' : 'checks only'}
        </span>
      </div>

      <p className="mt-3 max-w-[80ch] text-[14px] leading-relaxed text-ink">{narration}</p>

      <div className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {pillars.map((p) => (
          <div key={p.key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink">{p.label}</span>
              <span className="tnum font-mono text-[13px] font-bold" style={{ color: band(p.score) }}>{p.score}</span>
            </div>
            <div className="h-[6px] w-full bg-surface-2">
              <div className="h-full" style={{ width: p.score + '%', background: band(p.score) }} />
            </div>
            <span className="font-mono text-[10px] leading-relaxed text-muted">{p.note}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
