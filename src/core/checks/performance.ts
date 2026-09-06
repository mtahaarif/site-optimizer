/**
 * Page Speed (16) + Mobile Friendly (11).
 * Everything measurable from the response itself, without a browser.
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck, type SiteData } from './types.ts';
import type { CoreWebVitalsData } from '../pagespeed/types.ts';
import { normalizeUrl, type PageData } from '../extract.ts';

export const SPEED_LIMITS = {
  pageSizeWarn: 1.5 * 1024 * 1024,
  pageSizeCritical: 2 * 1024 * 1024,
  imageMax: 100 * 1024,
  cssMax: 15 * 1024,
  jsMax: 25 * 1024,
  domNodesMax: 1500,
  domDepthMax: 32,
  domWidthMax: 60,
  commentBytesMax: 1000,
  slowLoadMs: 3000,
  ttfbMs: 800,
};

const S = SPEED_LIMITS;

const assetSize = (site: { byUrl: Map<string, PageData> }, url: string): number | null =>
  site.byUrl.get(normalizeUrl(url))?.bytes ?? null;

const pageSpeedChecks: PageCheck[] = [
  pageCheck({
    id: 'page-size-over-1-5mb', title: 'Page size is over 1.5 MB',
    category: 'page-speed', severity: 'warning',
    why: 'Large HTML responses delay first paint, and on mobile connections the transfer alone can exceed a second.',
    fix: 'Reduce inline payload. On Next.js App Router the usual cause is inline RSC flight data rather than markup.',
    test: (p) => p.bytes > S.pageSizeWarn && p.bytes <= S.pageSizeCritical
      ? Math.round(p.bytes / 1024) + ' KB' : false,
  }),
  pageCheck({
    id: 'page-size-over-2mb', title: 'Page size is over 2 MB',
    category: 'page-speed', severity: 'critical',
    why: 'At this size the document alone dominates load time and Core Web Vitals will fail on mobile.',
    fix: 'Audit what is embedded in the HTML. Move large data out of the initial response.',
    test: (p) => p.bytes > S.pageSizeCritical ? Math.round(p.bytes / 1024) + ' KB' : false,
  }),
  pageCheck({
    id: 'slow-load-speed', title: 'Pages with slow load speed',
    category: 'page-speed', severity: 'warning',
    why: 'Slow server responses delay everything downstream. Time to First Byte is the floor for every other metric.',
    fix: 'Cache the response. On Next.js, a slow TTFB usually means the route is dynamic when it could be static or ISR.',
    test: (p) => p.ttfbMs > S.ttfbMs ? p.ttfbMs + ' ms TTFB' : false,
  }),
  pageCheck({
    id: 'image-size-over-100kb', title: 'Image size is over 100 KB',
    category: 'page-speed', severity: 'warning',
    why: 'Oversized images are the most common cause of poor Largest Contentful Paint.',
    fix: 'Compress and resize. next/image does this automatically when images are not marked unoptimized.',
    test: (p, site) => {
      const big = p.images.filter((i) => (assetSize(site, i.src) ?? 0) > S.imageMax);
      return big.length ? big.length + ' image(s) over 100 KB' : false;
    },
  }),
  pageCheck({
    id: 'css-file-over-15kb', title: 'CSS file size is over 15 KB',
    category: 'page-speed', severity: 'notice',
    why: 'Stylesheets are render-blocking, so every kilobyte delays first paint directly.',
    fix: 'Split critical CSS, remove unused rules, and ensure compression is enabled.',
    test: (p, site) => {
      const big = p.stylesheets.filter((s) => (assetSize(site, s.url) ?? 0) > S.cssMax);
      return big.length ? big.length + ' stylesheet(s) over 15 KB' : false;
    },
  }),
  pageCheck({
    id: 'js-file-over-25kb', title: 'JavaScript file size is over 25 KB',
    category: 'page-speed', severity: 'notice',
    why: 'JavaScript is the most expensive resource per byte: it must be downloaded, parsed, compiled and executed.',
    fix: 'Code-split by route and lazy-load below-the-fold components with next/dynamic.',
    test: (p, site) => {
      const big = p.scripts.filter((s) => s.url && (assetSize(site, s.url) ?? 0) > S.jsMax);
      return big.length ? big.length + ' script(s) over 25 KB' : false;
    },
  }),
  pageCheck({
    id: 'defer-offscreen-images', title: 'Defer offscreen images',
    category: 'page-speed', severity: 'opportunity',
    why: 'Images below the fold that load eagerly compete for bandwidth with content the user can actually see.',
    fix: 'Add loading="lazy" to below-the-fold images. next/image does this by default — check for priority set too broadly.',
    test: (p) => {
      const eager = p.images.filter((i, idx) => idx > 2 && i.loading !== 'lazy');
      return eager.length ? eager.length + ' offscreen image(s) not lazy-loaded' : false;
    },
  }),
  pageCheck({
    id: 'add-dimensions-to-images', title: 'Add dimensions to images',
    category: 'page-speed', severity: 'warning',
    why: 'Without width and height the browser cannot reserve space, so content jumps as images load. Cumulative Layout Shift is a ranking signal.',
    fix: 'Set explicit width and height, or use next/image with fill inside a sized parent.',
    test: (p) => {
      const bad = p.images.filter((i) => (i.width === null || i.height === null) && !i.src.startsWith('data:'));
      return bad.length ? bad.length + ' image(s) without dimensions' : false;
    },
  }),
  pageCheck({
    id: 'serve-images-next-gen', title: 'Serve images in next gen formats',
    category: 'page-speed', severity: 'opportunity',
    why: 'AVIF and WebP are typically 25-50% smaller than JPEG and PNG at equivalent quality.',
    fix: 'Serve AVIF/WebP with fallbacks. next/image negotiates format automatically.',
    test: (p) => {
      const legacy = p.images.filter((i) => /\.(jpe?g|png)($|\?)/i.test(i.src) && !i.isNextImage);
      return legacy.length ? legacy.length + ' legacy-format image(s)' : false;
    },
  }),
  pageCheck({
    id: 'use-video-for-animated', title: 'Use video formats for animated content',
    category: 'page-speed', severity: 'opportunity',
    why: 'Animated GIFs are often an order of magnitude larger than an equivalent MP4 or WebM.',
    fix: 'Convert GIFs to muted autoplaying video.',
    test: (p) => {
      const gifs = p.images.filter((i) => /\.gif($|\?)/i.test(i.src));
      return gifs.length ? gifs.length + ' GIF(s)' : false;
    },
  }),
  pageCheck({
    id: 'efficient-cache-policy', title: 'Serve static assets with an efficient cache policy',
    category: 'page-speed', severity: 'opportunity',
    why: 'Short cache lifetimes on immutable assets force repeat downloads on every visit.',
    fix: 'Serve hashed filenames with Cache-Control: public, max-age=31536000, immutable. Next.js does this for /_next/static by default.',
    test: (p, site) => {
      const assets = [...p.scripts.map((s) => s.url), ...p.stylesheets.map((s) => s.url)].filter(Boolean);
      const bad = assets.filter((u) => {
        const a = site.byUrl.get(normalizeUrl(u));
        if (!a) return false;
        const cc = a.headers['cache-control'] ?? '';
        const maxAge = Number(cc.match(/max-age=(\d+)/)?.[1] ?? 0);
        return maxAge < 86_400;
      });
      return bad.length ? bad.length + ' asset(s) with short cache lifetime' : false;
    },
  }),
  pageCheck({
    id: 'avoid-excessive-dom-size', title: 'Avoid excessive DOM size',
    category: 'page-speed', severity: 'warning',
    why: 'Large DOM trees increase memory use and make every style recalculation and layout pass more expensive.',
    fix: 'Virtualise long lists and paginate large tables.',
    test: (p) => p.domNodes > S.domNodesMax ? p.domNodes + ' nodes' : false,
  }),
  pageCheck({
    id: 'avoid-excessive-dom-depth', title: 'Avoid excessive DOM depth',
    category: 'page-speed', severity: 'notice',
    why: 'Deeply nested elements make selector matching and layout more expensive, and usually indicate unnecessary wrapper divs.',
    fix: 'Flatten the markup by removing redundant wrappers.',
    test: (p) => p.domDepth > S.domDepthMax ? p.domDepth + ' levels deep' : false,
  }),
  pageCheck({
    id: 'avoid-excessive-dom-width', title: 'Avoid excessive DOM width',
    category: 'page-speed', severity: 'notice',
    why: 'A single parent with very many direct children is expensive to lay out and usually should be paginated.',
    fix: 'Paginate or virtualise the list.',
    test: (p) => p.domMaxWidth > S.domWidthMax ? p.domMaxWidth + ' sibling elements' : false,
  }),
  pageCheck({
    id: 'excessive-comments', title: 'Comments in code has more than 1000 symbols',
    category: 'page-speed', severity: 'notice',
    why: 'Comments are transferred to every visitor but never rendered. Large blocks usually mean minification is not running.',
    fix: 'Strip comments during the production build.',
    test: (p) => p.commentBytes > S.commentBytesMax ? Math.round(p.commentBytes / 1024) + ' KB of comments' : false,
  }),
];

// ---------------------------------------------------------------------------
// Core Web Vitals, from the PageSpeed Insights API.
//
// These evaluate a *sample* of URLs, not every page, because PSI is rate
// limited. They are therefore site-scope: "the pages we measured" rather than
// "this page". Each reports the exact measured value so the number is auditable
// rather than a bare pass/fail.
// ---------------------------------------------------------------------------

const mobileOf = (site: SiteData): CoreWebVitalsData[] =>
  site.pagespeed.filter((p) => p.strategy === 'mobile');

const describe = (d: CoreWebVitalsData, metric: string, value: string): string =>
  `${value} on ${shortUrl(d.url)} (${d.strategy}, ${sourceOf(d, metric)})`;

const sourceOf = (d: CoreWebVitalsData, metric: string): string => {
  const m = (d.metrics as unknown as Record<string, { source?: string }>)[metric];
  return m?.source === 'field'
    ? (d.cruxOriginFallback ? 'CrUX origin data' : 'CrUX field data')
    : 'Lighthouse lab data';
};

const shortUrl = (u: string): string => {
  try {
    const url = new URL(u);
    return url.pathname === '/' ? url.hostname : url.pathname;
  } catch { return u; }
};

/**
 * Shared skip logic. When PSI never ran, or every request failed, the check
 * must report *skipped with the reason* rather than passing — a silent pass on
 * missing data is how a broken integration goes unnoticed for months.
 */
