/**
 * Internal — 24 checks.
 * Status codes, URL hygiene and broken page resources.
 */
import { pageCheck, type PageCheck } from './types.ts';
import { normalizeUrl, type PageData } from '../extract.ts';

export const URL_LIMITS = { maxUrlLength: 115 };

const path = (p: PageData): string => {
  try { return new URL(p.finalUrl).pathname; } catch { return ''; }
};
const query = (p: PageData): URLSearchParams => {
  try { return new URL(p.finalUrl).searchParams; } catch { return new URLSearchParams(); }
};

const statusChecks: PageCheck[] = [
  pageCheck({
    id: '4xx-client-errors', title: '4xx client errors',
    category: 'internal', severity: 'blocker',
    why: 'The page does not exist. Any link equity pointing at it is discarded and users hit a dead end.',
    fix: 'Restore the page, or 301 the URL to the closest equivalent.',
    appliesTo: () => true,
    test: (p) => p.status >= 400 && p.status < 500 ? 'HTTP ' + p.status : false,
  }),
  pageCheck({
    id: '5xx-server-errors', title: '5xx server errors',
    category: 'internal', severity: 'blocker',
    why: 'The server failed to render the page. Sustained 5xx responses cause Google to slow crawling and eventually drop the URLs.',
    fix: 'Check server logs. On Next.js, a 500 usually means an unhandled exception in a Server Component or route handler.',
    appliesTo: () => true,
    test: (p) => p.status >= 500 ? 'HTTP ' + p.status : false,
  }),
  pageCheck({
    id: 'timed-out', title: 'Timed out',
    category: 'internal', severity: 'blocker',
    why: 'The server did not respond in time. Googlebot treats timeouts as availability failures and reduces crawl rate.',
    fix: 'Investigate slow database queries or uncached data fetches on this route.',
    appliesTo: () => true,
    test: (p) => p.timedOut,
  }),
  pageCheck({
    id: 'url-resolves-http-and-https', title: 'URL resolves under both HTTP and HTTPS',
    category: 'internal', severity: 'critical',
    why: 'The same content served on both protocols is a full duplicate of the site.',
    fix: 'Redirect HTTP to HTTPS at the server level.',
    appliesTo: (p) => p.isHtml && p.status === 200,
    test: (p, site) => {
      if (!p.finalUrl.startsWith('https://')) return false;
      const httpVariant = normalizeUrl(p.finalUrl.replace(/^https:/, 'http:'));
      const other = site.byUrl.get(httpVariant);
      return other?.status === 200;
    },
  }),
];

