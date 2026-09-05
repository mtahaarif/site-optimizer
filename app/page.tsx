import { connection } from 'next/server';
import Link from 'next/link';
import { listReports, loadReport } from '@/src/crawler/store.ts';
import { listSites } from '@/src/db/index.ts';
import { gscConfigured } from '@/src/core/gsc/auth.ts';
import { ga4Configured } from '@/src/core/ga4/client.ts';
import { jsDependentPages } from '@/src/core/aeo/analyze.ts';
import { keywordsWithRanks } from '@/src/ranks/track.ts';
import { backlinkSummary } from '@/src/backlinks/verify.ts';
import { ScoreDial, scoreBand, shortUrl, SEVERITY_ORDER, SEVERITY_LABEL } from './ui.tsx';
import type { Severity } from '@/src/core/scoring/model.ts';

// Reads live data from SQLite, so there is no static shell to prerender.
export const instant = false;

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components

export const metadata = {
  title: 'Dashboard — your site health at a glance',
  description: 'Your latest audit score, most important pages, search rankings, AI visibility and backlinks — the whole picture on one screen.',
  alternates: { canonical: '/' },
};

const SEVERITY_COLOR: Record<Severity, string> = {
  blocker: 'rgb(var(--blocker))',
  critical: 'rgb(var(--critical))',
  warning: 'rgb(var(--warning))',
  opportunity: 'rgb(var(--opportunity))',
  notice: 'rgb(var(--notice))',
};