function cwvUnavailable(site: SiteData): string | null {
  if (!site.pagespeedAttempted) {
    return 'PageSpeed Insights was not run (maxPagespeedPages = 0)';
  }
  if (site.pagespeed.length === 0) {
    const first = site.pagespeedErrors[0];
    return first
      ? `No PageSpeed data: ${first.error}`
      : 'No PageSpeed data returned';
  }
  return null;
}

const cwvChecks: SiteCheck[] = [
  siteCheck({
    id: 'performance.cwv.lcp',
    title: 'Largest Contentful Paint',
    category: 'page-speed', severity: 'critical',
    why: 'LCP measures when the largest element in the viewport finishes rendering — the moment the page looks loaded. It is a Core Web Vital and a direct ranking input. Google\'s threshold is 2.5s; above 4s the page is classed as poor.',
    fix: 'Optimize Largest Contentful Paint: preload hero images with next/image (priority), inline critical CSS, and eliminate server-side database bottlenecks.',
    test: (site) => {
      const unavailable = cwvUnavailable(site);
      if (unavailable) return false; // reported by the availability check below
      const worst = mobileOf(site)
        .sort((a, b) => b.metrics.lcp.valueMs - a.metrics.lcp.valueMs)[0]
        ?? site.pagespeed[0];
      if (!worst) return false;
      const { lcp } = worst.metrics;
      if (lcp.score === 'GOOD') return false;
      const label = lcp.score === 'POOR' ? 'POOR' : 'needs improvement';
      return `${(lcp.valueMs / 1000).toFixed(2)}s — ${label}. ` +
        describe(worst, 'lcp', `threshold ${lcp.score === 'POOR' ? '> 4.0s' : '> 2.5s'}`) +
        (worst.lcpElement ? `. LCP element: ${worst.lcpElement.slice(0, 90)}` : '');
    },
  }),
  siteCheck({
    id: 'performance.cwv.cls',
    title: 'Cumulative Layout Shift',
    category: 'page-speed', severity: 'critical',
    why: 'CLS measures how much visible content moves unexpectedly during load. It is a Core Web Vital and the most common cause of the "I clicked the wrong thing" experience. Google\'s threshold is 0.1; above 0.25 is poor.',
    fix: 'Set explicit width and height dimensions on images and embed elements; avoid injecting dynamic banners above existing DOM nodes.',
    test: (site) => {
      if (cwvUnavailable(site)) return false;
      const worst = mobileOf(site)
        .sort((a, b) => b.metrics.cls.value - a.metrics.cls.value)[0]
        ?? site.pagespeed[0];
      if (!worst) return false;
      const { cls } = worst.metrics;
      if (cls.score === 'GOOD') return false;
      const label = cls.score === 'POOR' ? 'POOR' : 'needs improvement';
      return `${cls.value.toFixed(3)} — ${label}. ` +
        describe(worst, 'cls', `threshold ${cls.score === 'POOR' ? '> 0.25' : '> 0.1'}`);
    },
  }),
  siteCheck({
    id: 'performance.cwv.inp-tbt',
    title: 'Interaction to Next Paint / Total Blocking Time',
    category: 'page-speed', severity: 'warning',
    why: 'INP measures how quickly the page responds to real user input and replaced FID as a Core Web Vital in March 2024. It needs field data; where none exists, Total Blocking Time is Lighthouse\'s lab proxy for the same problem — a main thread too busy to respond.',
    fix: 'Reduce main-thread blocking time: code-split heavy JavaScript bundles, defer non-critical third-party scripts, and minimize hydration payload sizes.',
    test: (site) => {
      if (cwvUnavailable(site)) return false;
      const pages = mobileOf(site).length ? mobileOf(site) : site.pagespeed;

      // Prefer real INP where CrUX has it; fall back to TBT.
      const withInp = pages.filter((p) => p.metrics.inp);
      if (withInp.length > 0) {
        const worst = withInp.sort((a, b) => (b.metrics.inp!.valueMs) - (a.metrics.inp!.valueMs))[0]!;
        const inp = worst.metrics.inp!;
        if (inp.score === 'GOOD') return false;
        return `INP ${Math.round(inp.valueMs)}ms — ${inp.score === 'POOR' ? 'POOR' : 'needs improvement'}. ` +
          describe(worst, 'inp', 'threshold > 200ms');
      }

      const worst = pages.sort((a, b) => b.metrics.tbt.valueMs - a.metrics.tbt.valueMs)[0];
      if (!worst) return false;
      const { tbt } = worst.metrics;
      if (tbt.score === 'GOOD') return false;
      return `TBT ${Math.round(tbt.valueMs)}ms — ${tbt.score === 'POOR' ? 'POOR' : 'needs improvement'}. ` +
        describe(worst, 'tbt', `threshold ${tbt.score === 'POOR' ? '> 600ms' : '> 200ms'}`) +
        '. No CrUX field data for INP, so this is the lab proxy.';
    },
  }),
  siteCheck({
    id: 'performance.lighthouse.score',
    title: 'Lighthouse performance score',
    category: 'page-speed', severity: 'warning',
    why: 'The aggregate Lighthouse performance score for the mobile homepage. It is a lab simulation rather than the ranking signal itself, but it is the number most stakeholders recognise and it moves in the same direction as the vitals it summarises.',
    fix: 'Work the Core Web Vitals findings above in order of measured impact — the score is a weighted composite of LCP, TBT, CLS, FCP and Speed Index, so fixing the worst metric moves it most.',
    test: (site) => {
      if (cwvUnavailable(site)) return false;
      const home = mobileOf(site)[0] ?? site.pagespeed[0];
      if (!home) return false;
      if (home.performanceScore >= 90) return false;
      const band = home.performanceScore >= 75 ? 'below the 90 target' : 'poor';
      return `${home.performanceScore}/100 on ${shortUrl(home.url)} (mobile) — ${band}` +
        (home.opportunities?.length
          ? `. Largest opportunity: ${home.opportunities[0]!.title} (~${Math.round(home.opportunities[0]!.savingsMs)}ms)`
          : '');
    },
  }),
];

