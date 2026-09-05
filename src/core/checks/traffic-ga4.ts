/**
 * GA4 cross-validation checks.
 *
 * These are the checks that justify pulling analytics into an SEO tool at all:
 * each one is a technical fact that only becomes actionable once you know how
 * many real people hit the page.
 *
 * Kept separate from traffic.ts because these depend on GA4 while those depend
 * on Search Console, and a site can plausibly have one and not the other.
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck } from './types.ts';
import { normalizeUrl, type PageData } from '../extract.ts';
import { pathOfUrl } from '../ga4/client.ts';
import type { SiteData } from './types.ts';

const n = (v: number) => Math.round(v).toLocaleString();

/** GA4 metrics for one page, matched by normalised path. */
function ga4(p: PageData, site: SiteData) {
  return site.ga4?.byPath.get(pathOfUrl(p.finalUrl)) ?? null;
}

const withGa4 = (p: PageData, site: SiteData): boolean =>
  !!site.ga4 && !site.ga4.error && p.isHtml;

/**
 * Session count marking the top decile of pages GA4 knows about.
 *
 * Relative rather than absolute: "high traffic" on a site with 200 monthly
 * sessions is a different number from one with 200,000, and a fixed threshold
 * would either never fire or fire on everything.
 */
function topDecileSessions(site: SiteData): number {
  if (!site.ga4) return Infinity;
  const values = [...site.ga4.byPath.values()]
    .map((m) => m.sessions)
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  if (values.length === 0) return Infinity;
  const idx = Math.max(0, Math.ceil(values.length * 0.1) - 1);
  return values[idx] ?? Infinity;
}

