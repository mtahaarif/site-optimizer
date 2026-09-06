import { connection } from 'next/server';
import { fetchPageMetrics, fetchQueryMetrics, defaultRange } from '@/src/core/gsc/client.ts';
import { fetchGa4Metrics } from '@/src/core/ga4/client.ts';
import {
  allIntegrationStatuses, noteIntegrationError, reusableServiceAccount, PROVIDERS,
  type Provider,
} from '@/src/core/integrations/store.ts';
import { Connections } from './connections.tsx';
import { pageMeta } from '../meta.ts';
import { PageNotes } from '../page-notes.tsx';

export const instant = false;
export const metadata = pageMeta({
  title: 'Search & traffic insights',
  description: 'See what people search to find you, which pages bring the most visits, and how your search results are performing.',
  path: '/insights',
});

const nf = (n: number) => n.toLocaleString();
const pct = (n: number) => (n * 100).toFixed(1) + '%';
const secs = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}m ${Math.round(n % 60)}s` : `${Math.round(n)}s`);
const shortPath = (u: string, max = 52) => {
  try { const x = new URL(u); const s = x.pathname + x.search; return (s === '/' ? x.hostname : s).slice(0, max); }
  catch { return u.slice(0, max); }
};

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-line bg-surface px-4 py-3.5">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="tnum mt-1.5 text-[26px] font-normal leading-none tracking-tight">{value}</div>
      {hint && <div className="mt-1.5 text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function Panel({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="border border-line bg-surface">
      <div className="border-b border-line px-5 py-3.5">
        <h2 className="text-[15px] font-medium text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[12.5px] text-muted">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={'px-5 py-2 text-[11px] font-medium text-muted ' + (right ? 'text-right' : 'text-left')}>{children}</th>
);
const Td = ({ children, right, className = '' }: { children: React.ReactNode; right?: boolean; className?: string }) => (
  <td className={'px-5 py-2.5 ' + (right ? 'text-right tnum ' : '') + className}>{children}</td>
);

export default async function InsightsPage() {
  await connection();

  const [integrations, reusable] = await Promise.all([
    allIntegrationStatuses(),
    // What each card can offer as a one-click "use the account already on
    // file", computed per provider so a card never offers its own account.
    Promise.all(PROVIDERS.map(async (p) => [p, (await reusableServiceAccount(p))?.account ?? null] as const)),
  ]);
  const reusableAccounts = Object.fromEntries(reusable) as Partial<Record<Provider, string | null>>;

  const gscOn = integrations.find((i) => i.provider === 'gsc')?.connected ?? false;
  const gaOn = integrations.find((i) => i.provider === 'ga4')?.connected ?? false;
  const gscProperty = integrations.find((i) => i.provider === 'gsc')?.label ?? null;
  const gaProperty = integrations.find((i) => i.provider === 'ga4')?.label ?? null;
  const range = defaultRange();

  const [pages, queries, ga] = await Promise.all([
    gscOn ? fetchPageMetrics() : null,
    gscOn ? fetchQueryMetrics({ limit: 25 }) : null,
    gaOn ? fetchGa4Metrics() : null,
  ]);

  // Record what the live queries said, so a connection that has since been
  // revoked shows the reason on its card rather than only inside a report.
  await Promise.all([
    gscOn ? noteIntegrationError('gsc', pages?.error ?? null) : null,
    gaOn ? noteIntegrationError('ga4', ga?.error ?? null) : null,
  ]);

  const topPages = pages
    ? [...pages.byUrl.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 25)
    : [];
  const avgCtr = pages && pages.totalImpressions > 0 ? pages.totalClicks / pages.totalImpressions : 0;
  const avgPos = topPages.length
    ? topPages.reduce((s, p) => s + p.position, 0) / topPages.length
    : 0;

  const gaPages = ga
    ? [...ga.byPath.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 25)
    : [];
  const avgBounce = gaPages.length ? gaPages.reduce((s, p) => s + p.bounceRate, 0) / gaPages.length : 0;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">Search &amp; traffic insights</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-muted">
          What people search to find you, which pages bring the most visits, and how your listings
          are performing. Connect an account below and this page fills in on the next load;
          disconnect it, or point it at a different property, whenever you like.
        </p>
      </div>

      {/* ---- connections ---- */}
      <Connections integrations={integrations} reusableAccounts={reusableAccounts} />

      {(gscOn || gaOn) && (
        <p className="font-mono text-[11.5px] text-muted">
          {gscOn && `${gscProperty} · `}
          {gaOn && `${gaProperty} · `}
          {range.startDate} → {range.endDate}
          {pages?.fromCache && ' · search cached'}
          {ga?.fromCache && ' · analytics cached'}
        </p>
      )}

      {/* ---- search console ---- */}
      {gscOn && pages && !pages.error && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Clicks" value={nf(pages.totalClicks)} hint="visits from search" />
            <Kpi label="Impressions" value={nf(pages.totalImpressions)} hint="times you appeared" />
            <Kpi label="Click-through rate" value={pct(avgCtr)} hint="clicks per appearance" />
            <Kpi label="Average position" value={avgPos ? avgPos.toFixed(1) : '—'} hint="across your top pages" />
          </div>

          <Panel title="Top search terms" subtitle="The phrases people typed before landing on your site.">
            <div className="scroll-x">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <caption className="sr-only">Top search terms by clicks and impressions</caption>
                <thead className="border-b border-line bg-surface-2">
                  <tr><Th>Search term</Th><Th right>Clicks</Th><Th right>Impressions</Th><Th right>CTR</Th><Th right>Position</Th></tr>
                </thead>
                <tbody>
                  {(queries?.rows ?? []).length === 0 && (
                    <tr><Td className="text-muted">{queries?.error ?? 'No search terms recorded in this period yet.'}</Td></tr>
                  )}
                  {(queries?.rows ?? []).map((q) => (
                    <tr key={q.query} className="border-b border-line/60 hover:bg-surface-2">
                      <Td className="text-ink">{q.query}</Td>
                      <Td right>{nf(q.clicks)}</Td>
                      <Td right className="text-muted">{nf(q.impressions)}</Td>
                      <Td right className="text-muted">{pct(q.ctr)}</Td>
                      <Td right className="text-muted">{q.position.toFixed(1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="Top pages in search" subtitle="Which of your pages bring in the most visits from Google.">
            <div className="scroll-x">
              <table className="w-full min-w-[620px] border-collapse text-[13px]">
                <caption className="sr-only">Top pages in search by clicks and impressions</caption>
                <thead className="border-b border-line bg-surface-2">
                  <tr><Th>Page</Th><Th right>Clicks</Th><Th right>Impressions</Th><Th right>CTR</Th><Th right>Position</Th></tr>
                </thead>
                <tbody>
                  {topPages.length === 0 && <tr><Td className="text-muted">No page data in this period yet.</Td></tr>}
                  {topPages.map((p) => (
                    <tr key={p.url} className="border-b border-line/60 hover:bg-surface-2">
                      <Td>
                        <a href={p.url} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">{shortPath(p.url)}</a>
                      </Td>
                      <Td right>{nf(p.clicks)}</Td>
                      <Td right className="text-muted">{nf(p.impressions)}</Td>
                      <Td right className="text-muted">{pct(p.ctr)}</Td>
                      <Td right className="text-muted">{p.position.toFixed(1)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* ---- analytics ---- */}
      {gaOn && ga && !ga.error && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Visits" value={nf(ga.totalSessions)} hint="sessions in this period" />
            <Kpi label="People" value={nf(ga.totalUsers)} hint="unique visitors" />
            <Kpi label="Page views" value={nf(ga.totalPageviews)} />
            <Kpi label="Conversions" value={nf(ga.totalConversions)} hint="goals completed" />
          </div>

          <Panel title="Most visited pages" subtitle="Where your visitors actually spend their time.">
            <div className="scroll-x">
              <table className="w-full min-w-[680px] border-collapse text-[13px]">
                <caption className="sr-only">Most visited pages by visits and people</caption>
                <thead className="border-b border-line bg-surface-2">
                  <tr><Th>Page</Th><Th right>Visits</Th><Th right>People</Th><Th right>Views</Th><Th right>Left right away</Th><Th right>Avg. time</Th></tr>
                </thead>
                <tbody>
                  {gaPages.length === 0 && <tr><Td className="text-muted">No visits recorded in this period yet.</Td></tr>}
                  {gaPages.map((p) => (
                    <tr key={p.path} className="border-b border-line/60 hover:bg-surface-2">
                      <Td className="text-ink">{p.path}</Td>
                      <Td right>{nf(p.sessions)}</Td>
                      <Td right className="text-muted">{nf(p.users)}</Td>
                      <Td right className="text-muted">{nf(p.pageviews)}</Td>
                      <Td right className="text-muted">{pct(p.bounceRate)}</Td>
                      <Td right className="text-muted">{secs(p.avgDurationSec)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
          {avgBounce > 0 && (
            <p className="text-[12.5px] text-muted">
              On average {pct(avgBounce)} of visitors leave without interacting. Pages well above that
              are usually the ones worth improving first.
            </p>
          )}
        </div>
      )}

      {!gscOn && !gaOn && (
        <p className="border border-line bg-surface p-8 text-center text-[14px] text-muted">
          Nothing to show yet. Connect Search Console or Analytics above and this page fills in
          automatically — no restart, and no environment variables to edit.
        </p>
      )}

      <PageNotes
        title="What these numbers mean"
        intro={<>Search Console describes what happens before the click; Analytics describes what happens after
          it. Neither is complete on its own, which is why both sit on one page: the interesting pages are the
          ones where the two disagree.</>}
        items={[
          { term: 'Impressions', body: <>How often a page of yours appeared in results for anything at all. High
            impressions with almost no clicks is a snippet problem &mdash; the title and description are not earning
            the click &mdash; rather than a ranking problem.</> },
          { term: 'Clicks and CTR', body: <>Clicks as a share of impressions. Compare a page against its own average
            position rather than against other pages: rank three with a poor rate is a page worth rewriting, while
            rank thirty with the same rate is simply too low to judge.</> },
          { term: 'Average position', body: <>Averaged across every query the page appeared for, so it moves when
            the mix of queries changes and not only when you gain or lose ground. Treat it as a direction, and use
            rank tracking for the phrases you actually care about.</> },
          { term: 'Sessions and users', body: <>From Analytics, counting visits that arrived by any route &mdash; search,
            links, email, direct. A page with sessions but no impressions is being reached some other way, which is
            worth knowing before you decide it is failing.</> },
          { term: 'Why this feeds the audit', body: <>Once connected, these figures weight the audit itself. A missing
            title on a page with fifty thousand impressions outranks the same defect on a page nobody has ever
            reached, so the issue list is ordered by consequence instead of by severity alone.</> },
          { term: 'Why the two disagree', body: <>Search Console counts a click when someone leaves the results
            page; Analytics counts a session when the page loads and its script runs. Ad blockers, bounced
            loads and consent banners all land between those two events, so a persistent gap is normal and
            only a widening one is a signal.</> },
          { term: 'The date range', body: <>Both sources report on a trailing window, and Search Console data
            settles over roughly three days. Judging yesterday against last week is comparing a partial figure
            with a complete one, which is why a fresh drop at the right-hand edge is usually not real.</> },
        ]}
        footnote={<>Both connections are made here rather than in environment variables: paste the key, pick the
          property from the list Google returns, and it takes effect immediately. Credentials are encrypted at rest
          and can be disconnected or pointed at another account at any time.</>}
      />
    </div>
  );
}