const speedSiteChecks: SiteCheck[] = [
  siteCheck({
    id: 'pagespeed-data-available',
    title: 'PageSpeed Insights data collected',
    category: 'page-speed', severity: 'notice',
    why: 'Core Web Vitals are a confirmed ranking factor and cannot be measured from the crawl alone — they need field data from real Chrome users, which only the PageSpeed Insights / CrUX API provides.',
    fix: 'Connect a PageSpeed Insights API key on the Insights page. The key is free from the Google Cloud console and raises the quota from a shared, frequently-exhausted anonymous pool to 25,000 requests/day.',
    test: (site) => cwvUnavailable(site) ?? false,
  }),
  siteCheck({
    id: 'homepage-mobile-pagespeed',
    title: 'Home page mobile PageSpeed score',
    category: 'page-speed', severity: 'notice',
    why: 'Mobile is the indexing default, so the mobile score is the one that matters for ranking.',
    fix: 'Address the Core Web Vitals findings in this category; the composite score follows them.',
    test: (site) => {
      if (cwvUnavailable(site)) return false;
      const home = mobileOf(site)[0];
      if (!home) return false;
      return home.performanceScore < 90
        ? `${home.performanceScore}/100` : false;
    },
  }),
  siteCheck({
    id: 'homepage-desktop-pagespeed',
    title: 'Home page desktop PageSpeed score',
    category: 'page-speed', severity: 'notice',
    why: 'Desktop performance for the homepage. Usually far better than mobile, so a poor desktop score indicates a problem serious enough to survive fast hardware.',
    fix: 'Address the Core Web Vitals findings in this category.',
    test: (site) => {
      if (cwvUnavailable(site)) return false;
      const home = site.pagespeed.find((p) => p.strategy === 'desktop');
      if (!home) return false;
      return home.performanceScore < 90
        ? `${home.performanceScore}/100` : false;
    },
  }),
  ...cwvChecks,
];