const urlHygieneChecks: PageCheck[] = [
  pageCheck({
    id: 'long-urls', title: 'Long URLs',
    category: 'internal', severity: 'notice',
    why: `URLs beyond ~${URL_LIMITS.maxUrlLength} characters are truncated in search results and are harder to share.`,
    fix: 'Shorten the path. Remove redundant category nesting and stop-words from slugs.',
    appliesTo: (p) => p.isHtml,
    test: (p) => p.finalUrl.length > URL_LIMITS.maxUrlLength ? p.finalUrl.length + ' chars' : false,
  }),
  pageCheck({
    id: 'url-uppercase', title: 'URL contains upper case characters',
    category: 'internal', severity: 'warning',
    why: 'URL paths are case-sensitive on most servers, so mixed case creates duplicate variants and inconsistent links.',
    fix: 'Use lowercase URLs and 301 mixed-case variants to them.',
    appliesTo: (p) => p.isHtml,
    test: (p) => /[A-Z]/.test(path(p)),
  }),
  pageCheck({
    id: 'url-non-ascii', title: 'URL contains non-ASCII characters',
    category: 'internal', severity: 'warning',
    why: 'Non-ASCII URLs get percent-encoded inconsistently across systems, producing multiple representations of one page.',
    fix: 'Use ASCII slugs, transliterating accented characters.',
    appliesTo: (p) => p.isHtml,
    test: (p) => {
      try { return /[^\x20-\x7E]/.test(decodeURIComponent(path(p))); } catch { return false; }
    },
  }),
  pageCheck({
    id: 'url-whitespace', title: 'Whitespace in URL',
    category: 'internal', severity: 'warning',
    why: 'Spaces in URLs must be encoded. Unencoded they break links in contexts that do not auto-encode.',
    fix: 'Replace spaces with hyphens in slugs.',
    appliesTo: (p) => p.isHtml,
    test: (p) => /%20|\s|\+/.test(path(p)),
  }),
  pageCheck({
    id: 'url-repetitive-elements', title: 'URL contains repetitive elements',
    category: 'internal', severity: 'notice',
    why: 'Repeated path segments such as /blog/blog/ usually indicate a routing misconfiguration and produce unnecessarily deep URLs.',
    fix: 'Fix the route definition producing the duplicated segment.',
    appliesTo: (p) => p.isHtml,
    test: (p) => {
      const segs = path(p).split('/').filter(Boolean);
      for (let i = 1; i < segs.length; i++) if (segs[i] === segs[i - 1]) return 'repeats "' + segs[i] + '"';
      return false;
    },
  }),
  pageCheck({
    id: 'url-underscores', title: 'Underscores instead of dashes in URL',
    category: 'internal', severity: 'notice',
    why: 'Google treats hyphens as word separators but underscores as joiners, so under_scored_slugs read as one token.',
    fix: 'Use hyphens in new URLs. Only rewrite existing ones if you can redirect properly.',
    appliesTo: (p) => p.isHtml,
    test: (p) => path(p).includes('_'),
  }),
  pageCheck({
    id: 'query-question-mark', title: 'Query string contains a question mark',
    category: 'internal', severity: 'notice',
    why: 'Parameterised URLs multiply crawlable variants of the same content.',
    fix: 'Prefer clean paths for indexable pages and canonicalise parameter variants.',
    appliesTo: (p) => p.isHtml,
    test: (p) => [...query(p).keys()].length > 0,
  }),
  pageCheck({
    id: 'query-repetitive-parameters', title: 'Query string contains repetitive parameters',
    category: 'internal', severity: 'warning',
    why: 'The same parameter appearing twice produces ambiguous behaviour and yet another duplicate URL.',
    fix: 'Deduplicate parameters when building links.',
    appliesTo: (p) => p.isHtml,
    test: (p) => {
      const keys = [...query(p).keys()];
      return keys.length !== new Set(keys).size;
    },
  }),
  pageCheck({
    id: 'query-sort-parameters', title: 'Query string contains sort parameters',
    category: 'internal', severity: 'notice',
    why: 'Sort orders produce many URLs with identical content in a different sequence, wasting crawl budget.',
    fix: 'Canonicalise sorted views to the default order.',
    appliesTo: (p) => p.isHtml,
    test: (p) => [...query(p).keys()].some((k) => /^(sort|order|orderby|sort_by|dir)$/i.test(k)),
  }),
  pageCheck({
    id: 'query-search-filter-parameters', title: 'Query string contains search or filter parameters',
    category: 'internal', severity: 'notice',
    why: 'Faceted filter combinations can generate effectively unlimited crawlable URLs.',
    fix: 'Block filter parameters in robots.txt or noindex the combinations, keeping a canonical unfiltered view.',
    appliesTo: (p) => p.isHtml,
    test: (p) => [...query(p).keys()].some((k) => /^(q|s|search|query|filter|f|color|size|brand)$/i.test(k)),
  }),
  pageCheck({
    id: 'query-paginated-parameters', title: 'Query string contains paginated parameters',
    category: 'internal', severity: 'notice',
    why: 'Paginated URLs are legitimate but need correct self-canonicals; canonicalising page 2 to page 1 hides its content.',
    fix: 'Give each paginated URL a self-referencing canonical.',
    appliesTo: (p) => p.isHtml,
    test: (p) => [...query(p).keys()].some((k) => /^(page|p|pg|offset|start)$/i.test(k)),
  }),
];

