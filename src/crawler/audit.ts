/**
 * Audit orchestration: crawl -> run every check -> score -> persist.
 *
 * The report shape produced here is exactly what the dashboard renders, so the
 * UI never needs to re-derive anything from raw page data.
 */
import { crawl, type CrawlOptions, type ProgressFn } from './crawl.ts';
import { runAllChecks, summarizeByCategory, issuesByPage, checkStats } from '../core/checks/registry.ts';
import { scoreSite, type PageInput, type PageIssue } from '../core/scoring/model.ts';
import { normalizeUrl } from '../core/extract.ts';
import type { CheckOutcome } from '../core/checks/types.ts';
import type { CategorySummary } from '../core/checks/registry.ts';
import type { Severity } from '../core/scoring/model.ts';
import type { CoreWebVitalsData } from '../core/pagespeed/types.ts';
import { fetchPageMetrics } from '../core/gsc/client.ts';
import { gscConfigured } from '../core/gsc/auth.ts';
import { fetchGa4Metrics, ga4Configured, pathOfUrl } from '../core/ga4/client.ts';

export interface PageSummary {
  url: string;
  status: number;
  title: string | null;
  h1: string | null;
  description: string | null;
  wordCount: number;
  bytes: number;
  ttfbMs: number;
  depth: number;
  indexable: boolean;
  inSitemap: boolean;
  score: number;
  issueCount: number;
  pageRank: number;
  isHtml: boolean;
  /** distinct internal pages linking here; 0 = orphan (invisible to link-following crawlers) */
  inDegree: number;
  /** at least one rel=alternate hreflang annotation is present */
  hasHreflang: boolean;
  // Next.js facts, null on non-Next sites
  router: string | null;
  strategy: string | null;
  buildId: string | null;
  /** mobile CWV for the sampled URLs; null for pages PSI did not measure */
  cwv: { lcpMs: number; lcpScore: string; cls: number; clsScore: string; perf: number } | null;
  renderedWithJs: boolean;
  jsErrors: number;
  /** body text in the server response, vs wordCount which is post-render */
  serverTextLength: number;
  /** Search Console, over the report's date range */
  impressions: number;
  clicks: number;
  ctr: number;
  avgPosition: number;
  /** GA4, over the report's date range */
  sessions: number;
  pageviews: number;
  users: number;
  conversions: number;
  bounceRate: number;
}

export interface AuditReport {
  id: string;
  startUrl: string;
  origin: string;
  createdAt: string;
  durationMs: number;
  options: CrawlOptions;

  score: number;
  rubricVersion: string;
  meanPageScore: number;

  counts: {
    crawled: number;
    htmlPages: number;
    indexable: number;
    nonIndexable: number;
    blocked: number;
    assets: number;
    orphans: number;
    checksTotal: number;
    checksRun: number;
    checksFailed: number;
    checksPassed: number;
    checksSkipped: number;
  };

  severity: Record<Severity, number>;

  isNext: boolean;
  nextSummary: {
    router: string;
    buildIds: string[];
    strategies: Record<string, number>;
  } | null;

  categories: CategorySummary[];
  outcomes: CheckOutcome[];
  pages: PageSummary[];
  /** normalized URL -> failing check ids, for the page detail view */
  pageIssues: Record<string, string[]>;

  /** internal followed-link graph, edges as [fromIndex, toIndex] into `pages` */
  graph: { edges: Array<[number, number]> };

  robots: { found: boolean; sitemaps: string[] };
  sitemaps: Array<{ url: string; entryCount: number; formatError: string | null }>;

  /** Search Console and GA4 for the reporting window. */
  traffic: {
    gsc: {
      connected: boolean;
      error: string | null;
      property: string;
      startDate: string;
      endDate: string;
      totalClicks: number;
      totalImpressions: number;
      urlsWithData: number;
      fromCache: boolean;
    } | null;
    ga4: {
      connected: boolean;
      error: string | null;
      propertyId: string;
      startDate: string;
      endDate: string;
      totalSessions: number;
      totalUsers: number;
      totalPageviews: number;
      totalConversions: number;
      pathsWithData: number;
      fromCache: boolean;
    } | null;
  };

