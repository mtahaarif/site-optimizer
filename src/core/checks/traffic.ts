/**
 * Search Traffic checks.
 *
 * These were stubs returning `false` until Search Console was wired up — the
 * category existed for parity but could never fire. They are real now.
 *
 * What makes this category worth having is that it is the only one that
 * combines a technical fact with a business one. "This page is noindexed" is a
 * finding; "this page is noindexed and earned 4,100 impressions last month" is
 * a decision. Every check here is that second shape.
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck } from './types.ts';
import { GA4_CHECKS, GA4_SITE_CHECKS } from './traffic-ga4.ts';
import { normalizeUrl, type PageData } from '../extract.ts';
import type { SiteData } from './types.ts';

/** Metrics for one page, or zeros when Search Console has no row for it. */
function metrics(p: PageData, site: SiteData): { clicks: number; impressions: number; position: number } {
  const m = site.gsc?.byUrl.get(normalizeUrl(p.finalUrl));
  return {
    clicks: m?.clicks ?? 0,
    impressions: m?.impressions ?? 0,
    position: m?.position ?? 0,
  };
}

/** Only pages Search Console actually returned data for are in scope. */
const withGsc = (p: PageData, site: SiteData): boolean =>
  !!site.gsc && p.isHtml && site.gsc.byUrl.has(normalizeUrl(p.finalUrl));

/** Any crawled HTML page, whether Search Console knows about it or not. */
const anyHtml = (p: PageData, site: SiteData): boolean => !!site.gsc && p.isHtml;

const isNoindex = (p: PageData): boolean =>
  p.metaRobots.some((r) => r.includes('noindex')) || (p.xRobotsTag ?? '').includes('noindex');

const isCanonicalisedAway = (p: PageData): boolean =>
  !!p.canonical && normalizeUrl(p.canonical) !== normalizeUrl(p.finalUrl);

const n = (v: number) => v.toLocaleString();

// ---------------------------------------------------------------------------

