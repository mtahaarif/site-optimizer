'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuditReport } from '@/src/crawler/audit.ts';
import type { CrawlProgress } from '@/src/crawler/crawl.ts';
import { Summary } from './summary.tsx';

interface Props {
  id: string;
  initialReport: AuditReport | null;
  initialStatus: string;
}

const PHASES: Array<CrawlProgress['phase']> = [
  'robots', 'sitemaps', 'crawling', 'assets', 'analysing', 'pagespeed', 'checking', 'done',
];

const PHASE_LABEL: Record<string, string> = {
  robots: 'robots.txt',
  sitemaps: 'Sitemaps',
  crawling: 'Crawling',
  assets: 'Resources',
  analysing: 'Analysis',
  pagespeed: 'Core Web Vitals',
  checking: 'Checks',
  done: 'Done',
  error: 'Error',
};

export function CrawlView({ id, initialReport, initialStatus }: Props) {
  const [report, setReport] = useState<AuditReport | null>(initialReport);
  const [status, setStatus] = useState(initialStatus);
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (report) return;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/crawl/${id}`, { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 404) setError('Crawl not found. It may still be starting.');
          return;
        }
        const data = await res.json() as {
          status: string; progress: CrawlProgress | null;
          error: string | null; report: AuditReport | null;
        };
        if (cancelled) return;
        setStatus(data.status);
        if (data.progress) setProgress(data.progress);
        if (data.error) setError(data.error);
        if (data.report) setReport(data.report);
      } catch { /* transient; the next tick retries */ }
    };

    void poll();
    const timer = setInterval(() => {
      if (cancelled) return;
      void poll();
    }, 900);
    return () => { cancelled = true; clearInterval(timer); };
  }, [id, report]);

  if (report) return <Summary report={report} />;

  const currentPhase = progress?.phase ?? 'robots';
  const phaseIndex = PHASES.indexOf(currentPhase);
  const pct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.crawled / progress.total) * 100))
    : 0;

  return (
    <div className="mx-auto max-w-[640px] py-16">
      <Link href="/projects" className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink">
        ← Projects
      </Link>

      <h1 className="mt-6 text-[26px] font-bold tracking-tight">
        {status === 'error' ? 'Crawl failed' : 'Crawling…'}
      </h1>

      {error ? (
        <p className="mt-4 rounded border border-blocker px-4 py-3 font-mono text-[13px] text-blocker">
          {error}
        </p>
      ) : (
        <>
          <p className="mt-2 font-mono text-[13px] text-muted">
            {progress?.message ?? 'Starting…'}
          </p>

          <div className="mt-6 h-1.5 w-full overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: (currentPhase === 'crawling' ? pct : phaseIndex * 16) + '%' }}
            />
          </div>

          <ol className="mt-6 flex flex-col gap-1">
            {PHASES.map((phase, i) => {
              const state = i < phaseIndex ? 'done' : i === phaseIndex ? 'active' : 'pending';
              return (
                <li
                  key={phase}
                  className={
                    'flex items-baseline gap-3 rounded px-3 py-1.5 font-mono text-[12px] ' +
                    (state === 'active' ? 'bg-surface text-ink'
                      : state === 'done' ? 'text-accent' : 'text-muted')
                  }
                >
                  <span className="w-4">{state === 'done' ? '✓' : state === 'active' ? '▸' : '·'}</span>
                  <span className="uppercase tracking-[0.1em]">{PHASE_LABEL[phase]}</span>
                  {phase === 'crawling' && progress && currentPhase === 'crawling' && (
                    <span className="tnum ml-auto text-muted">
                      {progress.crawled} / {progress.total}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>

          <p className="mt-6 text-[12.5px] leading-relaxed text-muted">
            Large crawls take a while — the crawler is polite by default and fetches every page
            resource to size it. You can leave this tab; the report is saved locally when it
            finishes.
          </p>
        </>
      )}
    </div>
  );
}