// ---------------------------------------------------------------------------
// Mobile Friendly — the viewport tag has seven distinct failure modes
// ---------------------------------------------------------------------------

const viewportOf = (p: PageData): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const part of (p.viewports[0] ?? '').split(',')) {
    const [k, v] = part.split('=').map((s) => s.trim().toLowerCase());
    if (k) out[k] = v ?? '';
  }
  return out;
};

const mobileChecks: PageCheck[] = [
  pageCheck({
    id: 'viewport-missing', title: 'Missing <viewport> meta tag in <head>',
    category: 'mobile-friendly', severity: 'critical',
    why: 'Without a viewport tag mobile browsers render at desktop width and zoom out, making text unreadable. This alone fails mobile-friendliness.',
    fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">. In Next.js App Router export the viewport object.',
    test: (p) => p.viewports.length === 0,
  }),
  pageCheck({
    id: 'viewport-multiple', title: 'Multiple viewport <meta> tags were found in <head>',
    category: 'mobile-friendly', severity: 'warning',
    why: 'Conflicting viewport declarations produce inconsistent behaviour across browsers.',
    fix: 'Keep exactly one viewport tag.',
    test: (p) => p.viewports.length > 1 ? p.viewports.length + ' viewport tags' : false,
  }),
  pageCheck({
    id: 'viewport-no-width', title: 'Viewport <meta> tag does not have a width set',
    category: 'mobile-friendly', severity: 'critical',
    why: 'Without width the layout viewport falls back to a default desktop width on mobile.',
    fix: 'Add width=device-width.',
    test: (p) => p.viewports.length > 0 && !('width' in viewportOf(p)),
  }),
  pageCheck({
    id: 'viewport-specific-width', title: 'Viewport <meta> tag has a specific width set',
    category: 'mobile-friendly', severity: 'critical',
    why: 'A fixed pixel width forces the same layout width on every device, defeating responsive design.',
    fix: 'Use width=device-width instead of a pixel value.',
    test: (p) => {
      const w = viewportOf(p)['width'];
      return w && w !== 'device-width' ? 'width=' + w : false;
    },
  }),
  pageCheck({
    id: 'viewport-missing-initial-scale', title: 'Viewport <meta> tag is missing an initial-scale',
    category: 'mobile-friendly', severity: 'warning',
    why: 'Without initial-scale some browsers apply an unexpected zoom level on first render.',
    fix: 'Add initial-scale=1.',
    test: (p) => p.viewports.length > 0 && !('initial-scale' in viewportOf(p)),
  }),
  pageCheck({
    id: 'viewport-initial-scale-incorrect', title: 'Viewport <meta> tag initial-scale is incorrect',
    category: 'mobile-friendly', severity: 'warning',
    why: 'An initial-scale other than 1 renders the page pre-zoomed, cropping content or shrinking text.',
    fix: 'Set initial-scale=1.',
    test: (p) => {
      const s = viewportOf(p)['initial-scale'];
      return s && s !== '1' && s !== '1.0' ? 'initial-scale=' + s : false;
    },
  }),
  pageCheck({
    id: 'viewport-maximum-scale', title: 'Viewport <meta> tag has a maximum-scale set',
    category: 'mobile-friendly', severity: 'warning',
    why: 'Capping zoom prevents users with low vision from enlarging text. It is an accessibility failure under WCAG 1.4.4.',
    fix: 'Remove maximum-scale.',
    test: (p) => 'maximum-scale' in viewportOf(p),
  }),
  pageCheck({
    id: 'viewport-minimum-scale', title: 'Viewport <meta> tag has a minimum-scale set',
    category: 'mobile-friendly', severity: 'notice',
    why: 'Restricting zoom-out can trap users on layouts wider than their screen.',
    fix: 'Remove minimum-scale unless there is a specific reason for it.',
    test: (p) => 'minimum-scale' in viewportOf(p),
  }),
  pageCheck({
    id: 'viewport-prevents-scaling', title: 'Viewport <meta> tag prevents the user from scaling',
    category: 'mobile-friendly', severity: 'warning',
    why: 'user-scalable=no blocks pinch-zoom entirely, an accessibility failure that iOS Safari now ignores anyway.',
    fix: 'Remove user-scalable=no.',
    test: (p) => {
      const u = viewportOf(p)['user-scalable'];
      return u === 'no' || u === '0';
    },
  }),
  pageCheck({
    id: 'image-map-tags', title: 'Has one or more image-map <map> tags',
    category: 'mobile-friendly', severity: 'notice',
    why: 'Image maps use fixed pixel coordinates, so they do not scale with responsive layouts and are unusable on touch devices.',
    fix: 'Replace with positioned links or an SVG with real anchor elements.',
    test: (p) => p.mapTagCount ? p.mapTagCount + ' <map> tag(s)' : false,
  }),
  pageCheck({
    id: 'unsupported-browser-plugins', title: 'Unsupported browser plugins found',
    category: 'mobile-friendly', severity: 'critical',
    why: 'Flash, Java applets and Silverlight are not supported by any modern browser. The content simply does not render.',
    fix: 'Replace with HTML5 equivalents.',
    test: (p) => p.legacyPluginCount ? p.legacyPluginCount + ' legacy plugin element(s)' : false,
  }),
];

export const PAGESPEED_CHECKS = [...pageSpeedChecks, ...speedSiteChecks];
export const MOBILE_CHECKS = mobileChecks;
