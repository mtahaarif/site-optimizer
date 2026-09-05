import { connection } from 'next/server';
import { fetchPageMetrics, fetchQueryMetrics, defaultRange } from '@/src/core/gsc/client.ts';
import { gscConfigured, gscSiteUrl } from '@/src/core/gsc/auth.ts';
import { fetchGa4Metrics, ga4Configured, ga4PropertyId } from '@/src/core/ga4/client.ts';
import { ConnectGuide } from './connect-guide.tsx';
import { pageMeta } from '../meta.ts';

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

function Status({ ok }: { ok: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-[11px] font-medium"
      style={{
        color: ok ? 'rgb(var(--opportunity))' : 'rgb(var(--muted))',
        borderColor: ok ? 'rgb(var(--opportunity))' : 'rgb(var(--line))',
      }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: ok ? 'rgb(var(--opportunity))' : 'rgb(var(--muted))' }} />
      {ok ? 'Connected' : 'Not connected'}
    </span>
  );
}

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

  const gscOn = gscConfigured();
  const gaOn = ga4Configured();
  const range = defaultRange();

  const [pages, queries, ga] = await Promise.all([
    gscOn ? fetchPageMetrics() : null,
    gscOn ? fetchQueryMetrics({ limit: 25 }) : null,
    gaOn ? fetchGa4Metrics() : null,
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
          are performing. Connect Google Search Console and Google Analytics to fill this in.
        </p>
      </div>

      {/* ---- connections ---- */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="border border-line bg-surface p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-medium text-ink">Google Search Console</h2>
              <p className="mt-1 text-[12.5px] text-muted">How you appear in Google search results.</p>
            </div>
            <Status ok={gscOn} />
          </div>
          {gscOn && (
            <p className="mt-3 font-mono text-[11.5px] text-muted">
              {gscSiteUrl()} · {range.startDate} → {range.endDate}
              {pages?.fromCache && ' · cached'}
            </p>
          )}
          {pages?.error && <p className="mt-3 border border-warning px-3 py-2 text-[12.5px] text-warning">{pages.error}</p>}
          {!gscOn && <ConnectGuide kind="gsc" />}
        </div>

        <div className="border border-line bg-surface p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-medium text-ink">Google Analytics</h2>
              <p className="mt-1 text-[12.5px] text-muted">What visitors do once they arrive.</p>
            </div>
            <Status ok={gaOn} />
          </div>
          {gaOn && (
            <p className="mt-3 font-mono text-[11.5px] text-muted">
              Property {ga4PropertyId()} · {range.startDate} → {range.endDate}
              {ga?.fromCache && ' · cached'}
            </p>
          )}
          {ga?.error && <p className="mt-3 border border-warning px-3 py-2 text-[12.5px] text-warning">{ga.error}</p>}
          {!gaOn && <ConnectGuide kind="ga4" />}
        </div>
      </div>

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
          automatically.
        </p>
      )}
    </div>
  );
}
