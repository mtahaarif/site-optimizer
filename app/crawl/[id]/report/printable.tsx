'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import type { AuditReport } from '@/src/crawler/audit.ts';
import type { CheckOutcome } from '@/src/core/checks/types.ts';
import type { AeoReport } from '@/src/core/aeo/analyze.ts';
import {
  ScoreDial, SeverityChip, Stat,
  SEVERITY_ORDER, SEVERITY_LABEL, fmtDuration, shortUrl, scoreBand,
} from '../../../ui.tsx';
import { Overview } from '../summary.tsx';
import { Section, MeterBar, ActionRow } from '../../../panel.tsx';
import { useTheme, type Theme } from '../../../theme.ts';

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

export function PrintableReport({
  report, aeo, suggestedLlmsTxt, autoPrint,
}: {
  report: AuditReport;
  aeo: AeoReport;
  suggestedLlmsTxt: string;
  autoPrint: boolean;
}) {
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
        <div className="flex flex-wrap items-center gap-3">
          <ExportTheme />
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

      {/* ---- AI visibility ----------------------------------------------- */}
      <AiVisibility report={report} aeo={aeo} suggestedLlmsTxt={suggestedLlmsTxt} />

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
 * Answer-engine visibility, as the AI-visibility page shows it.
 *
 * The same `analyzeAeo` output and the same cards — readiness pillars, the
 * ordered fixes, crawler access, JavaScript risk — so the printed section and
 * the screen cannot disagree. What is left out is what a crawl does not own:
 * the location coverage and the content-grading workbench belong to a project,
 * not to one audit, and putting them here would date the moment the next crawl
 * ran.
 */
function AiVisibility({
  report, aeo, suggestedLlmsTxt,
}: {
  report: AuditReport;
  aeo: AeoReport;
  suggestedLlmsTxt: string;
}) {
  const host = report.origin.replace(/^https?:\/\//, '');
  const allowed = aeo.crawlers.filter((c) => c.allowed).length;

  return (
    <section className="print-page-break flex flex-col gap-6">
      <div>
        <h2 className="mb-1 border-b border-line pb-2 text-[18px] font-bold tracking-tight">
          AI visibility
        </h2>
        <p className="max-w-[85ch] text-[12.5px] leading-relaxed text-muted">
          Whether ChatGPT, Claude, Perplexity and Google&rsquo;s AI answers can reach, read and quote{' '}
          {host}. Most answer engines never run JavaScript, so a page that builds itself in the
          browser is invisible to them however good it looks to a visitor. Access and llms.txt were
          read from the live site when this report was generated; page readability comes from the
          audit itself.
        </p>
      </div>

      {/* ---- readiness ---- */}
      <div className="print-block flex flex-col gap-8 border border-line bg-surface p-6 lg:flex-row lg:items-center">
        <div className="flex items-center gap-5">
          <ScoreDial score={aeo.score} />
        </div>
        <div className="flex-1">
          <h3 className="text-[15px] font-medium text-ink">AI readiness · {host}</h3>
          <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {aeo.pillars.map((p) => (
              <MeterBar key={p.key} label={p.label} got={p.got} max={p.max}
                measured={p.measured} detail={p.detail} />
            ))}
          </div>
        </div>
      </div>

      {/* ---- what to fix first ---- */}
      {aeo.actions.length > 0 && (
        <section className="print-block border border-line bg-surface">
          <div className="border-b border-line px-6 py-4">
            <h3 className="text-[15px] font-medium text-ink">What to fix first</h3>
            <p className="mt-0.5 text-[12.5px] text-muted">
              Ordered by how much each one blocks you from being cited.
            </p>
          </div>
          <ol className="divide-y divide-line">
            {aeo.actions.map((a, i) => (
              <ActionRow key={a.title} i={i} severity={a.severity} title={a.title} detail={a.detail} />
            ))}
          </ol>
        </section>
      )}

      {/* ---- 01 reach ---- */}
      <Section n={1} title="Can AI engines reach you?"
        question="Whether the robots file lets each answer engine in."
        status={aeo.blockedCritical.length
          ? `${aeo.blockedCritical.length} blocked`
          : `${allowed} of ${aeo.crawlers.length} allowed`}
        tone={aeo.blockedCritical.length ? 'bad' : 'good'}>
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">Answer engines and whether robots.txt allows each one</caption>
          <thead className="border-b border-line bg-surface-2">
            <tr>
              <th className="px-6 py-2 text-left text-[10.5px] font-medium text-muted">Answer engine</th>
              <th className="px-4 py-2 text-left text-[10.5px] font-medium text-muted">What it controls</th>
              <th className="px-6 py-2 text-right text-[10.5px] font-medium text-muted">Access</th>
            </tr>
          </thead>
          <tbody>
            {aeo.crawlers.map((c) => (
              <tr key={c.agent.token} className="border-b border-line/60 last:border-0">
                <td className="px-6 py-2">
                  <span className="text-ink">{c.agent.label}</span>
                  {c.agent.critical && (
                    <span className="ml-2 text-[9.5px] uppercase tracking-[0.08em] text-muted">major</span>
                  )}
                  <div className="font-mono text-[10px] text-muted">{c.agent.token}</div>
                </td>
                <td className="px-4 py-2 text-[11.5px] text-muted">{c.agent.powers}</td>
                <td className={'px-6 py-2 text-right font-medium '
                  + (c.allowed ? 'text-opportunity' : 'text-blocker')}>
                  {c.allowed ? 'Allowed' : 'Blocked'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* ---- 02 read ---- */}
      <Section n={2} title="Can they read your pages?"
        question="Most answer engines never run JavaScript — this is what they actually receive."
        status={aeo.jsRisk.length ? `${aeo.jsRisk.length} of ${aeo.htmlPages} at risk` : 'All pages readable'}
        tone={aeo.jsRisk.length ? 'bad' : 'good'}>
        {aeo.jsRisk.length === 0 ? (
          <p className="px-6 py-5 text-[13px] text-opportunity">
            Every page delivers its words in the first response. Answer engines see what visitors see.
          </p>
        ) : (
          <table className="w-full border-collapse text-[12px]">
            <caption className="sr-only">Pages compared by words an AI sees versus words a visitor sees</caption>
            <thead className="border-b border-line bg-surface-2">
              <tr>
                <th className="px-6 py-2 text-left text-[10.5px] font-medium text-muted">Page</th>
                <th className="px-4 py-2 text-right text-[10.5px] font-medium text-muted">Words an AI sees</th>
                <th className="px-4 py-2 text-right text-[10.5px] font-medium text-muted">Words a visitor sees</th>
                <th className="px-6 py-2 text-right text-[10.5px] font-medium text-muted">Visible</th>
              </tr>
            </thead>
            <tbody>
              {aeo.jsRisk.slice(0, 25).map((p) => (
                <tr key={p.url} className="border-b border-line/60 last:border-0">
                  <td className="break-all px-6 py-2 text-ink">{shortUrl(p.url, 48)}</td>
                  <td className="tnum px-4 py-2 text-right text-muted">
                    {Math.round(p.serverTextLength / 5.5)}
                  </td>
                  <td className="tnum px-4 py-2 text-right text-muted">{p.wordCount}</td>
                  <td className={'tnum px-6 py-2 text-right font-medium '
                    + (p.serverShare < 0.25 ? 'text-blocker' : 'text-warning')}>
                    {Math.round(p.serverShare * 100)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* ---- 03 understand ---- */}
      <Section n={3} title="Do they understand your site?"
        question="A short file at your root telling answer engines what you do and which pages matter."
        status={aeo.llmsTxt.found ? 'llms.txt found' : 'No llms.txt'}
        tone={aeo.llmsTxt.found ? 'good' : 'neutral'}>
        <div className="px-6 py-5">
          <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted">
            {aeo.llmsTxt.found
              ? <>This site publishes one ({aeo.llmsTxt.bytes.toLocaleString()} characters). The
                  version below is rebuilt from the most important pages in this crawl, for comparison.</>
              : <>No llms.txt was found. The version below is generated from the most important pages
                  in this crawl — publish it at the site root to give a model a map instead of leaving
                  it to infer one.</>}
          </p>
          <pre className="mt-3 max-h-none overflow-hidden whitespace-pre-wrap break-words border border-line bg-surface-2 p-3 font-mono text-[10px] leading-relaxed text-ink">
            {suggestedLlmsTxt}
          </pre>

          {aeo.answer.issues.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <h4 className="text-[13px] font-medium text-ink">
                {aeo.answer.issues.length} {aeo.answer.issues.length === 1 ? 'page is' : 'pages are'} missing the basics
              </h4>
              <p className="mt-1 max-w-[80ch] text-[12px] text-muted">
                A model needs a clear title, a summary, a main heading and enough substance before it
                can lift an answer. {aeo.answer.ready} of {aeo.answer.total} pages have all four.
              </p>
              <ul className="mt-2 flex flex-col gap-1">
                {aeo.answer.issues.slice(0, 20).map((i) => (
                  <li key={i.url}
                    className="flex flex-wrap items-baseline justify-between gap-2 border-l-2 border-line pl-3">
                    <span className="break-all text-[12px] text-ink">{shortUrl(i.url, 48)}</span>
                    <span className="text-[11.5px] text-muted">{i.reasons.join(' · ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Section>

      {/* ---- content quality ---- */}
      <Section title="Is your content worth quoting?"
        question="Reaching an answer engine is only half of it — the writing still has to earn the citation."
        status={aeo.content.average !== null ? `Average ${aeo.content.average}/100` : 'Not graded yet'}
        tone={aeo.content.average === null ? 'neutral' : aeo.content.average >= 70 ? 'good' : 'bad'}>
        <div className="px-6 py-5">
          <p className="max-w-[80ch] text-[12.5px] leading-relaxed text-muted">
            {aeo.content.average !== null
              ? <>{aeo.content.graded} {aeo.content.graded === 1 ? 'page has' : 'pages have'} been
                  graded, averaging {aeo.content.average}/100. This feeds the readiness score above.</>
              : <>Nothing has been graded for this site yet. Content quality is the biggest single
                  factor in whether an answer engine quotes you, and it is the one thing a crawler
                  cannot work out from the markup.</>}
          </p>
          {aeo.content.weakest && (
            <p className="mt-2 text-[12px] text-muted">
              Weakest page ({aeo.content.weakest.overall}/100):{' '}
              <span className="break-all text-ink">{shortUrl(aeo.content.weakest.url, 56)}</span>
            </p>
          )}
        </div>
      </Section>
    </section>
  );
}

/**
 * Light or dark, for the export as well as the screen.
 *
 * The floating toggle switches the site and this switches the same thing — both
 * go through app/theme.ts, so they stay in agreement and the choice persists.
 * It is repeated here because this is the page where the decision has a
 * consequence you cannot undo afterwards: whichever mode is showing is the mode
 * the saved PDF is fixed in.
 */
function ExportTheme() {
  const { theme, mounted, setTheme } = useTheme();
  const options: Array<{ value: Theme; label: string }> = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">PDF theme</span>
      <div className="flex" role="group" aria-label="Colour mode for the exported report">
        {options.map((o) => {
          // Before mount the theme is unknown — it lives in localStorage — so
          // neither option is marked active rather than guessing and flashing.
          const active = mounted && theme === o.value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => setTheme(o.value)}
              aria-pressed={active}
              className={
                'border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors '
                + (active
                  ? 'border-ink bg-ink text-ground'
                  : 'border-line text-muted hover:border-ink hover:text-ink')
              }
            >
              {o.label}
            </button>
          );
        })}
      </div>
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
