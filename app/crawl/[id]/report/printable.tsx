'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { AuditReport } from '@/src/crawler/audit.ts';
import type { CheckOutcome } from '@/src/core/checks/types.ts';
import {
  ScoreDial, SeverityChip, Stat,
  SEVERITY_ORDER, SEVERITY_LABEL, fmtDuration, shortUrl, scoreBand,
} from '../../../ui.tsx';
import { Overview } from '../summary.tsx';

/**
 * The audit as one continuous document, for print and PDF export.
 *
 * Everything here is the same component tree the report page renders — the
 * score dial, the pillar bars, Core Web Vitals, the category bars — so the PDF
 * cannot drift from the screen. What changes is the shape: the tabbed,
 * filterable, expand-on-click interface is flattened into a single flow,
 * because a reader of a PDF cannot click a tab open and a check whose detail is
 * collapsed is a check the PDF does not contain.
 *
 * Two sections are therefore rewritten rather than reused: the check list
 * (interactive filters, collapsed rows, a code viewer that fetches on demand)
 * and the page explorer (sortable, searchable, 1000px wide). Both become static
 * tables sized for a printed page.
 */

const SEV_COLOR: Record<string, string> = {
  blocker: 'rgb(var(--blocker))',
  critical: 'rgb(var(--critical))',
  warning: 'rgb(var(--warning))',
  opportunity: 'rgb(var(--opportunity))',
  notice: 'rgb(var(--notice))',
};

/** How many affected pages to list per check before summarising the rest. */
const MAX_AFFECTED_ROWS = 15;
/** How many pages to include in the page table. */
const MAX_PAGE_ROWS = 60;

