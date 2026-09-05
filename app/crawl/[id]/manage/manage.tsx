'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

/**
 * Robots.txt & Sitemap manager. The deploy loop, stage one: detect problems,
 * generate the corrected file, and hand it back to copy or download. No live
 * write-back yet (that needs a per-CMS/repo connection) — but the generate side,
 * which is the hard part, is done deterministically with zero dependencies.
 */

export interface SitemapInfo { url: string; entryCount: number; formatError: string | null }

function lintRobots(raw: string, discoveredSitemaps: string[]) {
  const rawLines = raw.split(/\r?\n/);
  const lines = rawLines.map((l) => l.trim());
  const nonEmpty = lines.filter((l) => l.length > 0);
  const hasBlank = nonEmpty.length !== lines.length;
  const hasUA = nonEmpty.some((l) => /^user-agent:/i.test(l));
  const hasSitemap = nonEmpty.some((l) => /^sitemap:/i.test(l));

  // dedupe exact duplicate directives, keep order
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const l of nonEmpty) {
    const key = l.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(l);
  }
  const removedDupes = nonEmpty.length - deduped.length;

  const optimized = [...deduped];
  let addedSitemap = false;
  if (!hasSitemap && discoveredSitemaps.length) {
    for (const sm of discoveredSitemaps) optimized.push(`Sitemap: ${sm}`);
    addedSitemap = true;
  }
  if (!hasUA) optimized.unshift('User-agent: *');

  const issues: string[] = [];
  if (hasBlank) issues.push('Contains blank or padded lines — collapse to a clean directive list.');
  if (!hasUA) issues.push('No User-agent directive — added "User-agent: *".');
  if (!hasSitemap) issues.push(discoveredSitemaps.length ? 'No Sitemap reference — added the discovered sitemap(s).' : 'No Sitemap reference, and none was discovered during the crawl.');
  if (removedDupes > 0) issues.push(`${removedDupes} duplicate directive(s) removed.`);

  const changed: string[] = [];
  if (hasBlank) changed.push('Removed blank lines between directives');
  if (removedDupes) changed.push(`Removed ${removedDupes} duplicate directive(s)`);
  if (addedSitemap) changed.push('Added Sitemap reference(s)');
  if (!hasUA) changed.push('Added a User-agent line');

  return { issues, changed, optimized: optimized.join('\n') + '\n', clean: issues.length === 0 };
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
      }}
      className="border border-ink px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink hover:bg-ink hover:text-ground"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

function DownloadBtn({ text, name }: { text: string; name: string }) {
  return (
    <button
      onClick={() => {
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name; a.click();
        URL.revokeObjectURL(url);
      }}
      className="border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted hover:border-ink hover:text-ink"
    >
      Download
    </button>
  );
}

