'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { AuditReport } from '@/src/crawler/audit.ts';
import type { CheckOutcome } from '@/src/core/checks/types.ts';
import type { Severity } from '@/src/core/scoring/model.ts';
import {
  ScoreDial, SeverityChip, StatusChip, Stat, Bar,
  SEVERITY_ORDER, SEVERITY_LABEL, fmtBytes, fmtDuration, shortUrl, scoreBand,
} from '../../ui.tsx';
import { CoreWebVitalsCard } from './cwv.tsx';
import { CodeViewer } from './code-viewer.tsx';
import { TrafficCard, CheckTrafficImpact } from './traffic.tsx';
import { hasLocator } from '@/src/core/checks/locate.ts';
import { SCORE_COLOR } from '@/src/core/pagespeed/types.ts';
import { PageExplorer } from './explorer.tsx';
import { SiteGraph } from './graph.tsx';
import { PillarCard } from './pillars.tsx';

type Tab = 'overview' | 'issues' | 'explorer' | 'graph';
type Filter = 'all' | Severity | 'passed' | 'skipped';

/**
 * `embedded` renders only the tabs and their content — used by the project page,
 * which already shows the site header and score above it.
 */
export function Summary({ report, embedded = false }: { report: AuditReport; embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>('overview');

  const sevColor: Record<Severity, string> = {
    blocker: 'rgb(var(--blocker))',
    critical: 'rgb(var(--critical))',
    warning: 'rgb(var(--warning))',
    opportunity: 'rgb(var(--opportunity))',
    notice: 'rgb(var(--notice))',
  };

  return (
    <div className="flex flex-col gap-8">
      {!embedded && (<>
      {/* ---- header ---- */}
      <div>
        <Link href="/projects" className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink">
          ← Projects
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-[28px] font-bold tracking-tight">
            {report.origin.replace(/^https?:\/\//, '')} · audit {new Date(report.createdAt).toLocaleString()}
          </h1>
          {report.isNext && (
            <span className="rounded border border-accent px-2 py-px font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-accent">
              Next.js · {report.nextSummary?.router}
            </span>
          )}
          {report.render?.enabled && (
            <span
              className="rounded border border-line px-2 py-px font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted"
              title="Pages were rendered in headless Chromium before extraction"
            >
              JS rendered
            </span>
          )}
        </div>
        <p className="mt-1 font-mono text-[11.5px] text-muted">
          {new Date(report.createdAt).toLocaleString()} · {fmtDuration(report.durationMs)} ·
          rubric v{report.rubricVersion}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/crawl/${report.id}/compare`} className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:border-ink hover:text-ink">
            Compare crawls
          </Link>
          <Link href={`/crawl/${report.id}/manage`} className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:border-ink hover:text-ink">
            Robots &amp; sitemap
          </Link>
        </div>
      </div>

      {/* ---- score + stats ---- */}
      <div className="flex flex-col gap-5 rounded border border-line bg-surface p-6 lg:flex-row lg:items-center">
        <ScoreDial score={report.score} />
        <div className="flex-1">
          <h2 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
            Technical health
          </h2>
          <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-muted">
            How well-built and search-ready this site is — weighted so your most important pages
            count for more. Must-fix problems move it the most; cosmetic ones barely nudge it. It
            measures build quality, not where you rank (that also needs strong content and links).
            Averaged flat, the score is <span className="tnum font-bold text-ink">{report.meanPageScore}</span>.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {SEVERITY_ORDER.map((s) => (
              <div key={s} className="rounded border border-line px-3 py-2">
                <div className="tnum text-[20px] font-bold leading-none" style={{ color: sevColor[s] }}>
                  {report.severity[s]}
                </div>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                  {SEVERITY_LABEL[s]}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Crawled" value={report.counts.crawled} />
        <Stat label="HTML pages" value={report.counts.htmlPages} />
        <Stat label="Indexable" value={report.counts.indexable} />
        <Stat label="Orphans" value={report.counts.orphans} />
        <Stat label="Checks failed" value={report.counts.checksFailed} tone="rgb(var(--blocker))" />
        <Stat label="Checks passed" value={report.counts.checksPassed} tone="rgb(var(--accent))" />
      </div>
      </>)}

      {/* ---- tabs ---- */}
      <div className="flex gap-1 border-b border-line">
        {(['overview', 'issues', 'explorer', 'graph'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              'border-b-2 px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.12em] transition-colors ' +
              (tab === t ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink')
            }
          >
            {t === 'issues' ? `All checks (${report.counts.checksTotal})` : t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <Overview report={report} />}
      {tab === 'issues' && <AllChecks report={report} />}
      {tab === 'explorer' && <PageExplorer report={report} />}
      {tab === 'graph' && <SiteGraph report={report} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Overview({ report }: { report: AuditReport }) {
  return (
    <div className="flex flex-col gap-8">
      <PillarCard report={report} />

      <TrafficCard report={report} />

      <CoreWebVitalsCard report={report} />

      {report.render && (report.render.enabled || report.render.spaShellsDetected > 0) && (
        <section>
          <h3 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
            JavaScript rendering
          </h3>

          {report.render.enabled ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Pages rendered" value={report.render.renderedPages} />
                <Stat label="Render failures" value={report.render.failures.length}
                  tone={report.render.failures.length ? 'rgb(var(--warning))' : undefined} />
                <Stat label="JS console errors" value={report.render.consoleErrors}
                  tone={report.render.consoleErrors ? 'rgb(var(--warning))' : undefined} />
                <Stat label="Client-rendered shells" value={report.render.spaShellsDetected} />
              </div>
              <p className="mt-3 max-w-[76ch] text-[12.5px] leading-relaxed text-muted">
                Every check evaluated against the hydrated DOM. Response headers, status codes and
                redirect chains still come from the raw fetch, because a browser cannot see the
                pre-redirect chain.
              </p>
              {report.render.failures.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5">
                  {report.render.failures.slice(0, 5).map((f, i) => (
                    <li key={i} className="font-mono text-[11px] text-warning">
                      {shortUrl(f.url, 56)} — {f.error} (fell back to raw HTML)
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className="rounded border border-warning bg-surface p-4">
              <p className="text-[13px] text-ink">
                {report.render.spaShellsDetected} page(s) returned a client-rendered shell.
              </p>
              <p className="mt-2 max-w-[76ch] text-[12.5px] leading-relaxed text-muted">
                The server response is an empty framework mount point, so this report describes a
                shell rather than the page a user sees — and links that exist only after hydration
                were never discovered. Re-run with JavaScript rendering enabled to audit the real
                DOM.
              </p>
              <pre className="mt-2 overflow-x-auto rounded bg-ground p-3 font-mono text-[11.5px] text-ink">
node scripts/cli.ts {report.origin} 50 --render-js</pre>
            </div>
          )}
        </section>
      )}

      {report.nextSummary && (
        <section>
          <h3 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
            Next.js rendering — what no generic crawler reports
          </h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {Object.entries(report.nextSummary.strategies)
              .sort((a, b) => b[1] - a[1])
              .map(([strategy, n]) => (
                <div key={strategy} className="rounded border border-line bg-surface px-3 py-2">
                  <div className="tnum text-[20px] font-bold leading-none">{n}</div>
                  <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">
                    {strategy}
                  </div>
                </div>
              ))}
          </div>
          {report.nextSummary.buildIds.length > 0 && (
            <p className="mt-2 font-mono text-[11px] text-muted">
              build {report.nextSummary.buildIds.join(', ')}
            </p>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          Affected pages by category
        </h3>
        <div className="flex flex-col gap-2.5">
          {report.categories
            .slice()
            .sort((a, b) => b.affectedPageShare - a.affectedPageShare)
            .map((cat) => (
              <div key={cat.category} className="flex items-center gap-4">
                <span className="w-40 shrink-0 font-mono text-[11.5px] text-ink">{cat.label}</span>
                <div className="flex-1">
                  <Bar
                    value={cat.affectedPageShare * 100}
                    max={100}
                    color={cat.affectedPageShare > 0.5 ? 'rgb(var(--blocker))'
                      : cat.affectedPageShare > 0.2 ? 'rgb(var(--warning))' : 'rgb(var(--accent))'}
                  />
                </div>
                <span className="tnum w-12 shrink-0 text-right font-mono text-[11.5px] text-muted">
                  {Math.round(cat.affectedPageShare * 100)}%
                </span>
                <span className="tnum w-24 shrink-0 text-right font-mono text-[11px] text-muted">
                  {cat.failed.length} / {cat.failed.length + cat.passed.length}
                </span>
              </div>
            ))}
        </div>
      </section>

      <section>
        <h3 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          Crawl inputs
        </h3>
        <dl className="grid gap-x-8 gap-y-1.5 font-mono text-[12px] sm:grid-cols-2">
          <Row k="robots.txt" v={report.robots.found ? 'found' : 'not found'} />
          <Row k="Sitemaps" v={report.sitemaps.length === 0 ? 'none discovered'
            : report.sitemaps.map((s) => s.entryCount).reduce((a, b) => a + b, 0) + ' URLs in ' + report.sitemaps.length + ' file(s)'} />
          <Row k="Max pages" v={String(report.options.maxPages)} />
          <Row k="Max depth" v={String(report.options.maxDepth)} />
          <Row k="Resources fetched" v={report.counts.assets + ' assets'} />
          <Row k="Blocked by robots" v={String(report.counts.blocked)} />
        </dl>
      </section>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-4 border-b border-line/60 py-1">
    <dt className="text-muted">{k}</dt>
    <dd className="text-right text-ink">{v}</dd>
  </div>
);

// ---------------------------------------------------------------------------

function AllChecks({ report }: { report: AuditReport }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [showPassed, setShowPassed] = useState(false);

  const filters: Array<{ key: Filter; label: string; count: number }> = useMemo(() => [
    { key: 'all', label: 'All', count: report.counts.checksTotal },
    ...SEVERITY_ORDER.map((s) => ({
      key: s as Filter,
      label: SEVERITY_LABEL[s],
      count: report.severity[s],
    })),
    { key: 'passed', label: 'Passed', count: report.counts.checksPassed },
    { key: 'skipped', label: 'Skipped', count: report.counts.checksSkipped },
  ], [report]);

  const matches = (o: CheckOutcome): boolean => {
    if (query && !(o.title + ' ' + o.id).toLowerCase().includes(query.toLowerCase())) return false;
    if (filter === 'all') return true;
    if (filter === 'passed') return o.status === 'passed';
    if (filter === 'skipped') return o.status === 'skipped';
    return o.status === 'failed' && o.severity === filter;
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              'rounded border px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.08em] transition-colors ' +
              (filter === f.key
                ? 'border-accent bg-accent text-ground'
                : 'border-line text-muted hover:text-ink')
            }
          >
            {f.label} <span className="tnum opacity-70">{f.count}</span>
          </button>
        ))}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search checks…"
          className="ml-auto w-52 rounded border border-line bg-ground px-2 py-1 font-mono text-[12px] outline-none focus:border-accent"
        />
      </div>

      {report.categories.map((cat) => {
        const failed = cat.failed.filter(matches);
        const passed = cat.passed.filter(matches);
        const skipped = cat.skipped.filter(matches);
        if (failed.length + passed.length + skipped.length === 0) return null;

        return (
          <section key={cat.category}>
            <div className="border-b border-line pb-2">
              <h3 className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-[15px] font-bold tracking-tight">{cat.label}</span>
                <span className="font-mono text-[11px] text-muted">
                  {cat.failed.length} issue{cat.failed.length === 1 ? '' : 's'} ·
                  {' '}{cat.passed.length} passed
                  {cat.skipped.length > 0 && ` · ${cat.skipped.length} skipped`}
                </span>
              </h3>
              <p className="mt-1 max-w-[85ch] text-[12.5px] leading-relaxed text-muted">
                {cat.description}
              </p>
            </div>

            <ul className="flex flex-col">
              {failed.map((o) => (
                <CheckRow
                  key={o.id}
                  outcome={o}
                  report={report}
                  crawlId={report.id}
                  open={open === o.id}
                  onToggle={() => setOpen(open === o.id ? null : o.id)}
                />
              ))}
            </ul>

            {(passed.length > 0 || skipped.length > 0) && (
              <div className="mt-2">
                <button
                  onClick={() => setShowPassed((v) => !v)}
                  className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-accent hover:underline"
                >
                  {showPassed ? '− Hide' : '+ Show'} {passed.length} passed
                  {skipped.length > 0 && ` and ${skipped.length} skipped`}
                </button>
                {showPassed && (
                  <ul className="mt-1 flex flex-col">
                    {[...passed, ...skipped].map((o) => (
                      <li key={o.id} className="flex items-baseline gap-3 border-b border-line/40 py-1.5">
                        <StatusChip status={o.status as 'passed' | 'skipped'} />
                        <span className="text-[13px] text-muted">{o.title}</span>
                        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                          {o.status === 'skipped' ? (o.skipReason ?? 'skipped') : '0 pages'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CheckRow({ outcome, report, crawlId, open, onToggle }: {
  outcome: CheckOutcome; report: AuditReport; crawlId: string; open: boolean; onToggle: () => void;
}) {
  const [codeUrl, setCodeUrl] = useState<string | null>(null);
  // Site-level findings and metrics have no source position; offering the
  // button there would only ever open an empty panel.
  const locatable = outcome.scope === 'page' && hasLocator(outcome.id);

  return (
    <li className="border-b border-line/60">
      <button
        onClick={onToggle}
        className="flex w-full items-baseline gap-3 py-2 text-left hover:bg-surface"
      >
        <SeverityChip severity={outcome.severity} />
        <span className="text-[13.5px] font-medium text-ink">{outcome.title}</span>
        <span className="ml-auto shrink-0 tnum font-mono text-[12px] text-muted">
          {outcome.scope === 'site'
            ? 'site-level'
            : outcome.affectedCount + ' page' + (outcome.affectedCount === 1 ? '' : 's')}
        </span>
        <span className="w-3 shrink-0 font-mono text-[11px] text-muted">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="mb-3 ml-1 border-l-2 border-line pl-4">
          <p className="max-w-[80ch] text-[13px] leading-relaxed text-muted">{outcome.why}</p>
          <p className="mt-2 max-w-[80ch] text-[13px] leading-relaxed">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-accent">Fix — </span>
            <span className="text-ink">{outcome.fix}</span>
          </p>
          <p className="mt-2 font-mono text-[10.5px] text-muted">
            {outcome.id} · evaluated against {outcome.applicableCount} page(s)
          </p>

          <CheckTrafficImpact report={report} urls={outcome.affected.map((a) => a.url)} />

          {outcome.affected.length > 0 && outcome.scope === 'page' && (
            <div className="scroll-x mt-3 max-h-72 overflow-y-auto rounded border border-line">
              <table className="w-full min-w-[520px] border-collapse font-mono text-[11.5px]">
                <caption className="sr-only">Pages affected by this check</caption>
                <tbody>
                  {outcome.affected.map((a, i) => (
                    <tr key={a.url + i} className="border-b border-line/50 last:border-0">
                      <td className="px-3 py-1.5 text-ink">
                        <a href={a.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                          {shortUrl(a.url, 52)}
                        </a>
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted">{a.detail}</td>
                      {locatable && (
                        <td className="px-2 py-1.5 text-right">
                          <button
                            onClick={() => setCodeUrl(codeUrl === a.url ? null : a.url)}
                            className="whitespace-nowrap rounded border border-line px-1.5 py-px text-[10px] uppercase tracking-[0.08em] text-muted hover:border-accent hover:text-accent"
                          >
                            {codeUrl === a.url ? 'Hide' : 'View in code'}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {outcome.affectedCount > outcome.affected.length && (
                <p className="px-3 py-1.5 font-mono text-[11px] text-muted">
                  + {outcome.affectedCount - outcome.affected.length} more not shown
                </p>
              )}
            </div>
          )}

          {codeUrl && (
            <CodeViewer
              crawlId={crawlId}
              url={codeUrl}
              checkId={outcome.id}
              onClose={() => setCodeUrl(null)}
            />
          )}
        </div>
      )}
    </li>
  );
}