  /** JavaScript rendering: whether it ran, and what it found. */
  render: {
    enabled: boolean;
    renderedPages: number;
    failures: Array<{ url: string; error: string }>;
    /** raw-path pages that looked like client-rendered shells */
    spaShellsDetected: number;
    /** total console errors and uncaught exceptions across rendered pages */
    consoleErrors: number;
  };

  /** Core Web Vitals for the sampled URLs, plus why any request failed. */
  pagespeed: {
    attempted: boolean;
    usedApiKey: boolean;
    results: CoreWebVitalsData[];
    errors: Array<{ url: string; strategy: string; error: string }>;
  };
}

export interface AuditHooks {
  /**
   * Receives the raw HTML of every crawled page once, before it is discarded.
   *
   * A hook rather than a return value: the HTML is megabytes per crawl, and
   * anything that ends up on the AuditReport ends up in the dashboard payload.
   * Callers that want snapshots opt in explicitly.
   */
  onSnapshots?: (snapshots: Array<{ url: string; html: string; rendered: boolean }>) => void | Promise<void>;
}

export async function runAudit(
  options: Partial<CrawlOptions> & { startUrl: string },
  onProgress: ProgressFn = () => {},
  hooks: AuditHooks = {},
): Promise<AuditReport> {
  const { site, options: used, durationMs } = await crawl(options, onProgress);

  onProgress({
    phase: 'checking', crawled: site.pages.length, queued: 0, total: site.pages.length,
    currentUrl: null, message: 'Running ' + checkStats().total + ' checks',
  });

  // ---- traffic data ------------------------------------------------------
  // Fetched after the crawl and before checks run: the search-traffic pack
  // needs it, and the scoring model weights pages by it. Both sources fail
  // soft — an unavailable API degrades the report, never aborts it.
  if (gscConfigured()) {
    onProgress({
      phase: 'checking', crawled: site.pages.length, queued: 0, total: site.pages.length,
      currentUrl: null, message: 'Fetching Search Console data',
    });
    site.gsc = await fetchPageMetrics();
    site.hasSearchConsole = !site.gsc.error;
  }

  if (ga4Configured()) {
    onProgress({
      phase: 'checking', crawled: site.pages.length, queued: 0, total: site.pages.length,
      currentUrl: null, message: 'Fetching Google Analytics data',
    });
    site.ga4 = await fetchGa4Metrics();
    site.hasGa4 = !site.ga4.error;
  }

  if (hooks.onSnapshots) {
    await hooks.onSnapshots(
      site.pages
        .filter((p) => p.isHtml && p.html && p.depth < 99)
        .map((p) => ({ url: p.finalUrl, html: p.html, rendered: p.renderedWithJs })),
    );
  }

  const outcomes = runAllChecks(site);
  const perPage = issuesByPage(outcomes);

  // ---- scoring -----------------------------------------------------------
  const htmlPages = site.pages.filter((p) => p.isHtml && p.depth < 99);

  const scoreInput: PageInput[] = htmlPages.map((p) => {
    const key = normalizeUrl(p.finalUrl);
    const issues: PageIssue[] = (perPage.get(key) ?? []).map((o) => ({
      checkId: o.id,
      severity: o.severity,
    }));
    return {
      url: p.finalUrl,
      issues,
      pageRank: site.pageRank.get(key) ?? 0,
      impressions: site.gsc?.byUrl.get(key)?.impressions ?? 0,
      sessions: site.ga4?.byPath.get(pathOfUrl(p.finalUrl))?.sessions ?? 0,
    };
  });

  const siteIssues = outcomes
    .filter((o) => o.status === 'failed' && o.scope === 'site')
    .map((o) => ({ checkId: o.id, severity: o.severity }));

  const scored = scoreSite(scoreInput, siteIssues);
  const scoreByUrl = new Map(scored.pages.map((p) => [normalizeUrl(p.url), p.score]));

  // ---- severity rollup ---------------------------------------------------
  const severity: Record<Severity, number> = {
    blocker: 0, critical: 0, warning: 0, opportunity: 0, notice: 0,
  };
  for (const o of outcomes) if (o.status === 'failed') severity[o.severity]++;

  // ---- Core Web Vitals lookup, mobile only (the indexing default) --------
  const gscFor = (key: string) => site.gsc?.byUrl.get(key);
  const ga4For = (url: string) => site.ga4?.byPath.get(pathOfUrl(url));

  const cwvByUrl = new Map<string, NonNullable<PageSummary['cwv']>>();
  for (const d of site.pagespeed) {
    if (d.strategy !== 'mobile') continue;
    cwvByUrl.set(normalizeUrl(d.url), {
      lcpMs: Math.round(d.metrics.lcp.valueMs),
      lcpScore: d.metrics.lcp.score,
      cls: Number(d.metrics.cls.value.toFixed(3)),
      clsScore: d.metrics.cls.score,
      perf: d.performanceScore,
    });
  }

  // ---- page summaries ----------------------------------------------------
  const pages: PageSummary[] = htmlPages.map((p) => {
    const key = normalizeUrl(p.finalUrl);
    const noindex = p.metaRobots.some((r) => r.includes('noindex'))
      || (p.xRobotsTag ?? '').includes('noindex');
    return {
      url: p.finalUrl,
      status: p.status,
      title: p.title,
      h1: p.h1s[0] ?? null,
      description: p.description,
      wordCount: p.wordCount,
      bytes: p.bytes,
      ttfbMs: p.ttfbMs,
      depth: p.depth,
      indexable: p.status === 200 && !noindex && !p.disallowedByRobots,
      inSitemap: p.inSitemap,
      score: scoreByUrl.get(key) ?? 100,
      issueCount: (perPage.get(key) ?? []).length,
      pageRank: site.pageRank.get(key) ?? 0,
      isHtml: p.isHtml,
      inDegree: new Set((site.inbound.get(key) ?? []).map((l) => normalizeUrl(l.fromUrl))).size,
      hasHreflang: p.hreflang.length > 0,
      router: p.next.isNext ? p.next.router : null,
      strategy: p.next.isNext ? p.next.strategy : null,
      buildId: p.next.buildId,
      cwv: cwvByUrl.get(key) ?? null,
      renderedWithJs: p.renderedWithJs,
      jsErrors: p.jsConsoleErrors.length,
      serverTextLength: p.serverTextLength,
      impressions: gscFor(key)?.impressions ?? 0,
      clicks: gscFor(key)?.clicks ?? 0,
      ctr: gscFor(key)?.ctr ?? 0,
      avgPosition: gscFor(key)?.position ?? 0,
      sessions: ga4For(p.finalUrl)?.sessions ?? 0,
      pageviews: ga4For(p.finalUrl)?.pageviews ?? 0,
      users: ga4For(p.finalUrl)?.users ?? 0,
      conversions: ga4For(p.finalUrl)?.conversions ?? 0,
      bounceRate: ga4For(p.finalUrl)?.bounceRate ?? 0,
    };
  }).sort((a, b) => a.score - b.score);

  // ---- Next.js rollup ----------------------------------------------------
  const nextPages = htmlPages.filter((p) => p.next.isNext && p.status === 200);
  const isNext = nextPages.length > 0;
  const strategies: Record<string, number> = {};
  for (const p of nextPages) strategies[p.next.strategy] = (strategies[p.next.strategy] ?? 0) + 1;

  const routerCounts = new Map<string, number>();
  for (const p of nextPages) routerCounts.set(p.next.router, (routerCounts.get(p.next.router) ?? 0) + 1);
  const dominantRouter = [...routerCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'unknown';

  const pageIssues: Record<string, string[]> = {};
  for (const [url, list] of perPage) pageIssues[url] = list.map((o) => o.id);

  // ---- serialize the link graph, indexed into the (sorted) pages array ----
  const pageIndex = new Map(pages.map((p, i) => [normalizeUrl(p.url), i]));
  const seenEdge = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const [toKey, links] of site.inbound) {
    const to = pageIndex.get(toKey);
    if (to === undefined) continue;
    for (const link of links) {
      const from = pageIndex.get(normalizeUrl(link.fromUrl));
      if (from === undefined || from === to) continue;
      const tag = from + '>' + to;
      if (seenEdge.has(tag)) continue;
      seenEdge.add(tag);
      edges.push([from, to]);
    }
  }

  const countableUrls = new Set(htmlPages.map((p) => normalizeUrl(p.finalUrl)));
  const assets = site.pages.filter((p) => p.depth === 99).length;
  const failed = outcomes.filter((o) => o.status === 'failed');

  return {
    id: crypto.randomUUID(),
    startUrl: site.startUrl,
    origin: site.origin,
    createdAt: new Date().toISOString(),
    durationMs,
    options: used,

    score: Math.round(scored.score * 10) / 10,
    rubricVersion: scored.rubricVersion,
    meanPageScore: Math.round(scored.meanPageScore * 10) / 10,

    counts: {
      crawled: site.pages.length,
      htmlPages: htmlPages.length,
      indexable: pages.filter((p) => p.indexable).length,
      nonIndexable: pages.filter((p) => !p.indexable).length,
      blocked: site.pages.filter((p) => p.disallowedByRobots).length,
      assets,
      orphans: site.orphans.size,
      checksTotal: checkStats().total,
      checksRun: outcomes.filter((o) => o.status !== 'skipped').length,
      checksFailed: failed.length,
      checksPassed: outcomes.filter((o) => o.status === 'passed').length,
      checksSkipped: outcomes.filter((o) => o.status === 'skipped').length,
    },

    severity,
    isNext,
    nextSummary: isNext ? { router: dominantRouter, buildIds: [...new Set(nextPages.map((p) => p.next.buildId).filter((b): b is string => !!b))], strategies } : null,

    categories: summarizeByCategory(outcomes, htmlPages.length, countableUrls),
    outcomes,
    pages,
    pageIssues,
    graph: { edges },

    traffic: {
      gsc: site.gsc ? {
        connected: !site.gsc.error,
        error: site.gsc.error,
        property: site.gsc.property,
        startDate: site.gsc.startDate,
        endDate: site.gsc.endDate,
        totalClicks: site.gsc.totalClicks,
        totalImpressions: site.gsc.totalImpressions,
        urlsWithData: site.gsc.byUrl.size,
        fromCache: site.gsc.fromCache,
      } : null,
      ga4: site.ga4 ? {
        connected: !site.ga4.error,
        error: site.ga4.error,
        propertyId: site.ga4.propertyId,
        startDate: site.ga4.startDate,
        endDate: site.ga4.endDate,
        totalSessions: site.ga4.totalSessions,
        totalUsers: site.ga4.totalUsers,
        totalPageviews: site.ga4.totalPageviews,
        totalConversions: site.ga4.totalConversions,
        pathsWithData: site.ga4.byPath.size,
        fromCache: site.ga4.fromCache,
      } : null,
    },

    render: {
      enabled: site.renderJs,
      renderedPages: htmlPages.filter((p) => p.renderedWithJs).length,
      failures: site.renderFailures,
      spaShellsDetected: htmlPages.filter((p) => p.isClientRenderedShell).length,
      consoleErrors: htmlPages.reduce((n, p) => n + p.jsConsoleErrors.length, 0),
    },

    pagespeed: {
      attempted: site.pagespeedAttempted,
      usedApiKey: !!process.env['PAGESPEED_API_KEY']?.trim(),
      results: site.pagespeed,
      errors: site.pagespeedErrors,
    },

    robots: { found: site.robots.found, sitemaps: site.robots.sitemaps },
    sitemaps: site.sitemaps.map((s) => ({ url: s.url, entryCount: s.entryCount, formatError: s.formatError })),
  };
}