export function Manage({
  origin, robotsText, robotsError, sitemaps,
}: {
  origin: string;
  robotsText: string | null;
  robotsError: string | null;
  sitemaps: SitemapInfo[];
}) {
  const discovered = useMemo(() => sitemaps.map((s) => s.url), [sitemaps]);
  const lint = useMemo(() => (robotsText != null ? lintRobots(robotsText, discovered) : null), [robotsText, discovered]);
  const totalUrls = sitemaps.reduce((s, m) => s + m.entryCount, 0);
  const withErrors = sitemaps.filter((m) => m.formatError);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="../" className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink">← Report</Link>
        <h1 className="mt-3 text-[28px] font-normal tracking-tight">
          Robots &amp; sitemap · {origin.replace(/^https?:\/\//, '')}
        </h1>
        <p className="mt-1 font-mono text-[11.5px] text-muted">{origin.replace(/^https?:\/\//, '')}</p>
        <p className="mt-3 max-w-[74ch] text-[13px] leading-relaxed text-muted">
          Detects problems and generates the corrected file for you to copy or download, then
          commit to <span className="font-mono text-ink">public/robots.txt</span> (or paste into your
          CMS). Live one-click deploy is the next stage — it needs a repo or CMS connection.
        </p>
      </div>

      {/* ---- robots.txt ---- */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">Current robots.txt</h2>
            <span className="font-mono text-[10px] text-muted">{origin}/robots.txt</span>
          </div>
          {robotsError ? (
            <p className="mt-4 border border-warning p-3 text-[13px] text-warning">{robotsError}</p>
          ) : (
            <pre className="scroll-x mt-4 border border-line bg-ground p-3 font-mono text-[11.5px] leading-relaxed text-ink">
              {robotsText || '(empty)'}
            </pre>
          )}
          {lint && (
            <div className="mt-4">
              <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                Issues found <span className="text-ink">{lint.issues.length}</span>
              </h3>
              {lint.clean ? (
                <p className="mt-2 text-[13px] text-opportunity">No issues — the file is already clean.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1.5">
                  {lint.issues.map((iss, i) => (
                    <li key={i} className="border-l-2 border-critical pl-2.5 text-[12.5px] text-ink">{iss}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="border border-line bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">Suggested robots.txt</h2>
            {lint && !lint.clean && (
              <div className="flex gap-2">
                <CopyBtn text={lint.optimized} />
                <DownloadBtn text={lint.optimized} name="robots.txt" />
              </div>
            )}
          </div>
          {lint ? (
            <>
              <pre className="scroll-x mt-4 border border-line bg-ground p-3 font-mono text-[11.5px] leading-relaxed text-ink">
                {lint.optimized}
              </pre>
              {lint.changed.length > 0 && (
                <div className="mt-4">
                  <h3 className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted">What changed</h3>
                  <ul className="mt-2 flex flex-col gap-1">
                    {lint.changed.map((c, i) => (
                      <li key={i} className="text-[12.5px] text-opportunity">✓ {c}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <p className="mt-4 text-[13px] text-muted">No robots.txt to optimize.</p>
          )}
        </div>
      </section>

      {/* ---- sitemaps ---- */}
      <section>
        <h2 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
          XML sitemaps
        </h2>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="border border-line bg-surface px-4 py-3">
            <div className="tnum text-[22px] font-normal leading-none">{sitemaps.length}</div>
            <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">Sitemaps</div>
          </div>
          <div className="border border-line bg-surface px-4 py-3">
            <div className="tnum text-[22px] font-normal leading-none">{totalUrls.toLocaleString()}</div>
            <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">URLs listed</div>
          </div>
          <div className="border border-line bg-surface px-4 py-3">
            <div className="tnum text-[22px] font-normal leading-none" style={{ color: withErrors.length ? 'rgb(var(--critical))' : undefined }}>{withErrors.length}</div>
            <div className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted">Format errors</div>
          </div>
        </div>

        {sitemaps.length === 0 ? (
          <p className="text-[13px] text-muted">No sitemaps were discovered during the crawl.</p>
        ) : (
          <div className="scroll-x">
            <table className="w-full min-w-[560px] border-collapse font-mono text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10px] uppercase tracking-[0.1em] text-muted">
                  <th className="pb-2 pr-4">Sitemap</th>
                  <th className="pb-2 pr-4 text-right">URLs</th>
                  <th className="pb-2">Status</th>
                </tr>
              </thead>
              <tbody className="tnum">
                {sitemaps.map((m) => (
                  <tr key={m.url} className="border-b border-line/60">
                    <td className="max-w-[380px] truncate py-2 pr-4">
                      <a href={m.url} target="_blank" rel="noreferrer" className="text-ink hover:text-accent">{m.url}</a>
                    </td>
                    <td className="py-2 pr-4 text-right text-muted">{m.entryCount}</td>
                    <td className="py-2">
                      {m.formatError
                        ? <span className="text-critical">{m.formatError}</span>
                        : <span className="text-opportunity">ok</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
