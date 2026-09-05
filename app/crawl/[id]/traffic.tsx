'use client';

import type { AuditReport } from '@/src/crawler/audit.ts';
import { Stat } from '../../ui.tsx';

const num = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => (n * 100).toFixed(1) + '%';

const shortPath = (url: string): string => {
  try {
    const u = new URL(url);
    return u.pathname === '/' ? '/' : u.pathname;
  } catch { return url; }
};

/**
 * Organic and engagement summary.
 *
 * Deliberately shows both sources side by side rather than merging them into
 * one "traffic" number: Search Console measures acquisition and GA4 measures
 * behaviour, and where they disagree is usually the interesting part.
 */
export function TrafficCard({ report }: { report: AuditReport }) {
  const gsc = report.traffic?.gsc;
  const ga4 = report.traffic?.ga4;
  if (!gsc && !ga4) return null;

  // Top landing pages by whichever signal is available.
  const top = [...report.pages]
    .filter((p) => (p.sessions ?? 0) > 0 || (p.impressions ?? 0) > 0)
    .sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0)
      || (b.impressions ?? 0) - (a.impressions ?? 0))
    .slice(0, 6);

  const convRate = ga4 && ga4.totalSessions > 0
    ? ga4.totalConversions / ga4.totalSessions : 0;

  return (
    <section>
      <h3 className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b border-line pb-2">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          Organic &amp; engagement traffic
        </span>
        {(gsc?.connected || ga4?.connected) && (
          <span className="font-mono text-[11px] text-muted">
            {gsc?.startDate ?? ga4?.startDate} to {gsc?.endDate ?? ga4?.endDate}
            {(gsc?.fromCache || ga4?.fromCache) && ' · cached'}
          </span>
        )}
      </h3>

      {gsc?.error && (
        <p className="mb-3 rounded border border-warning px-3 py-2 font-mono text-[11.5px] text-warning">
          Search Console: {gsc.error}
        </p>
      )}
      {ga4?.error && (
        <p className="mb-3 rounded border border-warning px-3 py-2 font-mono text-[11.5px] text-warning">
          GA4: {ga4.error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {gsc?.connected && (
          <>
            <Stat label="Impressions" value={num(gsc.totalImpressions)} />
            <Stat label="Clicks" value={num(gsc.totalClicks)} tone="rgb(var(--accent))" />
            <Stat
              label="Organic CTR"
              value={gsc.totalImpressions > 0 ? pct(gsc.totalClicks / gsc.totalImpressions) : '—'}
            />
          </>
        )}
        {ga4?.connected && (
          <>
            <Stat label="Sessions" value={num(ga4.totalSessions)} />
            <Stat label="Users" value={num(ga4.totalUsers)} />
            <Stat
              label="Conversions"
              value={num(ga4.totalConversions)}
              tone={ga4.totalConversions > 0 ? 'rgb(var(--accent))' : undefined}
            />
          </>
        )}
      </div>

      {ga4?.connected && ga4.totalConversions > 0 && (
        <p className="mt-2 font-mono text-[11px] text-muted">
          conversion rate {pct(convRate)} · {num(ga4.totalPageviews)} pageviews ·
          {' '}{ga4.pathsWithData} path(s) with data
        </p>
      )}

      {top.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
            Top landing pages
          </div>
          <div className="scroll-x">
            <table className="w-full min-w-[640px] border-collapse font-mono text-[11.5px]">
              <caption className="sr-only">Search and analytics metrics per page</caption>
              <thead>
                <tr className="border-b border-line text-left text-[9.5px] uppercase tracking-[0.1em] text-muted">
                  <th className="pb-1.5 pr-3">Page</th>
                  {ga4?.connected && <th className="pb-1.5 pr-3 text-right">Sessions</th>}
                  {ga4?.connected && <th className="pb-1.5 pr-3 text-right">Conv.</th>}
                  {gsc?.connected && <th className="pb-1.5 pr-3 text-right">Impr.</th>}
                  {gsc?.connected && <th className="pb-1.5 pr-3 text-right">Clicks</th>}
                  <th className="pb-1.5 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {top.map((p) => (
                  <tr key={p.url} className="border-b border-line/50 last:border-0">
                    <td className="max-w-[260px] truncate py-1.5 pr-3 text-ink">{shortPath(p.url)}</td>
                    {ga4?.connected && <td className="py-1.5 pr-3 text-right text-muted">{num(p.sessions ?? 0)}</td>}
                    {ga4?.connected && (
                      <td className="py-1.5 pr-3 text-right"
                        style={{ color: (p.conversions ?? 0) > 0 ? 'rgb(var(--accent))' : undefined }}>
                        {num(p.conversions ?? 0)}
                      </td>
                    )}
                    {gsc?.connected && <td className="py-1.5 pr-3 text-right text-muted">{num(p.impressions ?? 0)}</td>}
                    {gsc?.connected && <td className="py-1.5 pr-3 text-right text-muted">{num(p.clicks ?? 0)}</td>}
                    <td className="py-1.5 text-right font-bold"
                      style={{ color: p.score >= 75 ? 'rgb(var(--accent))'
                        : p.score >= 50 ? 'rgb(var(--warning))' : 'rgb(var(--blocker))' }}>
                      {p.score.toFixed(0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 max-w-[76ch] text-[12px] leading-relaxed text-muted">
            The score column is the point of this table: a low score beside a high session
            count is technical debt on a page that is actually earning something. The scoring
            model already weights these pages more heavily — this is where you see why.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Traffic impact for one failing check, shown inline with the finding.
 *
 * "This affects 12 pages" is a scope. "This affects pages generating 4,200
 * monthly sessions" is a priority.
 */
export function CheckTrafficImpact({
  report, urls,
}: { report: AuditReport; urls: string[] }) {
  if (!report.traffic?.gsc?.connected && !report.traffic?.ga4?.connected) return null;

  const set = new Set(urls);
  let sessions = 0, impressions = 0, clicks = 0, conversions = 0;
  for (const p of report.pages) {
    if (!set.has(p.url)) continue;
    sessions += p.sessions ?? 0;
    impressions += p.impressions ?? 0;
    clicks += p.clicks ?? 0;
    conversions += p.conversions ?? 0;
  }
  if (sessions + impressions + clicks === 0) return null;

  const parts: string[] = [];
  if (sessions) parts.push(`${num(sessions)} sessions`);
  if (impressions) parts.push(`${num(impressions)} impressions`);
  if (clicks) parts.push(`${num(clicks)} clicks`);
  if (conversions) parts.push(`${num(conversions)} conversions`);

  return (
    <p
      className="mt-2 rounded px-2.5 py-1.5 font-mono text-[11.5px]"
      style={{
        background: conversions > 0 ? 'rgb(var(--blocker) / 0.08)' : 'rgb(var(--warning) / 0.08)',
        color: conversions > 0 ? 'rgb(var(--blocker))' : 'rgb(var(--warning))',
      }}
    >
      Affects pages generating {parts.join(' · ')}
    </p>
  );
}