export function PrintableReport({ report, autoPrint }: { report: AuditReport; autoPrint: boolean }) {
  const host = report.origin.replace(/^https?:\/\//, '');
  const band = scoreBand(report.score);
  const created = new Date(report.createdAt);

  // Opened from the "PDF" button with ?print=1: go straight to the print
  // dialog. `afterprint` is not used to navigate back — the reader may want to
  // print again, or save at a different paper size, without a round trip.
  useEffect(() => {
    if (!autoPrint) return;
    // One frame, so layout and fonts settle before the dialog snapshots the page.
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [autoPrint]);

  // `categories` carries check ids; the outcomes live once, on report.outcomes.
  // Older stored reports embedded whole objects, so accept either shape — the
  // same accommodation the on-screen check list makes.
  const index = new Map(report.outcomes.map((o) => [o.id, o]));
  const resolve = (list: Array<string | CheckOutcome>): CheckOutcome[] =>
    list
      .map((v) => (typeof v === 'string' ? index.get(v) : v))
      .filter((o): o is CheckOutcome => !!o);

  const pages = [...report.pages]
    .filter((p) => p.isHtml)
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_PAGE_ROWS);

  return (
    <div className="print-doc mx-auto flex max-w-[980px] flex-col gap-8">
      {/* ---- toolbar: screen only ---------------------------------------- */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <Link
          href={`/crawl/${report.id}`}
          className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink"
        >
          ← Back to the interactive report
        </Link>
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-muted">
            Choose &ldquo;Save as PDF&rdquo; as the destination
          </span>
          <button
            type="button"
            onClick={() => window.print()}
            className="border border-ink bg-ink px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ground transition-opacity hover:opacity-90"
          >
            Save as PDF
          </button>
        </div>
      </div>

      {/* ---- cover ------------------------------------------------------- */}
      <header className="print-block">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
          Technical SEO audit · SiteChecker
        </p>
        <h1 className="mt-2 text-[30px] font-bold leading-tight tracking-tight">
          Audit of {host}
        </h1>
        <p className="mt-1 font-mono text-[11.5px] text-muted">
          {created.toLocaleString()} · {fmtDuration(report.durationMs)} · rubric v{report.rubricVersion}
          {' · '}report {report.id.slice(0, 8)}
        </p>
      </header>

      {/* ---- score + severity -------------------------------------------- */}
      <section className="print-block flex flex-col gap-5 rounded border border-line bg-surface p-6 lg:flex-row lg:items-center">
        <ScoreDial score={report.score} />
        <div className="flex-1">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            Technical health · <span className={band.text}>{band.label}</span>
          </h2>
          <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-muted">
            How well-built and search-ready this site is — weighted so the most important pages count
            for more. Must-fix problems move it the most; cosmetic ones barely nudge it. It measures
            build quality, not where the site ranks. Averaged flat, the score is{' '}
            <span className="tnum font-bold text-ink">{report.meanPageScore}</span>.
          </p>
          <div className="mt-4 grid grid-cols-5 gap-2">
            {SEVERITY_ORDER.map((s) => (
              <div key={s} className="rounded border border-line px-3 py-2">
                <div className="tnum text-[20px] font-bold leading-none" style={{ color: SEV_COLOR[s] }}>
                  {report.severity[s]}
                </div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  {SEVERITY_LABEL[s]}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="print-block grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Crawled" value={report.counts.crawled} />
        <Stat label="HTML pages" value={report.counts.htmlPages} />
        <Stat label="Indexable" value={report.counts.indexable} />
        <Stat label="Orphans" value={report.counts.orphans} />
        <Stat label="Checks failed" value={report.counts.checksFailed} tone="rgb(var(--blocker))" />
        <Stat label="Checks passed" value={report.counts.checksPassed} tone="rgb(var(--accent))" />
      </section>

      {/* ---- the overview cards, exactly as the screen renders them ------- */}
      <Overview report={report} />

      {/* ---- every finding, expanded ------------------------------------- */}
      <section className="print-page-break">
        <h2 className="mb-1 border-b border-line pb-2 text-[18px] font-bold tracking-tight">
          Findings in full
        </h2>
        <p className="mb-5 max-w-[85ch] text-[12.5px] leading-relaxed text-muted">
          Every failing check, by category, with why it matters and how to fix it. Passing and
          skipped checks are counted per category but not listed individually — {report.counts.checksPassed} passed
          and {report.counts.checksSkipped} did not apply to this site.
        </p>

        <div className="flex flex-col gap-7">
          {report.categories.map((cat) => {
            const failed = resolve(cat.failed);
            if (failed.length === 0) return null;
            return (
              <section key={cat.category} className="print-block">
                <div className="border-b border-line pb-2">
                  <h3 className="flex flex-wrap items-baseline gap-x-3">
                    <span className="text-[15px] font-bold tracking-tight">{cat.label}</span>
                    <span className="font-mono text-[11px] text-muted">
                      {cat.failed.length} issue{cat.failed.length === 1 ? '' : 's'} ·{' '}
                      {cat.passed.length} passed
                      {cat.skipped.length > 0 && ` · ${cat.skipped.length} skipped`}
                    </span>
                  </h3>
                  <p className="mt-1 max-w-[85ch] text-[12.5px] leading-relaxed text-muted">
                    {cat.description}
                  </p>
                </div>
                <ul className="flex flex-col">
                  {failed.map((o) => (
                    <PrintedCheck key={o.id} outcome={o} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </section>

      {/* ---- pages ------------------------------------------------------- */}
      <section className="print-page-break">
        <h2 className="mb-1 border-b border-line pb-2 text-[18px] font-bold tracking-tight">
          Pages, weakest first
        </h2>
        <p className="mb-4 max-w-[85ch] text-[12.5px] leading-relaxed text-muted">
          {report.counts.htmlPages} HTML page{report.counts.htmlPages === 1 ? '' : 's'} were crawled
          {pages.length < report.counts.htmlPages && `; the ${pages.length} lowest-scoring are listed`}.
          Importance is internal PageRank across the crawled link graph — a defect on a page near the
          top of this list costs more than the same defect further down.
        </p>
        <table className="w-full border-collapse font-mono text-[11px]">
          <caption className="sr-only">Crawled pages ordered by score, lowest first</caption>
          <thead>
            <tr className="border-b border-line text-left text-[9.5px] uppercase tracking-[0.1em] text-muted">
              <th className="pb-2 pr-3">Page</th>
              <th className="pb-2 pr-3 text-right">Depth</th>
              <th className="pb-2 pr-3 text-right">Importance</th>
              <th className="pb-2 pr-3 text-right">Linked</th>
              <th className="pb-2 pr-3">Indexable</th>
              <th className="pb-2 pr-3 text-right">Score</th>
              <th className="pb-2 text-right">Issues</th>
            </tr>
          </thead>
          <tbody className="tnum">
            {pages.map((p) => {
              const orphan = (p.inDegree ?? 0) === 0;
              return (
                <tr key={p.url} className="border-b border-line/60">
                  <td className="max-w-[320px] break-all py-1.5 pr-3 text-ink">{shortUrl(p.url, 58)}</td>
                  <td className="py-1.5 pr-3 text-right text-muted">{p.depth}</td>
                  <td className="py-1.5 pr-3 text-right text-muted">{p.pageRank.toFixed(3)}</td>
                  <td className={'py-1.5 pr-3 text-right ' + (orphan ? 'text-blocker' : 'text-muted')}>
                    {orphan ? 'orphan' : (p.inDegree ?? 0)}
                  </td>
                  <td className="py-1.5 pr-3">
                    {p.indexable
                      ? <span className="text-opportunity">yes</span>
                      : <span className="text-blocker">no</span>}
                  </td>
                  <td className={'py-1.5 pr-3 text-right font-bold ' + scoreBand(p.score).text}>
                    {p.score.toFixed(0)}
                  </td>
                  <td className="py-1.5 text-right text-muted">{p.issueCount}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ---- colophon ---------------------------------------------------- */}
      <footer className="print-block border-t border-line pt-4 font-mono text-[10.5px] leading-relaxed text-muted">
        Generated by SiteChecker from the audit of {created.toLocaleString()}. Scores use rubric
        v{report.rubricVersion}, a fixed rubric — two reports of the same site are directly
        comparable. The full interactive report, including the link graph and the source of each
        finding, is at /crawl/{report.id}.
      </footer>
    </div>
  );
}

/**
 * One finding, always expanded.
 *
 * The screen collapses these behind a click because a long report is easier to
 * scan that way. Print has no click, so everything the panel would have shown —
 * why, the fix, the check id, the affected URLs — is laid out inline.
 */
function PrintedCheck({ outcome }: { outcome: CheckOutcome }) {
  const listed = outcome.affected.slice(0, MAX_AFFECTED_ROWS);
  const hidden = outcome.affectedCount - listed.length;

  return (
    <li className="print-block break-inside-avoid border-b border-line/60 py-3">
      <div className="flex items-baseline gap-3">
        <SeverityChip severity={outcome.severity} />
        <span className="text-[13.5px] font-medium text-ink">{outcome.title}</span>
        <span className="tnum ml-auto shrink-0 font-mono text-[12px] text-muted">
          {outcome.scope === 'site'
            ? 'site-level'
            : outcome.affectedCount + ' page' + (outcome.affectedCount === 1 ? '' : 's')}
        </span>
      </div>

      <div className="mt-2 ml-1 border-l-2 border-line pl-4">
        <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted">{outcome.why}</p>
        <p className="mt-1.5 max-w-[80ch] text-[12.5px] leading-relaxed">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-accent">Fix — </span>
          <span className="text-ink">{outcome.fix}</span>
        </p>
        <p className="mt-1.5 font-mono text-[10px] text-muted">
          {outcome.id} · evaluated against {outcome.applicableCount} page(s)
        </p>

        {listed.length > 0 && outcome.scope === 'page' && (
          <table className="mt-2 w-full border-collapse font-mono text-[10.5px]">
            <caption className="sr-only">Pages affected by {outcome.title}</caption>
            <tbody>
              {listed.map((a, i) => (
                <tr key={a.url + i} className="border-b border-line/40 last:border-0">
                  <td className="break-all py-1 pr-3 text-ink">{shortUrl(a.url, 62)}</td>
                  <td className="w-[38%] py-1 text-right align-top text-muted">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hidden > 0 && (
          <p className="mt-1 font-mono text-[10px] text-muted">+ {hidden} more not listed</p>
        )}
      </div>
    </li>
  );
}