const trafficChecks: PageCheck[] = [
  pageCheck({
    id: 'page-zero-impressions',
    title: 'Page has 0 impressions',
    category: 'search-traffic', severity: 'notice', requires: 'search-console',
    why: 'An indexable page that has never been shown in search results is not competing for any query. Either nothing is searching for what it covers, or it is not being indexed at all.',
    fix: 'Check the page is indexed in Search Console. If it is, the content likely does not match any real query — consolidate it into a stronger page rather than leaving it as thin inventory.',
    appliesTo: (p, site) => anyHtml(p, site) && p.status === 200 && !isNoindex(p) && !p.disallowedByRobots,
    test: (p, site) => metrics(p, site).impressions === 0,
  }),

  pageCheck({
    id: 'page-has-clicks',
    title: 'Page earns organic clicks',
    category: 'search-traffic', severity: 'notice', requires: 'search-console',
    why: 'Pages that already convert search demand into visits. Informational rather than a defect — it carries no score penalty — but these are the URLs to protect during any change, and they are what the scoring model weights most heavily.',
    fix: 'No action needed. Treat any finding on these URLs elsewhere in the report as higher priority than the same finding on a page with no traffic.',
    appliesTo: withGsc,
    test: (p, site) => {
      const m = metrics(p, site);
      return m.clicks > 0
        ? `${n(m.clicks)} click(s), ${n(m.impressions)} impressions, avg position ${m.position.toFixed(1)}`
        : false;
    },
  }),

  pageCheck({
    id: 'non-indexable-with-impressions',
    title: 'Non-indexable page that has at least 1 impression',
    category: 'search-traffic', severity: 'critical', requires: 'search-console',
    why: 'The page is excluded from indexing yet Search Console still records impressions for it. That is traffic actively being lost — demand exists and the page is being suppressed.',
    fix: 'Remove the noindex directive if the page should rank. If exclusion is deliberate, redirect the URL to the page that should be earning those impressions instead.',
    appliesTo: withGsc,
    test: (p, site) => {
      const m = metrics(p, site);
      if (m.impressions < 1) return false;
      if (!isNoindex(p) && p.status === 200) return false;
      const reason = isNoindex(p) ? 'noindex' : `HTTP ${p.status}`;
      return `${reason} but ${n(m.impressions)} impression(s), ${n(m.clicks)} click(s)`;
    },
  }),

  pageCheck({
    id: 'blocked-with-impressions',
    title: 'Page is blocked by robots.txt and has at least 1 impression',
    category: 'search-traffic', severity: 'critical', requires: 'search-console',
    why: 'Google is showing a URL it is not allowed to crawl. The result has no snippet and no title Google can trust, so it converts far below its position — and you cannot fix the listing without unblocking it.',
    fix: 'Remove the Disallow rule. To keep the page out of the index while still controlling its listing, allow crawling and use a noindex directive instead.',
    appliesTo: withGsc,
    test: (p, site) => {
      const m = metrics(p, site);
      return p.disallowedByRobots && m.impressions >= 1
        ? `blocked in robots.txt but ${n(m.impressions)} impression(s)` : false;
    },
  }),

  pageCheck({
    id: '4xx-with-clicks',
    title: '4xx pages that have at least 1 click',
    category: 'search-traffic', severity: 'blocker', requires: 'search-console',
    why: 'Users are clicking through from search results to a page that does not exist. This is live, measurable lost traffic — every click is a visitor who bounced immediately.',
    fix: 'Restore the page, or 301 it to the closest equivalent. Redirecting preserves both the ranking and the clicks; deleting the listing loses them.',
    appliesTo: (p, site) => !!site.gsc && p.isHtml,
    test: (p, site) => {
      const m = metrics(p, site);
      return p.status >= 400 && p.status < 500 && m.clicks >= 1
        ? `HTTP ${p.status} but ${n(m.clicks)} click(s) and ${n(m.impressions)} impressions` : false;
    },
  }),

  pageCheck({
    id: '3xx-with-clicks',
    title: '3xx pages that have at least 1 click',
    category: 'search-traffic', severity: 'warning', requires: 'search-console',
    why: 'Search results still point at a redirecting URL, so every visitor from search pays an extra round trip before reaching the content.',
    fix: 'Update the sitemap and internal links to the destination URL so Google reindexes the final address.',
    appliesTo: (p, site) => !!site.gsc && p.isHtml,
    test: (p, site) => {
      const m = metrics(p, site);
      return p.status >= 300 && p.status < 400 && m.clicks >= 1
        ? `HTTP ${p.status} but ${n(m.clicks)} click(s)` : false;
    },
  }),

  pageCheck({
    id: 'canonicalized-with-clicks',
    title: 'Canonicalized pages that have at least 1 click',
    category: 'search-traffic', severity: 'warning', requires: 'search-console',
    why: 'The page canonicalises elsewhere yet still earns clicks, which means Google is ranking it despite being told not to. Proven demand is being pointed at a different URL.',
    fix: 'Reconsider the canonical. If this page outperforms its target, it should be the canonical one.',
    appliesTo: withGsc,
    test: (p, site) => {
      const m = metrics(p, site);
      return isCanonicalisedAway(p) && m.clicks >= 1
        ? `canonical -> ${p.canonical} but ${n(m.clicks)} click(s) here` : false;
    },
  }),

  pageCheck({
    id: 'not-in-sitemap-with-impressions',
    title: 'Page is not submitted to sitemap and has at least 1 impression',
    category: 'search-traffic', severity: 'warning', requires: 'search-console',
    why: 'A page performing in search that is missing from the sitemap is not being explicitly prioritised for crawling, so updates to it are discovered more slowly.',
    fix: 'Add it to the sitemap. In Next.js App Router, generate app/sitemap.ts from the same source as your routes so this cannot drift.',
    appliesTo: (p, site) => withGsc(p, site) && p.status === 200 && !isNoindex(p),
    test: (p, site) => {
      const m = metrics(p, site);
      return !p.inSitemap && m.impressions >= 1
        ? `${n(m.impressions)} impression(s) but absent from every sitemap` : false;
    },
  }),

  pageCheck({
    id: 'orphan-with-impressions',
    title: 'Orphan pages with impressions',
    category: 'search-traffic', severity: 'critical', requires: 'search-console',
    why: 'The page earns impressions with no internal links pointing at it — it is performing despite the site structure rather than because of it. These are usually the fastest wins in an audit: adding links to a page with proven demand tends to move it immediately.',
    fix: 'Link to it from relevant pages and from the closest hub or category page.',
    appliesTo: withGsc,
    test: (p, site) => {
      const m = metrics(p, site);
      return site.orphans.has(normalizeUrl(p.finalUrl)) && m.impressions >= 1
        ? `${n(m.impressions)} impression(s), ${n(m.clicks)} click(s), no internal links` : false;
    },
  }),

  // ---- combining traffic with technical defects -------------------------
  pageCheck({
    id: 'high-impressions-missing-title',
    title: 'High-impression page with a missing or empty title',
    category: 'search-traffic', severity: 'critical', requires: 'search-console',
    why: 'Google is generating the search headline for a page that is already earning substantial impressions. The single highest-leverage fix available: the title is the largest influence on click-through rate at a fixed position.',
    fix: 'Write a title targeting the queries this page already ranks for — Search Console\'s query report for the URL tells you exactly what they are.',
    appliesTo: withGsc,
    test: (p, site) => {
      const m = metrics(p, site);
      if (m.impressions < 100) return false;
      if (p.title && p.title.trim()) return false;
      return `${n(m.impressions)} impressions with no title tag`;
    },
  }),

  pageCheck({
    id: 'high-impressions-low-ctr',
    title: 'High impressions with low click-through rate',
    category: 'search-traffic', severity: 'opportunity', requires: 'search-console',
    why: 'The page ranks well enough to be seen but rarely clicked. At an average position inside the first page, a click-through rate this far below expectation points at the snippet — title and description — rather than the ranking.',
    fix: 'Rewrite the title and meta description to match searcher intent. Add structured data where it earns a richer result.',
    appliesTo: withGsc,
    test: (p, site) => {
      const m = metrics(p, site);
      if (m.impressions < 200 || m.position > 10 || m.position === 0) return false;
      const ctr = m.clicks / m.impressions;
      // Roughly the floor of what a top-10 position normally returns.
      if (ctr >= 0.02) return false;
      return `${(ctr * 100).toFixed(2)}% CTR at average position ${m.position.toFixed(1)} `
        + `over ${n(m.impressions)} impressions`;
    },
  }),
];

