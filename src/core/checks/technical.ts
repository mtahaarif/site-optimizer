/**
 * Redirects (11) + Social Media (6) + Code Validation (10) + XML Sitemaps (8).
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck } from './types.ts';
import { normalizeUrl, type PageData } from '../extract.ts';

// ---------------------------------------------------------------------------
// Redirects
// ---------------------------------------------------------------------------

const isRedirect = (p: PageData) => p.status >= 300 && p.status < 400;
const anyRedirect = (p: PageData) => p.redirectChain.length > 0 || isRedirect(p);

const redirectChecks: PageCheck[] = [
  pageCheck({
    id: '301-redirects', title: '301 redirects',
    category: 'redirects', severity: 'notice',
    why: 'Permanent redirects are correct behaviour, but internal links pointing at them add an unnecessary hop for every crawl and visit.',
    fix: 'Update internal links to point at the final destination.',
    appliesTo: () => true,
    test: (p) => p.status === 301 || p.redirectChain.some((h) => h.status === 301),
  }),
  pageCheck({
    id: '302-redirects', title: '302 redirects',
    category: 'redirects', severity: 'warning',
    why: 'A temporary redirect tells Google to keep the old URL indexed and not transfer signals. When the move is permanent this loses ranking.',
    fix: 'Change to 301 for permanent moves.',
    appliesTo: () => true,
    test: (p) => p.status === 302 || p.redirectChain.some((h) => h.status === 302),
  }),
  pageCheck({
    id: '3xx-other-redirects', title: '3xx other redirects',
    category: 'redirects', severity: 'notice',
    why: 'Status codes such as 303, 307 and 308 have specific semantics that are often applied unintentionally by a framework default.',
    fix: 'Confirm the status matches the intent — 308 for permanent, 307 for temporary, preserving the method.',
    appliesTo: () => true,
    test: (p) => {
      const codes = [p.status, ...p.redirectChain.map((h) => h.status)]
        .filter((s) => s >= 300 && s < 400 && s !== 301 && s !== 302);
      return codes.length ? 'HTTP ' + codes[0] : false;
    },
  }),
  pageCheck({
    id: 'redirect-chains', title: 'Redirect chains',
    category: 'redirects', severity: 'critical',
    why: 'Each hop adds latency and attenuates the signals passed. Google stops following after roughly five hops, so long chains break indexing outright.',
    fix: 'Collapse the chain so the first URL redirects straight to the final destination.',
    appliesTo: () => true,
    test: (p) => p.redirectChain.length > 1 ? p.redirectChain.length + ' hops' : false,
  }),
  pageCheck({
    id: 'redirect-loop', title: 'Internal URL is part of a chained redirect loop',
    category: 'redirects', severity: 'blocker',
    why: 'A redirect cycle never resolves, so the page is unreachable for users and crawlers alike.',
    fix: 'Break the cycle. Usually two rules disagree — for example a trailing-slash rule fighting a locale rule.',
    appliesTo: () => true,
    test: (p) => {
      const seen = new Set<string>();
      for (const hop of p.redirectChain) {
        const k = normalizeUrl(hop.url);
        if (seen.has(k)) return 'loop at ' + hop.url;
        seen.add(k);
      }
      return false;
    },
  }),
  pageCheck({
    id: 'redirect-to-itself', title: 'Internal URL redirects back to itself',
    category: 'redirects', severity: 'blocker',
    why: 'A self-referential redirect is an immediate infinite loop; the browser reports ERR_TOO_MANY_REDIRECTS.',
    fix: 'Fix the rewrite rule. Commonly a redirect that does not exclude its own target.',
    appliesTo: () => true,
    test: (p) => p.redirectChain.some((h) => {
      try { return normalizeUrl(new URL(h.location, h.url).toString()) === normalizeUrl(h.url); }
      catch { return false; }
    }),
  }),
  pageCheck({
    id: 'broken-redirect', title: 'Internal URL redirect broken',
    category: 'redirects', severity: 'critical',
    why: 'The redirect resolves to a 4xx or 5xx, so the destination does not exist. All equity from the original URL is lost.',
    fix: 'Point the redirect at a live page.',
    appliesTo: () => true,
    test: (p) => p.redirectChain.length > 0 && p.status >= 400 ? 'ends in HTTP ' + p.status : false,
  }),
  pageCheck({
    id: 'redirect-trailing-slash', title: 'Internal redirects from trailing slash mismatch',
    category: 'redirects', severity: 'critical',
    why: 'Links are emitted with a trailing slash that the server then redirects away, or the reverse. Every internal link costs an extra round trip.',
    fix: 'Make the trailingSlash setting in next.config match the form your links use, then update the links.',
    appliesTo: () => true,
    test: (p) => p.redirectChain.some((h) => {
      try {
        const from = new URL(h.url);
        const to = new URL(h.location, h.url);
        return from.pathname.replace(/\/$/, '') === to.pathname.replace(/\/$/, '')
          && from.pathname !== to.pathname;
      } catch { return false; }
    }),
  }),
  pageCheck({
    id: 'redirect-case-normalization', title: 'Internal redirects from case normalization',
    category: 'redirects', severity: 'critical',
    why: 'Links contain uppercase characters that the server redirects to lowercase, adding a hop to every one.',
    fix: 'Emit lowercase URLs at the source rather than correcting them with a redirect.',
    appliesTo: () => true,
    test: (p) => p.redirectChain.some((h) => {
      try {
        const from = new URL(h.url).pathname;
        const to = new URL(h.location, h.url).pathname;
        return from.toLowerCase() === to.toLowerCase() && from !== to;
      } catch { return false; }
    }),
  }),
  pageCheck({
    id: 'https-to-http-redirect', title: 'HTTPS to HTTP redirect',
    category: 'redirects', severity: 'blocker',
    why: 'Downgrading a secure request to insecure exposes the visitor and is the opposite of the intended direction.',
    fix: 'Remove the downgrade rule.',
    appliesTo: () => true,
    test: (p) => p.redirectChain.some((h) => {
      try { return h.url.startsWith('https://') && new URL(h.location, h.url).protocol === 'http:'; }
      catch { return false; }
    }),
  }),
  pageCheck({
    id: 'meta-refresh-redirect', title: 'Meta refresh redirect',
    category: 'redirects', severity: 'warning',
    why: 'Meta refresh is a client-side redirect that passes signals unreliably and is disorienting for users.',
    fix: 'Replace with a server-side 301.',
    test: (p) => /<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i.test(p.html),
  }),
  pageCheck({
    id: 'asset-linked-via-redirect', title: 'Asset linked via redirect',
    category: 'redirects', severity: 'notice',
    why: 'Every redirected asset adds a round trip on the critical rendering path.',
    fix: 'Reference assets at their final URL.',
    test: (p, site) => {
      const assets = [...p.scripts.map((s) => s.url), ...p.stylesheets.map((s) => s.url),
        ...p.images.map((i) => i.src)].filter(Boolean);
      const bad = assets.filter((u) => {
        const s = site.byUrl.get(normalizeUrl(u))?.status;
        return s !== undefined && s >= 300 && s < 400;
      });
      return bad.length ? bad.length + ' redirected asset(s)' : false;
    },
  }),
];

// ---------------------------------------------------------------------------
// Social Media
// ---------------------------------------------------------------------------

const OG_REQUIRED = ['title', 'description', 'image', 'url'];

const socialChecks: PageCheck[] = [
  pageCheck({
    id: 'open-graph-tags-missing', title: 'Open Graph tags missing',
    category: 'social-media', severity: 'warning',
    why: 'Without Open Graph tags, shares on Facebook, LinkedIn, Slack and most messaging apps fall back to scraping arbitrary page content, usually producing an unattractive preview.',
    fix: 'Add og:title, og:description, og:image and og:url. In Next.js set metadata.openGraph.',
    test: (p) => Object.keys(p.og).length === 0,
  }),
  pageCheck({
    id: 'open-graph-tags-incomplete', title: 'Open Graph tags incomplete',
    category: 'social-media', severity: 'notice',
    why: 'A partial set means platforms fill the gaps themselves, so the preview is only half controlled.',
    fix: 'Provide the full set: og:title, og:description, og:image, og:url.',
    test: (p) => {
      if (Object.keys(p.og).length === 0) return false;
      const missing = OG_REQUIRED.filter((k) => !p.og[k]);
      return missing.length ? 'missing og:' + missing.join(', og:') : false;
    },
  }),
  pageCheck({
    id: 'open-graph-url-not-canonical', title: 'Open Graph URL not matching canonical',
    category: 'social-media', severity: 'notice',
    why: 'When og:url and the canonical disagree, social engagement signals accrue to a different URL than the one you want indexed.',
    fix: 'Set og:url to the canonical URL.',
    test: (p) => {
      if (!p.og['url'] || !p.canonical) return false;
      return normalizeUrl(p.og['url']) !== normalizeUrl(p.canonical)
        ? 'og:url ≠ canonical' : false;
    },
  }),
  pageCheck({
    id: 'og-image-relative', title: 'Open Graph image is a relative URL',
    category: 'social-media', severity: 'warning',
    why: 'Social crawlers require absolute image URLs. A relative one produces a preview with no image at all. In Next.js this is the classic symptom of a missing metadataBase.',
    fix: 'Use an absolute URL, or set metadataBase in your root layout so Next resolves relative image paths correctly.',
    test: (p) => {
      const img = p.og['image'];
      return img && !/^https?:\/\//i.test(img) ? 'og:image = ' + img : false;
    },
  }),
  pageCheck({
    id: 'twitter-card-missing', title: 'Twitter card missing',
    category: 'social-media', severity: 'notice',
    why: 'Without a Twitter card, X renders a plain link rather than a rich preview, which measurably reduces engagement.',
    fix: 'Add twitter:card, twitter:title, twitter:description and twitter:image.',
    test: (p) => Object.keys(p.twitter).length === 0,
  }),
  pageCheck({
    id: 'twitter-card-incomplete', title: 'Twitter card incomplete',
    category: 'social-media', severity: 'notice',
    why: 'Missing card fields cause X to fall back to Open Graph or render nothing.',
    fix: 'Provide at minimum twitter:card and twitter:title.',
    test: (p) => {
      if (Object.keys(p.twitter).length === 0) return false;
      const missing = ['card', 'title'].filter((k) => !p.twitter[k]);
      return missing.length ? 'missing twitter:' + missing.join(', twitter:') : false;
    },
  }),
  pageCheck({
    id: 'twitter-description-too-long', title: 'Twitter description length is too long',
    category: 'social-media', severity: 'notice',
    why: 'Descriptions beyond 200 characters are truncated in the card.',
    fix: 'Shorten twitter:description to under 200 characters.',
    test: (p) => (p.twitter['description']?.length ?? 0) > 200
      ? p.twitter['description']!.length + ' chars' : false,
  }),
];

const socialSiteChecks: SiteCheck[] = [
  siteCheck({
    id: 'homepage-social-links', title: 'Home page has links to social media pages',
    category: 'social-media', severity: 'notice',
    why: 'Links to official profiles help search engines associate the site with its brand entities and support knowledge-panel accuracy.',
    fix: 'Link to your official social profiles from the homepage footer.',
    test: (site) => {
      const home = site.byUrl.get(site.homepageUrl);
      if (!home) return false;
      const social = /facebook\.com|twitter\.com|x\.com|linkedin\.com|instagram\.com|youtube\.com|tiktok\.com/i;
      return !home.links.some((l) => l.href && social.test(l.href));
    },
  }),
];

// ---------------------------------------------------------------------------
// Code Validation
// ---------------------------------------------------------------------------

const codeChecks: PageCheck[] = [
  pageCheck({
    id: 'no-doctype', title: 'Page has no declared <!doctype html>',
    category: 'code-validation', severity: 'critical',
    why: 'Without a doctype browsers enter quirks mode, which changes box-model calculation and can break layout across the whole page.',
    fix: 'Start the document with <!doctype html>.',
    test: (p) => !p.hasDoctype,
  }),
  pageCheck({
    id: 'html-tag-empty', title: '<html> tag is empty',
    category: 'code-validation', severity: 'blocker',
    why: 'An empty root element means the page rendered nothing at all.',
    fix: 'Check for a server-side exception during render.',
    test: (p) => p.htmlTagEmpty,
  }),
  pageCheck({
    id: 'php-fatal-error', title: 'PHP fatal error',
    category: 'code-validation', severity: 'blocker',
    why: 'A visible PHP error means the page failed to execute and is leaking file paths and stack details to visitors and attackers.',
    fix: 'Fix the error and disable error display in production.',
    // A site that does not run PHP cannot emit one, so any match is prose
    // about PHP rather than a broken page — and this is a blocker, the most
    // expensive thing in the rubric to get wrong.
    onlyOn: ['php'],
    test: (p) => p.hasPhpError,
  }),
  pageCheck({
    id: 'gtm-in-body', title: 'Google Tag Manager code in <body>',
    category: 'code-validation', severity: 'warning',
    why: 'The GTM container script belongs in <head>; placed in <body> it initialises late and misses early events.',
    fix: 'Move the container snippet to <head> and keep only the noscript iframe in <body>.',
    test: (p) => p.gtmInBody && p.gtmCodes.length > 0,
  }),
  pageCheck({
    id: 'headings-hierarchy-broken', title: 'Headings hierarchy is broken',
    category: 'code-validation', severity: 'notice',
    why: 'Skipping heading levels breaks the document outline that screen readers use for navigation.',
    fix: 'Use heading levels in order. Style with CSS rather than choosing a level for its size.',
    test: (p) => {
      let prev = 0;
      for (const h of p.headings) {
        if (prev && h.level > prev + 1) return 'h' + prev + ' followed by h' + h.level;
        prev = h.level;
      }
      return false;
    },
  }),
  pageCheck({
    id: 'identical-html-ids', title: 'Page has identical HTML id attributes',
    category: 'code-validation', severity: 'critical',
    why: 'Duplicate ids are invalid. getElementById and fragment links resolve to the first match only, so scripts and jump links target the wrong element.',
    fix: 'Make every id unique. Use classes for repeated components.',
    test: (p) => p.duplicateIds.length
      ? p.duplicateIds.length + ' duplicate id(s): ' + p.duplicateIds.slice(0, 3).join(', ') : false,
  }),
  pageCheck({
    id: 'different-structured-data-formats', title: 'Page contains different structured data formats',
    category: 'code-validation', severity: 'notice',
    why: 'Mixing JSON-LD, Microdata and RDFa on one page risks conflicting or duplicated entity definitions.',
    fix: 'Standardise on JSON-LD, which Google recommends.',
    test: (p) => p.structuredDataFormats.length > 1 ? p.structuredDataFormats.join(' + ') : false,
  }),
  pageCheck({
    id: 'table-no-caption', title: 'Page has <table> but has no <caption> attribute',
    category: 'code-validation', severity: 'notice',
    why: 'A caption gives screen reader users the table purpose before they navigate its cells.',
    fix: 'Add a <caption> as the first child of each data table.',
    test: (p) => {
      const bad = p.tables.filter((t) => !t.hasCaption).length;
      return bad ? bad + ' table(s) without caption' : false;
    },
  }),
  pageCheck({
    id: 'table-no-th', title: 'Page has <table> but has no <th> attribute',
    category: 'code-validation', severity: 'notice',
    why: 'Without header cells, assistive technology cannot associate data cells with their column or row meaning.',
    fix: 'Use <th> with an appropriate scope for header cells.',
    test: (p) => {
      const bad = p.tables.filter((t) => !t.hasTh).length;
      return bad ? bad + ' table(s) without header cells' : false;
    },
  }),
  pageCheck({
    id: 'tags-with-style-attributes', title: 'Page has tags with style attributes',
    category: 'code-validation', severity: 'notice',
    why: 'Inline styles cannot be cached or reused, add weight to every response, and require unsafe-inline in a Content-Security-Policy.',
    fix: 'Move styling into stylesheets or utility classes.',
    // Drag-and-drop builders position everything with inline styles — it is
    // how their output works, not a defect, and the user cannot change it
    // without leaving the platform. Reporting it on every page is noise.
    notOn: ['site-builder'],
    test: (p) => p.styleAttrCount > 0 ? p.styleAttrCount + ' inline style attribute(s)' : false,
  }),
];

// ---------------------------------------------------------------------------
// XML Sitemaps
// ---------------------------------------------------------------------------

const inSitemap = (p: PageData) => p.inSitemap;

const sitemapChecks: PageCheck[] = [
  pageCheck({
    id: 'sitemap-4xx', title: '4xx client errors in XML sitemaps',
    category: 'xml-sitemaps', severity: 'critical',
    why: 'Submitting dead URLs wastes crawl budget and signals a stale, unmaintained sitemap.',
    fix: 'Generate the sitemap from live content so removed pages drop out automatically.',
    appliesTo: inSitemap,
    test: (p) => p.status >= 400 && p.status < 500 ? 'HTTP ' + p.status : false,
  }),
  pageCheck({
    id: 'sitemap-5xx', title: '5xx server errors in XML sitemaps',
    category: 'xml-sitemaps', severity: 'critical',
    why: 'Server errors on submitted URLs suggest an availability problem on pages you have explicitly asked Google to crawl.',
    fix: 'Fix the errors, then resubmit.',
    appliesTo: inSitemap,
    test: (p) => p.status >= 500 ? 'HTTP ' + p.status : false,
  }),
  pageCheck({
    id: 'sitemap-3xx', title: '3xx redirects in XML sitemaps',
    category: 'xml-sitemaps', severity: 'warning',
    why: 'A sitemap should list final destination URLs. Redirects add a hop and contradict the canonical intent of the submission.',
    fix: 'List destination URLs directly.',
    appliesTo: inSitemap,
    test: (p) => p.status >= 300 && p.status < 400 ? 'HTTP ' + p.status : false,
  }),
  pageCheck({
    id: 'sitemap-noindex', title: 'Noindex URL in XML sitemaps',
    category: 'xml-sitemaps', severity: 'critical',
    why: 'Submitting a page while telling Google not to index it is a direct contradiction that wastes crawl budget.',
    fix: 'Exclude noindex pages from the sitemap.',
    appliesTo: inSitemap,
    test: (p) => p.metaRobots.some((r) => r.includes('noindex'))
      || (p.xRobotsTag ?? '').includes('noindex'),
  }),
  pageCheck({
    id: 'sitemap-disallowed', title: 'Disallowed URL in XML sitemaps',
    category: 'xml-sitemaps', severity: 'critical',
    why: 'The sitemap asks Google to crawl a URL that robots.txt forbids. The two directives cancel out and the URL is reported as an error in Search Console.',
    fix: 'Remove the robots.txt block, or remove the URL from the sitemap.',
    appliesTo: inSitemap,
    test: (p) => p.disallowedByRobots,
  }),
  pageCheck({
    id: 'sitemap-canonicalized', title: 'Canonicalized URL in XML sitemaps',
    category: 'xml-sitemaps', severity: 'critical',
    why: 'Listing a URL that canonicalises elsewhere sends conflicting signals about which version should be indexed.',
    fix: 'List only canonical URLs.',
    appliesTo: inSitemap,
    test: (p) => !!p.canonical && normalizeUrl(p.canonical) !== normalizeUrl(p.finalUrl),
  }),
  pageCheck({
    id: 'sitemap-timed-out', title: 'Timed out URL in XML sitemaps',
    category: 'xml-sitemaps', severity: 'warning',
    why: 'A submitted URL that does not respond in time will be dropped from the index if the problem persists.',
    fix: 'Investigate the slow route.',
    appliesTo: inSitemap,
    test: (p) => p.timedOut,
  }),
  pageCheck({
    id: 'sitemap-multiple', title: 'URL in multiple XML sitemaps',
    category: 'xml-sitemaps', severity: 'notice',
    why: 'Duplicate submissions across sitemaps make it harder to interpret per-sitemap indexing statistics in Search Console.',
    fix: 'List each URL in exactly one sitemap.',
    appliesTo: inSitemap,
    test: (p) => p.sitemapsContaining.length > 1
      ? 'listed in ' + p.sitemapsContaining.length + ' sitemaps' : false,
  }),
];

const sitemapSiteChecks: SiteCheck[] = [
  siteCheck({
    id: 'robots-txt-not-found', title: 'Robots.txt file not found',
    category: 'xml-sitemaps', severity: 'warning',
    why: 'A missing robots.txt returns 404 on every crawler visit. It also means no place to declare sitemap locations.',
    fix: 'Add a robots.txt. In Next.js App Router create app/robots.ts.',
    test: (site) => !site.robots.found,
  }),
  siteCheck({
    id: 'robots-no-sitemap-link', title: 'Sitemap.xml not indicated in robots.txt',
    category: 'xml-sitemaps', severity: 'notice',
    why: 'Declaring the sitemap in robots.txt lets any crawler discover it without manual submission.',
    fix: 'Add a Sitemap: line pointing at the absolute sitemap URL.',
    test: (site) => site.robots.found && site.robots.sitemaps.length === 0,
  }),
  siteCheck({
    id: 'sitemap-format-errors', title: 'XML sitemap format errors',
    category: 'xml-sitemaps', severity: 'critical',
    why: 'A malformed sitemap is rejected outright, so none of the URLs in it are submitted.',
    fix: 'Validate against the sitemaps.org schema.',
    test: (site) => {
      const bad = site.sitemaps.filter((s) => s.formatError);
      return bad.length ? bad.length + ' malformed sitemap(s): ' + bad[0]!.formatError : false;
    },
  }),
  siteCheck({
    id: 'sitemap-too-large', title: 'XML sitemap file is too large',
    category: 'xml-sitemaps', severity: 'warning',
    why: 'The specification caps a sitemap at 50,000 URLs and 50 MB uncompressed. Oversized files are rejected entirely.',
    fix: 'Split into multiple sitemaps behind a sitemap index.',
    test: (site) => {
      const big = site.sitemaps.find((s) => s.entryCount > 50_000 || s.bytes > 50 * 1024 * 1024);
      return big ? big.url + ' has ' + big.entryCount + ' URLs' : false;
    },
  }),
];

export const REDIRECT_CHECKS = redirectChecks;
export const SOCIAL_CHECKS = [...socialChecks, ...socialSiteChecks];
export const CODE_VALIDATION_CHECKS = codeChecks;
export const SITEMAP_CHECKS = [...sitemapChecks, ...sitemapSiteChecks];
