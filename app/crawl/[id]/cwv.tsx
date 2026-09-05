'use client';

import type { AuditReport } from '@/src/crawler/audit.ts';
import type { CoreWebVitalsData, MetricScore } from '@/src/core/pagespeed/types.ts';
import { SCORE_COLOR, SCORE_LABEL } from '@/src/core/pagespeed/types.ts';

const shortUrl = (u: string): string => {
  try {
    const url = new URL(u);
    return url.pathname === '/' ? url.hostname : url.pathname;
  } catch { return u; }
};

const fmtMs = (ms: number): string =>
  ms >= 1000 ? (ms / 1000).toFixed(2) + ' s' : Math.round(ms) + ' ms';

/** A single metric readout: value, verdict colour, and where the number came from. */
function MetricTile({
  label, value, score, source, core,
}: {
  label: string; value: string; score: MetricScore; source: string; core?: boolean;
}) {
  return (
    <div
      className="rounded border bg-surface px-3 py-2.5"
      style={{ borderColor: SCORE_COLOR[score] }}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-muted">
          {label}
        </span>
        {core && (
          <span
            className="rounded-sm px-1 font-mono text-[8px] font-bold uppercase tracking-[0.08em]"
            style={{ background: 'rgb(var(--line))', color: 'rgb(var(--muted))' }}
            title="Core Web Vital — a confirmed Google ranking signal"
          >
            CWV
          </span>
        )}
      </div>
      <div className="tnum mt-1 text-[19px] font-bold leading-none" style={{ color: SCORE_COLOR[score] }}>
        {value}
      </div>
      <div className="mt-1 font-mono text-[9.5px] text-muted">
        {SCORE_LABEL[score]} · {source}
      </div>
    </div>
  );
}