function fmtAgo(ts: number): string {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

/** Bento cell chrome — hairline square card with a mono eyebrow and optional link. */
function Widget({
  label, children, className = '', href, cta,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  href?: string;
  cta?: string;
}) {
  return (
    <section className={'flex min-w-0 flex-col border border-line bg-surface p-5 ' + className}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-muted">
          {label}
        </h2>
        {href && cta && (
          <Link href={href} className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:text-ink">
            {cta} →
          </Link>
        )}
      </div>
      <div className="mt-4 flex min-w-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

function BigNum({ value, sub, tone }: { value: string | number; sub: string; tone?: string }) {
  return (
    <div className="flex flex-1 flex-col justify-end">
      <div className="tnum text-[40px] font-normal leading-none tracking-tight" style={tone ? { color: tone } : undefined}>
        {value}
      </div>
      <div className="mt-2 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">{sub}</div>
    </div>
  );
}

export default async function Dashboard() {
  await connection();

  const [reports, sites] = [await listReports(), await listSites()];
  const gscOn = gscConfigured();
  const gaOn = ga4Configured();
  const latest = reports[0] ?? null;
  const report = latest ? await loadReport(latest.id) : null;

  // AI visibility — pages whose content only exists after JavaScript runs are
  // invisible to answer engines, which mostly do not execute it.
  const aiRisk = report ? jsDependentPages(report.pages ?? []).length : null;

  // Ranks.
  const keywords = await keywordsWithRanks();
  const ranked = keywords.filter((k) => k.position !== null);
  const top10 = ranked.filter((k) => (k.position ?? 999) <= 10).length;
  const avgPos = ranked.length
    ? Math.round(ranked.reduce((s, k) => s + (k.position ?? 0), 0) / ranked.length)
    : null;

  // Backlinks — summed over every site.
  const siteSummaries = await Promise.all(sites.map((site) => backlinkSummary(site.id)));
  const bl = siteSummaries.reduce(
    (acc, b) => {
      acc.active += b.active; acc.lost += b.lost; acc.total += b.total;
      acc.referringDomains += b.referringDomains;
      return acc;
    },
    { active: 0, lost: 0, total: 0, referringDomains: 0 },
  );

  // Top pages by PageRank from the latest crawl. Older stored reports may predate
  // some of these fields, so every nested read below is guarded.
  const topPages = Array.isArray(report?.pages)
    ? [...report.pages].filter((p) => p.isHtml).sort((a, b) => b.pageRank - a.pageRank).slice(0, 5)
    : [];
  const maxRank = topPages.length ? topPages[0]!.pageRank : 1;

  const gsc = report?.traffic?.gsc;
  const ga4 = report?.traffic?.ga4;
  const hasTraffic = Boolean(gsc?.connected || ga4?.connected);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line pb-4">
        <h1 className="text-[26px] font-normal tracking-tight">Dashboard</h1>
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
          {latest ? <>Last audit {fmtAgo(new Date(latest.createdAt).getTime())} · {latest.origin.replace(/^https?:\/\//, '')}</> : 'No audits yet'}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* ---- Featured: latest audit score ---- */}
        <Widget
          label="Latest audit"
          className="sm:col-span-2"
          href={latest ? `/crawl/${latest.id}` : '/projects'}
          cta={latest ? 'Report' : 'Run one'}
        >
          {report && latest ? (
            <div className="flex flex-1 items-center gap-6">
              <ScoreDial score={report.score} size={132} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[16px] font-normal text-ink">
                  {latest.origin.replace(/^https?:\/\//, '')}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.1em] text-muted">
                  {report.counts?.crawled ?? latest.crawled} pages · {report.counts?.checksFailed ?? latest.checksFailed} issues · {scoreBand(report.score).label}
                </div>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {SEVERITY_ORDER.map((sev) => (
                    <span key={sev} className="inline-flex items-center gap-1.5 border border-line px-2 py-1">
                      <span className="h-2 w-2" style={{ background: SEVERITY_COLOR[sev] }} />
                      <span className="tnum font-mono text-[11px] text-ink">{report.severity?.[sev] ?? 0}</span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted">
                        {SEVERITY_LABEL[sev]}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-start justify-center gap-3 py-4">
              <p className="text-[14px] text-muted">No audits stored yet.</p>
              <Link href="/projects" className="border border-ink px-4 py-2 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-ink hover:bg-ink hover:text-ground">
                Run your first audit
              </Link>
            </div>
          )}
        </Widget>

        {/* ---- Crawling ---- */}
        <Widget label="Projects" href="/projects" cta="All">
          <BigNum value={reports.length} sub={reports.length === 1 ? 'audit stored' : 'audits stored'} />
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
            {latest ? <>Last: {latest.crawled} pages, {fmtAgo(new Date(latest.createdAt).getTime())}</> : 'Nothing crawled yet'}
          </p>
        </Widget>

        {/* ---- Search & analytics connections ---- */}
        <Widget label="Search & analytics" href="/insights" cta="Insights">
          <BigNum
            value={`${(gscOn ? 1 : 0) + (gaOn ? 1 : 0)}/2`}
            sub="sources connected"
            tone={gscOn && gaOn ? 'rgb(var(--opportunity))' : undefined}
          />
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
            Search Console {gscOn ? <span className="text-opportunity">on</span> : 'off'} ·
            Analytics {gaOn ? <span className="text-opportunity">on</span> : 'off'}
          </p>
        </Widget>

        {/* ---- Severity breakdown ---- */}
        <Widget label="Issues by priority" className="sm:col-span-2" href={latest ? `/crawl/${latest.id}` : undefined} cta={latest ? 'Detail' : undefined}>
          {report ? (
            <div className="grid flex-1 grid-cols-5 gap-2">
              {SEVERITY_ORDER.map((sev) => (
                <div key={sev} className="flex flex-col justify-end border-l border-line pl-2">
                  <div className="tnum text-[26px] font-normal leading-none" style={{ color: SEVERITY_COLOR[sev] }}>
                    {report.severity?.[sev] ?? 0}
                  </div>
                  <div className="mt-1.5 font-mono text-[8.5px] uppercase tracking-[0.08em] text-muted">
                    {SEVERITY_LABEL[sev]}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="flex flex-1 items-center text-[13px] text-muted">Run an audit to populate.</p>
          )}
        </Widget>

        {/* ---- PageRank ---- */}
        <Widget label="Most important pages" className="sm:col-span-2" href={latest ? `/crawl/${latest.id}` : undefined} cta={latest ? 'All pages' : undefined}>
          {topPages.length ? (
            <ul className="flex flex-1 flex-col justify-center gap-2">
              {topPages.map((p) => (
                <li key={p.url} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[11px] text-ink">{shortUrl(p.url, 52)}</div>
                    <div className="mt-1 h-[3px] w-full bg-line">
                      <div className="h-full bg-ink" style={{ width: (maxRank > 0 ? (p.pageRank / maxRank) * 100 : 0) + '%' }} />
                    </div>
                  </div>
                  <span className="tnum shrink-0 font-mono text-[11px] text-muted">{p.pageRank.toFixed(3)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex flex-1 items-center text-[13px] text-muted">Run an audit to see this.</p>
          )}
        </Widget>

        {/* ---- AI visibility ---- */}
        <Widget label="AI visibility" href="/ai-visibility" cta="Check">
          <BigNum
            value={aiRisk === null ? '—' : aiRisk}
            sub={aiRisk === null ? 'no audit yet' : 'pages need JavaScript'}
            tone={aiRisk ? 'rgb(var(--warning))' : undefined}
          />
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
            {aiRisk === null
              ? 'Run an audit to check'
              : aiRisk === 0
                ? <span className="text-opportunity">Answer engines see every page</span>
                : 'Hidden from ChatGPT, Claude & Perplexity'}
          </p>
        </Widget>

        {/* ---- Ranks ---- */}
        <Widget label="Rank tracking" href="/ranks" cta="Ranks">
          <BigNum value={avgPos !== null ? '#' + avgPos : '—'} sub="avg position" />
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
            {keywords.length ? <>{keywords.length} keywords · {top10} in top 10</> : 'No keywords tracked'}
          </p>
        </Widget>

        {/* ---- Backlinks ---- */}
        <Widget label="Backlinks" href="/backlinks" cta="Backlinks">
          <BigNum value={bl.active} sub="active links" />
          <p className="mt-3 font-mono text-[11px] leading-relaxed text-muted">
            {bl.total
              ? <>{bl.referringDomains} ref domains · {bl.lost ? <span className="text-blocker">{bl.lost} lost</span> : 'none lost'}</>
              : 'No backlinks tracked'}
          </p>
        </Widget>

        {/* ---- Next.js ---- */}
        <Widget label="Framework" href={latest ? `/crawl/${latest.id}` : undefined} cta={latest ? 'Report' : undefined}>
          {report?.isNext && report.nextSummary ? (
            <>
              <BigNum value="Next.js" sub={report.nextSummary.router + ' router'} tone="rgb(var(--accent))" />
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(report.nextSummary.strategies).slice(0, 4).map(([k, n]) => (
                  <span key={k} className="border border-line px-1.5 py-0.5 font-mono text-[9.5px] text-muted">
                    {k} <span className="tnum text-ink">{n}</span>
                  </span>
                ))}
              </div>
            </>
          ) : (
            <BigNum value={report ? 'Generic' : '—'} sub={report ? 'not Next.js' : 'no audit yet'} />
          )}
        </Widget>

        {/* ---- Traffic (only when GSC/GA4 connected) ---- */}
        {hasTraffic && (
          <Widget label="Search traffic" className="sm:col-span-2" href={latest ? `/crawl/${latest.id}` : undefined} cta="Report">
            <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-4">
              {gsc?.connected && (
                <>
                  <div className="flex flex-col justify-end">
                    <div className="tnum text-[24px] font-normal leading-none">{gsc.totalClicks.toLocaleString()}</div>
                    <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">GSC clicks</div>
                  </div>
                  <div className="flex flex-col justify-end">
                    <div className="tnum text-[24px] font-normal leading-none">{gsc.totalImpressions.toLocaleString()}</div>
                    <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Impressions</div>
                  </div>
                </>
              )}
              {ga4?.connected && (
                <>
                  <div className="flex flex-col justify-end">
                    <div className="tnum text-[24px] font-normal leading-none">{ga4.totalSessions.toLocaleString()}</div>
                    <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">GA4 sessions</div>
                  </div>
                  <div className="flex flex-col justify-end">
                    <div className="tnum text-[24px] font-normal leading-none">{ga4.totalUsers.toLocaleString()}</div>
                    <div className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">Users</div>
                  </div>
                </>
              )}
            </div>
          </Widget>
        )}
      </div>
    </div>
  );
}