const trafficSiteChecks: SiteCheck[] = [
  siteCheck({
    id: 'connect-gsc-ga',
    title: 'Connect Google Analytics and Search Console properties',
    category: 'search-traffic', severity: 'opportunity',
    why: 'Without Search Console, page importance weighting falls back to internal PageRank alone and this entire category cannot run. Connecting it is what turns a technical audit into a prioritised one.',
    fix: 'Create a Google Cloud service account, enable the Search Console API, add the service account email as a user on the property, then set GOOGLE_SERVICE_ACCOUNT_JSON and GSC_SITE_URL.',
    test: (site) => !site.hasSearchConsole,
  }),

  siteCheck({
    id: 'gsc-fetch-failed',
    title: 'Search Console data could not be fetched',
    category: 'search-traffic', severity: 'warning',
    why: 'Credentials are configured but the query failed, so traffic data is missing from this report and the search-traffic checks could not run.',
    fix: 'Check the error. The usual cause is the service account not being added as a user on the Search Console property, or GSC_SITE_URL not matching the property exactly (https://example.com/ versus sc-domain:example.com).',
    test: (site) => site.gsc?.error ?? false,
  }),

  siteCheck({
    id: 'ga4-not-connected',
    title: 'Connect Google Analytics 4',
    category: 'search-traffic', severity: 'opportunity',
    why: 'Without GA4, page importance weighting has no behavioural signal and the analytics cross-validation checks cannot run. Search Console shows who arrived from search; GA4 shows what they did next, and the two disagree often enough to be worth having both.',
    fix: 'Enable the Google Analytics Data API in Google Cloud, add the service account email as a Viewer on the GA4 property, then set GA4_PROPERTY_ID to the numeric property id.',
    test: (site) => !site.hasGa4,
  }),

  siteCheck({
    id: 'ga4-fetch-failed',
    title: 'GA4 data could not be fetched',
    category: 'search-traffic', severity: 'warning',
    why: 'A GA4 property is configured but the query failed, so engagement data is missing from this report.',
    fix: 'Check the error. The usual causes are the service account not being added as a Viewer on the property, or GA4_PROPERTY_ID holding a measurement id (G-XXXXXXX) rather than the numeric property id.',
    test: (site) => site.ga4?.error ?? false,
  }),

  siteCheck({
    id: 'track-keywords',
    title: 'Track keywords',
    category: 'search-traffic', severity: 'opportunity',
    why: 'Position tracking turns a technical audit into a measurement of whether fixes actually moved rankings.',
    fix: 'Add target keywords with scripts/ranks.ts --add.',
    test: () => true,
  }),
];

export const SEARCH_TRAFFIC_CHECKS = [
  ...trafficChecks, ...GA4_CHECKS, ...trafficSiteChecks, ...GA4_SITE_CHECKS,
];