/** Circular gauge for the Lighthouse performance score, Google's own banding. */
function ScoreGauge({ score, label }: { score: number; label: string }) {
  const size = 96;
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, score)) / 100) * c;
  const color = score >= 90 ? SCORE_COLOR.GOOD
    : score >= 50 ? SCORE_COLOR.NEEDS_IMPROVEMENT : SCORE_COLOR.POOR;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: 'rgb(var(--line))' }} strokeWidth="6" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="6"
            strokeLinecap="round" strokeDasharray={`${filled} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="tnum text-[26px] font-bold leading-none" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">{label}</span>
    </div>
  );
}

function VitalsFor({ data }: { data: CoreWebVitalsData }) {
  const m = data.metrics;
  const src = (s: string) => (s === 'field' ? (data.cruxOriginFallback ? 'CrUX origin' : 'CrUX field') : 'Lab');

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <MetricTile core label="LCP" value={fmtMs(m.lcp.valueMs)} score={m.lcp.score} source={src(m.lcp.source)} />
      <MetricTile core label="CLS" value={m.cls.value.toFixed(3)} score={m.cls.score} source={src(m.cls.source)} />
      {m.inp
        ? <MetricTile core label="INP" value={fmtMs(m.inp.valueMs)} score={m.inp.score} source={src(m.inp.source)} />
        : <MetricTile label="TBT" value={fmtMs(m.tbt.valueMs)} score={m.tbt.score} source="Lab proxy for INP" />}
      <MetricTile label="FCP" value={fmtMs(m.fcp.valueMs)} score={m.fcp.score} source={src(m.fcp.source)} />
      <MetricTile label="Speed Index" value={fmtMs(m.speedIndex.valueMs)} score={m.speedIndex.score} source="Lab" />
    </div>
  );
}

export function CoreWebVitalsCard({ report }: { report: AuditReport }) {
  const ps = report.pagespeed;
  if (!ps) return null;

  // Not run at all, or every request failed — say which, rather than showing nothing.
  if (!ps.attempted || ps.results.length === 0) {
    const reason = !ps.attempted
      ? 'PageSpeed Insights was not run for this crawl.'
      : (ps.errors[0]?.error ?? 'No data returned.');
    return (
      <section>
        <h3 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          Core Web Vitals
        </h3>
        <div className="rounded border border-warning bg-surface p-4">
          <p className="text-[13px] text-ink">{reason}</p>
          {!ps.usedApiKey && (
            <p className="mt-2 max-w-[72ch] text-[12.5px] leading-relaxed text-muted">
              No <code className="font-mono">PAGESPEED_API_KEY</code> is set, so requests use
              Google&rsquo;s shared anonymous quota — which is frequently exhausted. A free key
              from the Google Cloud console raises this to 25,000 requests/day.
            </p>
          )}
          {ps.errors.length > 1 && (
            <ul className="mt-2 flex flex-col gap-0.5">
              {ps.errors.slice(0, 4).map((e, i) => (
                <li key={i} className="font-mono text-[11px] text-muted">
                  {shortUrl(e.url)} ({e.strategy}): {e.error.slice(0, 110)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    );
  }

  const mobile = ps.results.filter((r) => r.strategy === 'mobile');
  const desktop = ps.results.find((r) => r.strategy === 'desktop');
  const primary = mobile[0] ?? ps.results[0]!;
  const others = mobile.slice(1);

  return (
    <section>
      <h3 className="mb-3 flex flex-wrap items-baseline gap-x-3 border-b border-line pb-2">
        <span className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          Core Web Vitals
        </span>
        <span className="font-mono text-[11px] text-muted">
          {shortUrl(primary.url)} · {ps.results.length} measurement
          {ps.results.length === 1 ? '' : 's'}
          {primary.fromCache && ' · cached'}
        </span>
      </h3>

      <div className="flex flex-col gap-5 rounded border border-line bg-surface p-5 lg:flex-row">
        <div className="flex shrink-0 gap-5">
          <ScoreGauge score={primary.performanceScore} label="Mobile" />
          {desktop && <ScoreGauge score={desktop.performanceScore} label="Desktop" />}
        </div>

        <div className="flex-1">
          <VitalsFor data={primary} />

          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            {primary.fieldDataAvailable
              ? primary.cruxOriginFallback
                ? 'This URL has no page-level CrUX data, so field metrics come from origin-wide real-user data. Lab metrics are Lighthouse.'
                : 'Field metrics are real Chrome user data from the last 28 days — this is what Google ranks on. Lab metrics are a Lighthouse simulation.'
              : 'No CrUX data exists for this URL, so every metric is a Lighthouse lab simulation. Useful for debugging, but not the ranking signal.'}
          </p>

          {primary.lcpElement && (
            <p className="mt-2 font-mono text-[11px] text-muted">
              LCP element: <span className="text-ink">{primary.lcpElement.slice(0, 120)}</span>
            </p>
          )}

          {primary.opportunities && primary.opportunities.length > 0 && (
            <div className="mt-3">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
                Largest opportunities
              </div>
              <ul className="mt-1 flex flex-col gap-0.5">
                {primary.opportunities.map((o) => (
                  <li key={o.id} className="flex justify-between gap-4 font-mono text-[11.5px]">
                    <span className="text-ink">{o.title}</span>
                    <span className="tnum shrink-0 text-muted">~{fmtMs(o.savingsMs)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {others.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
            Other sampled pages (mobile)
          </div>
          <div className="scroll-x">
            <table className="w-full min-w-[560px] border-collapse font-mono text-[11.5px]">
              <caption className="sr-only">Core Web Vitals per measured URL</caption>
              <thead>
                <tr className="border-b border-line text-left text-[9.5px] uppercase tracking-[0.1em] text-muted">
                  <th className="pb-1.5 pr-3">URL</th>
                  <th className="pb-1.5 pr-3 text-right">Score</th>
                  <th className="pb-1.5 pr-3 text-right">LCP</th>
                  <th className="pb-1.5 pr-3 text-right">CLS</th>
                  <th className="pb-1.5 text-right">TBT</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {others.map((d) => (
                  <tr key={d.url} className="border-b border-line/50 last:border-0">
                    <td className="max-w-[240px] truncate py-1.5 pr-3 text-ink">{shortUrl(d.url)}</td>
                    <td className="py-1.5 pr-3 text-right font-bold"
                      style={{ color: d.performanceScore >= 90 ? SCORE_COLOR.GOOD : d.performanceScore >= 50 ? SCORE_COLOR.NEEDS_IMPROVEMENT : SCORE_COLOR.POOR }}>
                      {d.performanceScore}
                    </td>
                    <td className="py-1.5 pr-3 text-right" style={{ color: SCORE_COLOR[d.metrics.lcp.score] }}>
                      {fmtMs(d.metrics.lcp.valueMs)}
                    </td>
                    <td className="py-1.5 pr-3 text-right" style={{ color: SCORE_COLOR[d.metrics.cls.score] }}>
                      {d.metrics.cls.value.toFixed(3)}
                    </td>
                    <td className="py-1.5 text-right" style={{ color: SCORE_COLOR[d.metrics.tbt.score] }}>
                      {fmtMs(d.metrics.tbt.valueMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {ps.errors.length > 0 && (
        <p className="mt-2 font-mono text-[11px] text-warning">
          {ps.errors.length} measurement(s) failed: {ps.errors[0]!.error.slice(0, 120)}
        </p>
      )}
    </section>
  );
}