const resourceChecks: PageCheck[] = [
  pageCheck({
    id: 'page-broken-images', title: 'Page has broken images',
    category: 'internal', severity: 'warning',
    why: 'Images returning 4xx or 5xx render as broken placeholders and cost layout stability.',
    fix: 'Fix the image URL or restore the file.',
    test: (p, site) => {
      const bad = p.images.filter((i) => {
        const s = site.byUrl.get(normalizeUrl(i.src))?.status;
        return s !== undefined && s >= 400;
      });
      return bad.length ? bad.length + ' broken image(s)' : false;
    },
  }),
  pageCheck({
    id: 'page-broken-css', title: 'Page has broken CSS files',
    category: 'internal', severity: 'critical',
    why: 'A stylesheet that fails to load leaves the page unstyled, which also affects how Google assesses mobile-friendliness.',
    fix: 'Fix the stylesheet URL or restore the file.',
    test: (p, site) => {
      const bad = p.stylesheets.filter((s) => {
        const st = site.byUrl.get(normalizeUrl(s.url))?.status;
        return st !== undefined && st >= 400;
      });
      return bad.length ? bad.length + ' broken stylesheet(s)' : false;
    },
  }),
  pageCheck({
    id: 'page-broken-javascript', title: 'Page has broken JavaScript files',
    category: 'internal', severity: 'critical',
    why: 'A missing script breaks any functionality depending on it, and on client-rendered pages can leave the page blank.',
    fix: 'Fix the script URL or restore the file.',
    test: (p, site) => {
      const bad = p.scripts.filter((s) => {
        if (!s.url) return false;
        const st = site.byUrl.get(normalizeUrl(s.url))?.status;
        return st !== undefined && st >= 400;
      });
      return bad.length ? bad.length + ' broken script(s)' : false;
    },
  }),
  pageCheck({
    id: 'empty-src-attributes', title: 'Page has empty src attributes',
    category: 'internal', severity: 'warning',
    why: 'An empty src causes the browser to request the current page URL again, doubling requests and sometimes causing render loops.',
    fix: 'Remove the attribute or set a real URL. On lazy-loaded images use a data URI placeholder rather than an empty string.',
    test: (p) => p.emptySrcCount ? p.emptySrcCount + ' empty src attribute(s)' : false,
  }),
  pageCheck({
    id: 'invalid-content-type', title: 'Invalid MIME type',
    category: 'internal', severity: 'warning',
    why: 'A resource served with the wrong MIME type may be rejected by the browser — stylesheets and modules are strictly type-checked.',
    fix: 'Correct the Content-Type header for the resource.',
    appliesTo: (p) => p.status === 200,
    test: (p) => {
      if (!p.contentType) return 'no Content-Type header';
      if (/\.css($|\?)/i.test(p.finalUrl) && !p.contentType.includes('css')) return 'CSS served as ' + p.contentType;
      if (/\.js($|\?)/i.test(p.finalUrl) && !/javascript|ecmascript/.test(p.contentType)) return 'JS served as ' + p.contentType;
      return false;
    },
  }),
];

const gtmChecks: PageCheck[] = [
  pageCheck({
    id: 'no-gtm-code', title: 'URL contains no Google Tag Manager code',
    category: 'internal', severity: 'notice',
    why: 'Pages without the tracking container are invisible in analytics, leaving gaps in behaviour and conversion data.',
    fix: 'Ensure the container is in the shared layout so every route inherits it.',
    test: (p) => p.gtmCodes.length === 0,
  }),
  pageCheck({
    id: 'multiple-gtm-codes', title: 'URL contains more than one Google Tag Manager code',
    category: 'internal', severity: 'warning',
    why: 'Two containers on one page double-count pageviews and events, corrupting all downstream metrics.',
    fix: 'Remove the duplicate container, usually one in a layout and one in a page component.',
    test: (p) => p.gtmCodes.length > 1 ? p.gtmCodes.join(', ') : false,
  }),
];

export const INTERNAL_CHECKS: PageCheck[] = [
  ...statusChecks, ...urlHygieneChecks, ...resourceChecks, ...gtmChecks,
];