export const GA4_CHECKS: PageCheck[] = [
  pageCheck({
    id: 'traffic.ga4.tracking-tag-detected',
    title: 'Page receives GA4 traffic but has no tracking tag in its HTML',
    category: 'search-traffic',
    severity: 'critical',
    why:
      'GA4 reports sessions for this URL, yet no gtag.js or Google Tag Manager container appears in the server HTML. Either the tag is injected client-side after hydration — in which case any visitor who leaves early is never counted — or the data is being attributed to the wrong URL. Either way the numbers for this page are not trustworthy, and every decision made from them inherits the error.',
    fix:
      'Emit the Google tag server-side. In Next.js, put it in the root layout with next/script strategy="afterInteractive" rather than mounting it inside a client component that may never render for a bouncing visitor.',
    appliesTo: (p, site) => withGa4(p, site) && p.status === 200,
    test: (p, site) => {
      const m = ga4(p, site);
      if (!m || m.sessions < 1) return false;
      const hasTag = p.gtmCodes.length > 0
        || /gtag\s*\(|googletagmanager\.com|google-analytics\.com|G-[A-Z0-9]{8,}/i.test(p.html);
      return hasTag
        ? false
        : `${n(m.sessions)} session(s) recorded but no gtag.js or GTM container in the server HTML`;
    },
  }),

  pageCheck({
    id: 'traffic.ga4.high-traffic-with-blocker',
    title: 'High-traffic page carries a blocking defect',
    category: 'search-traffic',
    severity: 'blocker',
    why:
      'This URL is in the top 10% of the site by sessions and also carries a blocker-severity defect — something that makes the page ineligible to rank or unable to render. The combination is the highest-priority item any audit can produce: real traffic is arriving at a page that is fundamentally broken.',
    fix:
      'Fix the blocking defects listed in the detail before anything else in this report. Everything else is optimisation; this is triage.',
    appliesTo: (p, site) => withGa4(p, site),
    test: (p, site) => {
      const m = ga4(p, site);
      if (!m) return false;
      const threshold = topDecileSessions(site);
      // A floor as well as a percentile: the top decile of a site with three
      // visitors is not "high traffic".
      if (m.sessions < threshold || m.sessions < 10) return false;

      // Blocking conditions are re-derived here rather than read from other
      // checks' results, which do not exist yet while checks are running.
      const blockers: string[] = [];
      if (p.status >= 400) blockers.push(`HTTP ${p.status}`);
      if (p.timedOut) blockers.push('request timed out');
      if (p.renderedWithJs && p.textLength < 200) blockers.push('DOM never mounted');
      if (!p.renderedWithJs && p.isClientRenderedShell) blockers.push('content requires hydration');
      if (p.isHtml && p.status === 200 && p.tag.title === 0) blockers.push('no title tag');

      return blockers.length
        ? `${n(m.sessions)} sessions (top 10% of site) with: ${blockers.join(', ')}`
        : false;
    },
  }),

  pageCheck({
    id: 'traffic.ga4.high-bounce-rate',
    title: 'High bounce rate on a slow page',
    category: 'search-traffic',
    severity: 'opportunity',
    why:
      'Bounce rate above 75% on a page that is also slow. Bounce rate alone is a weak signal — a page that answers the question completely earns a high bounce legitimately — which is why this only fires when paired with a slow first byte or a failing LCP. That combination usually means visitors are leaving before the content arrives.',
    fix:
      'Address the page-speed findings for this URL. Cache the response if it is dynamic without needing to be, and give the LCP image priority.',
    appliesTo: (p, site) => withGa4(p, site) && p.status === 200,
    test: (p, site) => {
      const m = ga4(p, site);
      // Below ~20 sessions a bounce rate is noise, not a measurement.
      if (!m || m.sessions < 20) return false;
      if (m.bounceRate <= 0.75) return false;

      const slowTtfb = p.ttfbMs > 800;
      const poorLcp = (site.pagespeed ?? []).some(
        (d) => d.strategy === 'mobile'
          && normalizeUrl(d.url) === normalizeUrl(p.finalUrl)
          && d.metrics.lcp.score !== 'GOOD',
      );
      if (!slowTtfb && !poorLcp) return false;

      const cause = poorLcp ? 'a failing LCP' : `${p.ttfbMs}ms TTFB`;
      return `${(m.bounceRate * 100).toFixed(0)}% bounce over ${n(m.sessions)} sessions, with ${cause}`;
    },
  }),

  pageCheck({
    id: 'traffic.ga4.orphaned-with-traffic',
    title: 'Page receives sessions but has no internal links',
    category: 'search-traffic',
    severity: 'warning',
    why:
      'Real visitors are reaching this page while nothing on the site links to it. It is performing despite the site structure rather than because of it: crawlers following links never find it, and it receives no internal link equity at all.',
    fix:
      'Link to it from relevant pages and from the nearest hub or category page. A page with proven traffic and no internal links is usually the cheapest win in an audit.',
    appliesTo: (p, site) => withGa4(p, site) && p.status === 200,
    test: (p, site) => {
      const m = ga4(p, site);
      if (!m || m.sessions < 1) return false;
      return site.orphans.has(normalizeUrl(p.finalUrl))
        ? `${n(m.sessions)} session(s), ${n(m.users)} user(s), zero internal links`
        : false;
    },
  }),

  pageCheck({
    id: 'traffic.ga4.converting-page-with-defects',
    title: 'Converting page carries technical defects',
    category: 'search-traffic',
    severity: 'critical',
    why:
      'GA4 records conversions on this URL. Whatever else the report says, defects here cost money directly rather than hypothetically — this is the page where a slow load or a broken canonical has a measurable revenue consequence.',
    fix:
      'Treat every finding on this URL as higher priority than the same finding elsewhere. The scoring model already weights it more heavily; this check makes that visible.',
    appliesTo: (p, site) => withGa4(p, site) && p.status === 200,
    test: (p, site) => {
      const m = ga4(p, site);
      if (!m || m.conversions < 1) return false;

      const defects: string[] = [];
      if (!p.title || !p.title.trim()) defects.push('no title');
      if (p.tag.h1 === 0) defects.push('no H1');
      if (!p.canonical) defects.push('no canonical');
      if (!p.description) defects.push('no meta description');
      if (p.ttfbMs > 800) defects.push(`${p.ttfbMs}ms TTFB`);

      return defects.length
        ? `${n(m.conversions)} conversion(s) from ${n(m.sessions)} sessions, with: ${defects.join(', ')}`
        : false;
    },
  }),
];

/**
 * Site-level: analytics knows about pages the crawl never reached.
 *
 * Surfaced by the test fixture rather than designed up front — a page can carry
 * real traffic and be entirely absent from the crawl, which the per-page checks
 * structurally cannot report because no PageData exists for it. That absence is
 * itself the finding: the URL is unreachable by following links from the start
 * URL and missing from every sitemap.
 */

export const GA4_SITE_CHECKS: SiteCheck[] = [
  siteCheck({
    id: 'traffic.uncrawlable-urls-with-traffic',
    title: 'Analytics reports traffic for URLs the crawl never found',
    category: 'search-traffic',
    severity: 'critical',
    why:
      'These paths receive real sessions or impressions, yet the crawler could not reach them by following links from the start URL and they appear in no sitemap. Whatever is sending visitors, the site itself is not — so search engines that discover pages by crawling will not find them either.',
    fix:
      'Link to them from relevant pages and add them to the sitemap. If they are genuinely retired, redirect them so their traffic is not simply lost.',
    test: (site) => {
      if (!site.ga4 && !site.gsc) return false;

      const crawled = new Set<string>();
      for (const p of site.pages) {
        if (!p.isHtml) continue;
        try { crawled.add(new URL(p.finalUrl).pathname.replace(/\/$/, '').toLowerCase() || '/'); }
        catch { /* skip unparseable */ }
      }

      const missing: Array<{ path: string; detail: string }> = [];

      for (const [path, m] of site.ga4?.byPath ?? []) {
        if (m.sessions < 5 || crawled.has(path)) continue;
        missing.push({ path, detail: `${Math.round(m.sessions)} sessions` });
      }
      for (const [url, m] of site.gsc?.byUrl ?? []) {
        if (m.impressions < 10) continue;
        let path: string;
        try { path = new URL(url).pathname.replace(/\/$/, '').toLowerCase() || '/'; } catch { continue; }
        if (crawled.has(path) || missing.some((x) => x.path === path)) continue;
        missing.push({ path, detail: `${m.impressions} impressions` });
      }

      if (missing.length === 0) return false;
      const shown = missing.slice(0, 4).map((x) => `${x.path} (${x.detail})`).join(', ');
      return missing.length + ' uncrawlable URL(s) with traffic: ' + shown
        + (missing.length > 4 ? `, +${missing.length - 4} more` : '');
    },
  }),
];
