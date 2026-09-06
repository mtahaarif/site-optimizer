/**
 * The crawler.
 *
 * Breadth-first frontier with bounded concurrency, manual redirect following so
 * the full chain is recorded, and a post-crawl analysis pass that computes
 * everything the site-scope checks depend on.
 */
import { extractPage, normalizeUrl, type PageData, type RedirectHop } from '../core/extract.ts';
import { computePageRank } from '../core/scoring/pagerank.ts';
import { contentKey } from '../core/checks/duplicate.ts';
import type { SiteData, InboundLink, SslInfo, SecurityHeaders } from '../core/checks/types.ts';
import { fetchRobots, USER_AGENT } from './robots.ts';
import { discoverSitemaps } from './sitemap.ts';
import { BrowserPool, detectSpaShell } from './browser.ts';
import { aggregatePlatform } from '../core/platform/detect.ts';
import { extractBodyText } from '../core/nextjs/detect.ts';

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  timeoutMs: number;
  /** fetch assets (css/js/images) to size them and detect broken references */
  checkAssets: boolean;
  respectRobots: boolean;
  includeSubdomains: boolean;
  /** how many URLs to run PageSpeed Insights against; 0 disables it entirely */
  maxPagespeedPages: number;

  /**
   * Render each page in headless Chromium before extraction. Required for
   * client-rendered SPAs; unnecessary and much slower for SSR/SSG sites.
   */
  renderJs: boolean;
  jsWaitUntil: 'load' | 'domcontentloaded' | 'networkidle';
  jsTimeoutMs: number;
  /** block images, fonts, media and analytics during render */
  jsBlockResources: boolean;
}

export const DEFAULT_OPTIONS: Omit<CrawlOptions, 'startUrl'> = {
  maxPages: 200,
  maxDepth: 10,
  concurrency: 6,
  timeoutMs: 20_000,
  checkAssets: true,
  respectRobots: true,
  includeSubdomains: false,
  // PSI is slow and rate-limited, so only the most important pages are sampled.
  maxPagespeedPages: 3,
  // Off by default: raw fetching is 50-100x faster and correct for SSR/SSG.
  renderJs: false,
  jsWaitUntil: 'networkidle',
  jsTimeoutMs: 15_000,
  jsBlockResources: true,
};

export interface CrawlProgress {
  phase: 'robots' | 'sitemaps' | 'crawling' | 'assets' | 'analysing' | 'pagespeed' | 'checking' | 'done' | 'error';
  crawled: number;
  queued: number;
  total: number;
  currentUrl: string | null;
  message: string;
}

export type ProgressFn = (p: CrawlProgress) => void;

const MAX_ASSETS = 400;

// ---------------------------------------------------------------------------

interface FetchResult {
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  redirectChain: RedirectHop[];
  ttfbMs: number;
  totalMs: number;
  timedOut: boolean;
  error: string | null;
}

/**
 * Fetch one URL, following redirects manually so every hop is recorded.
 * Non-HTML bodies are discarded after measuring size — we only need the bytes.
 */
async function fetchUrl(url: string, timeoutMs: number, wantBody = true): Promise<FetchResult> {
  const redirectChain: RedirectHop[] = [];
  let current = url;
  const started = Date.now();
  let ttfbMs = 0;

  for (let hop = 0; hop <= 10; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const t0 = Date.now();
      const res = await fetch(current, {
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        redirect: 'manual',
        signal: controller.signal,
      });
      ttfbMs = Date.now() - t0;

      const headers: Record<string, string> = {};
      res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

      if (res.status >= 300 && res.status < 400 && headers['location']) {
        redirectChain.push({ url: current, status: res.status, location: headers['location'] });
        let next: string;
        try { next = new URL(headers['location'], current).toString(); } catch { break; }
        // A redirect to itself would spin forever; record it and stop.
        if (next === current) {
          clearTimeout(timer);
          return { finalUrl: current, status: res.status, headers, body: '', redirectChain, ttfbMs, totalMs: Date.now() - started, timedOut: false, error: null };
        }
        current = next;
        clearTimeout(timer);
        continue;
      }

      const type = (headers['content-type'] ?? '').toLowerCase();
      const isText = type.includes('html') || type.includes('xml') || type.includes('json') || type.includes('text');
      let body = '';
      if (wantBody && isText) {
        body = await res.text();
      } else {
        // Measure the payload without keeping it. The transferred byte count is
        // more trustworthy than a Content-Length header, which is often absent
        // under chunked encoding, so it always overwrites.
        const buf = await res.arrayBuffer();
        headers['content-length'] = String(buf.byteLength);
      }

      clearTimeout(timer);
      return {
        finalUrl: current, status: res.status, headers, body, redirectChain,
        ttfbMs, totalMs: Date.now() - started, timedOut: false, error: null,
      };
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error).name === 'AbortError';
      return {
        finalUrl: current, status: 0, headers: {}, body: '', redirectChain,
        ttfbMs, totalMs: Date.now() - started,
        timedOut: aborted, error: aborted ? 'timeout' : (err as Error).message,
      };
    }
  }

  return {
    finalUrl: current, status: 0, headers: {}, body: '', redirectChain,
    ttfbMs, totalMs: Date.now() - started, timedOut: false, error: 'too many redirects',
  };
}

function sameScope(url: string, origin: string, includeSubdomains: boolean): boolean {
  try {
    const a = new URL(url);
    const b = new URL(origin);
    if (a.protocol !== 'http:' && a.protocol !== 'https:') return false;
    const ha = a.hostname.replace(/^www\./, '');
    const hb = b.hostname.replace(/^www\./, '');
    return includeSubdomains ? ha === hb || ha.endsWith('.' + hb) : ha === hb;
  } catch { return false; }
}

// ---------------------------------------------------------------------------

export interface CrawlResult {
  site: SiteData;
  options: CrawlOptions;
  durationMs: number;
}

export async function crawl(
  optionsIn: Partial<CrawlOptions> & { startUrl: string },
  onProgress: ProgressFn = () => {},
): Promise<CrawlResult> {
  const options: CrawlOptions = { ...DEFAULT_OPTIONS, ...optionsIn };
  const started = Date.now();

  const startUrl = new URL(options.startUrl).toString();
  const origin = new URL(startUrl).origin;
  const homepageUrl = normalizeUrl(new URL('/', origin).toString());

  // ---- robots.txt --------------------------------------------------------
  onProgress({ phase: 'robots', crawled: 0, queued: 0, total: 0, currentUrl: null, message: 'Fetching robots.txt' });
  const robots = await fetchRobots(origin);

  // ---- sitemaps ----------------------------------------------------------
  onProgress({ phase: 'sitemaps', crawled: 0, queued: 0, total: 0, currentUrl: null, message: 'Discovering XML sitemaps' });
  const { sitemaps, membership } = await discoverSitemaps(origin, robots.sitemaps);
  const sitemapUrls = new Set(membership.keys());

  // ---- frontier ----------------------------------------------------------
  const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];
  for (const u of sitemapUrls) {
    if (queue.length >= options.maxPages) break;
    if (sameScope(u, origin, options.includeSubdomains)) queue.push({ url: u, depth: 1 });
  }

  const seen = new Set<string>([normalizeUrl(startUrl)]);
  for (const q of queue) seen.add(normalizeUrl(q.url));

  const pages: PageData[] = [];
  /** normalized final URLs already stored, so redirect/alias twins collapse to one page */
  const finalSeen = new Set<string>();
  const assetQueue = new Set<string>();
  const renderFailures: Array<{ url: string; error: string }> = [];

  // One browser for the whole job. Launched lazily on first use so a crawl that
  // never renders anything never pays the startup cost.
  const browserPool = options.renderJs ? new BrowserPool(USER_AGENT) : null;

  // Everything from here runs inside try/finally: a thrown error, an abort,
  // or a normal return must all close the browser. A leaked Chromium process
  // outlives the crawl and the dev server, and nothing tells the user why.
  try {
    onProgress({ phase: 'crawling', crawled: 0, queued: queue.length, total: options.maxPages, currentUrl: null, message: 'Crawling' });

    while (queue.length > 0 && pages.length < options.maxPages) {
      const batch = queue.splice(0, options.concurrency);

      const results = await Promise.all(batch.map(async ({ url, depth }) => {
        const disallowed = robots.isDisallowed(url);
        if (disallowed && options.respectRobots) {
          // Still record the URL so the "Disallowed by robots.txt" check can fire.
          const page = extractPage({
            url, finalUrl: url, status: 0, headers: {}, html: '',
            redirectChain: [], ttfbMs: 0, totalMs: 0, depth,
            fetchError: 'blocked by robots.txt',
          });
          page.disallowedByRobots = true;
          return page;
        }

        // The raw fetch always runs: it is the source of truth for status codes,
        // redirect chains and response headers, and it is what tells us whether
        // the server response was a client-rendered shell in the first place.
        const r = await fetchUrl(url, options.timeoutMs);

        const serverText = r.body ? extractBodyText(r.body) : '';
        const spa = r.body ? detectSpaShell(r.body, serverText.length) : null;

        const isHtmlResponse = (r.headers['content-type'] ?? '').includes('html');
        const shouldRender = options.renderJs && isHtmlResponse && r.status === 200 && !!browserPool;

        if (shouldRender) {
          const rendered = await browserPool!.render(url, {
            waitUntil: options.jsWaitUntil,
            timeoutMs: options.jsTimeoutMs,
            blockResources: options.jsBlockResources,
            userAgent: USER_AGENT,
          });

          // A render failure must not lose the page — fall through to the raw
          // HTML, which is still a valid (if incomplete) view of the document.
          if (!rendered.error && rendered.html) {
            const page = extractPage({
              url,
              finalUrl: rendered.finalUrl || r.finalUrl,
              status: rendered.status || r.status,
              // Response headers come from the raw fetch: Playwright cannot see
              // the pre-redirect chain, and header-derived checks depend on it.
              headers: r.headers,
              html: rendered.html,
              redirectChain: r.redirectChain,
              ttfbMs: rendered.ttfbMs || r.ttfbMs,
              totalMs: rendered.totalMs,
              depth,
              renderedWithJs: true,
              jsConsoleErrors: rendered.consoleErrors,
              domContentLoadedMs: rendered.domContentLoadedMs,
              loadCompleteMs: rendered.loadCompleteMs,
              serverTextLength: serverText.length,
              spaFramework: spa?.framework ?? null,
              isClientRenderedShell: spa?.isClientRendered ?? false,
            });
            page.disallowedByRobots = disallowed;
            return page;
          }

          renderFailures.push({ url, error: rendered.error ?? 'empty render' });
        }

        const page = extractPage({
          url,
          finalUrl: r.finalUrl,
          status: r.status,
          headers: r.headers,
          html: r.body,
          redirectChain: r.redirectChain,
          ttfbMs: r.ttfbMs,
          totalMs: r.totalMs,
          timedOut: r.timedOut,
          fetchError: r.error,
          depth,
          serverTextLength: serverText.length,
          spaFramework: spa?.framework ?? null,
          isClientRenderedShell: spa?.isClientRendered ?? false,
        });
        page.disallowedByRobots = disallowed;
        return page;
      }));

      for (const page of results) {
        const key = normalizeUrl(page.finalUrl);

        // Two different requested URLs can land on the same final URL — a
        // trailing-slash variant of the start URL, or anything behind a
        // redirect. `seen` only tracks what was requested, so without this the
        // same page is stored twice and every duplicate-content check reports it
        // as a duplicate of itself ("shared with 0 other pages").
        if (finalSeen.has(key)) continue;
        finalSeen.add(key);
        seen.add(key); // don't queue the alias again either

        pages.push(page);

        page.inSitemap = sitemapUrls.has(key);
        page.sitemapsContaining = membership.get(key) ?? [];

        // Queue newly discovered internal links.
        if (page.depth < options.maxDepth) {
          for (const link of page.links) {
            if (!link.href || !sameScope(link.href, origin, options.includeSubdomains)) continue;
            const k = normalizeUrl(link.href);
            if (seen.has(k)) continue;
            if (seen.size >= options.maxPages * 2) break;
            seen.add(k);
            queue.push({ url: link.href, depth: page.depth + 1 });
          }
        }

        // Collect assets for the sizing/broken-resource pass.
        if (options.checkAssets && assetQueue.size < MAX_ASSETS) {
          for (const u of [
            ...page.stylesheets.map((s) => s.url),
            ...page.scripts.map((s) => s.url),
            ...page.images.map((i) => i.src),
          ]) {
            if (!u || u.startsWith('data:')) continue;
            if (seen.has(normalizeUrl(u))) continue;
            if (assetQueue.size >= MAX_ASSETS) break;
            assetQueue.add(u);
          }
        }
      }

      onProgress({
        phase: 'crawling', crawled: pages.length, queued: queue.length,
        total: options.maxPages, currentUrl: batch[0]?.url ?? null,
        message: 'Crawled ' + pages.length + ' of up to ' + options.maxPages + ' pages',
      });
    }

    // ---- assets ------------------------------------------------------------
    if (options.checkAssets && assetQueue.size > 0) {
      onProgress({ phase: 'assets', crawled: pages.length, queued: assetQueue.size, total: options.maxPages, currentUrl: null, message: 'Checking ' + assetQueue.size + ' page resources' });
      const assets = [...assetQueue];
      for (let i = 0; i < assets.length; i += options.concurrency) {
        const batch = assets.slice(i, i + options.concurrency);
        const results = await Promise.all(batch.map(async (url) => {
          const r = await fetchUrl(url, options.timeoutMs, false);
          return extractPage({
            url, finalUrl: r.finalUrl, status: r.status, headers: r.headers, html: '',
            redirectChain: r.redirectChain, ttfbMs: r.ttfbMs, totalMs: r.totalMs,
            timedOut: r.timedOut, fetchError: r.error, depth: 99,
            isSubresource: true,
          });
        }));
        for (const a of results) {
          // Asset byte size comes from content-length since we discard the body.
          a.bytes = Number(a.headers['content-length'] ?? 0);
          pages.push(a);
        }
      }
    }

    // ---- analysis ----------------------------------------------------------
    onProgress({ phase: 'analysing', crawled: pages.length, queued: 0, total: pages.length, currentUrl: null, message: 'Building link graph and duplicate index' });

    const site = await analyse(pages, {
      origin, homepageUrl, startUrl, robots, sitemaps, sitemapUrls, membership,
      includeSubdomains: options.includeSubdomains,
    });

    site.renderJs = options.renderJs;
    site.renderFailures = renderFailures;

    // ---- PageSpeed Insights ------------------------------------------------
    // Runs last because the sample is chosen by PageRank, which needs the
    // complete link graph. Failures here degrade the report, never abort it.
    if (options.maxPagespeedPages > 0) {
      const targets = choosePagespeedTargets(site, options.maxPagespeedPages);
      onProgress({
        phase: 'pagespeed', crawled: pages.length, queued: targets.length,
        total: targets.length, currentUrl: null,
        message: `Measuring Core Web Vitals for ${targets.length} URL(s)`,
      });

      const { runPagespeedBatch } = await import('../core/pagespeed/client.ts');
      const run = await runPagespeedBatch(targets, (done, total, url) => {
        onProgress({
          phase: 'pagespeed', crawled: pages.length, queued: total - done,
          total, currentUrl: url || null,
          message: `Core Web Vitals ${done}/${total}` + (url ? ' — ' + url : ''),
        });
      });

      site.pagespeed = run.results;
      site.pagespeedErrors = run.errors;
      site.pagespeedAttempted = true;
    }

    return { site, options, durationMs: Date.now() - started };
  } finally {
    await browserPool?.close();
  }

}

/**
 * Choose which URLs to measure.
 *
 * The homepage always, at both strategies — mobile because it is the indexing
 * default, desktop because Sitechecker reports both and parity matters. Then the
 * next highest-PageRank pages at mobile only, because doubling the request count
 * to report a second desktop score for a secondary page is a poor use of a
 * rate-limited API.
 */
function choosePagespeedTargets(
  site: SiteData,
  limit: number,
): Array<{ url: string; strategy: 'mobile' | 'desktop' }> {
  const home = site.byUrl.get(site.homepageUrl)
    ?? site.pages.find((p) => p.isHtml && p.status === 200);
  if (!home) return [];

  const targets: Array<{ url: string; strategy: 'mobile' | 'desktop' }> = [
    { url: home.finalUrl, strategy: 'mobile' },
    { url: home.finalUrl, strategy: 'desktop' },
  ];

  const ranked = site.pages
    .filter((p) => p.isHtml && p.status === 200 && normalizeUrl(p.finalUrl) !== normalizeUrl(home.finalUrl))
    .sort((a, b) =>
      (site.pageRank.get(normalizeUrl(b.finalUrl)) ?? 0)
      - (site.pageRank.get(normalizeUrl(a.finalUrl)) ?? 0))
    .slice(0, Math.max(0, limit - 1));

  for (const p of ranked) targets.push({ url: p.finalUrl, strategy: 'mobile' });
  return targets;
}

// ---------------------------------------------------------------------------

interface AnalyseInput {
  origin: string;
  homepageUrl: string;
  startUrl: string;
  robots: SiteData['robots'];
  sitemaps: SiteData['sitemaps'];
  sitemapUrls: Set<string>;
  membership: Map<string, string[]>;
  includeSubdomains: boolean;
}

async function analyse(pages: PageData[], i: AnalyseInput): Promise<SiteData> {
  const byUrl = new Map<string, PageData>();
  for (const p of pages) {
    byUrl.set(normalizeUrl(p.finalUrl), p);
    // Also index the requested URL so link targets that redirected still resolve.
    if (normalizeUrl(p.url) !== normalizeUrl(p.finalUrl)) byUrl.set(normalizeUrl(p.url), p);
  }

  const htmlPages = pages.filter((p) => p.isHtml && p.status === 200);

  // ---- link graph --------------------------------------------------------
  const inbound = new Map<string, InboundLink[]>();
  const edges: Array<[string, string]> = [];
  const nodes = htmlPages.map((p) => normalizeUrl(p.finalUrl));

  for (const page of htmlPages) {
    const from = normalizeUrl(page.finalUrl);
    for (const link of page.links) {
      if (!link.isInternal || !link.href || link.isFragmentOnly) continue;
      const to = normalizeUrl(link.href);
      const list = inbound.get(to) ?? [];
      list.push({ ...link, fromUrl: page.finalUrl });
      inbound.set(to, list);
      if (!link.nofollow) edges.push([from, to]);
    }
  }

  const pr = computePageRank({ nodes, edges });
  const orphans = new Set<string>();
  for (const p of htmlPages) {
    const key = normalizeUrl(p.finalUrl);
    if (key === i.homepageUrl) continue;
    if ((inbound.get(key) ?? []).length === 0) orphans.add(key);
  }

  // ---- duplicate indexes -------------------------------------------------
  const group = (fn: (p: PageData) => string | null): Map<string, string[]> => {
    const m = new Map<string, string[]>();
    for (const p of htmlPages) {
      const k = fn(p);
      if (!k) continue;
      const list = m.get(k) ?? [];
      list.push(normalizeUrl(p.finalUrl));
      m.set(k, list);
    }
    for (const [k, v] of m) if (v.length < 2) m.delete(k);
    return m;
  };

  const duplicateTitles = group((p) => (p.title ?? '').trim().toLowerCase() || null);
  const duplicateH1s = group((p) => (p.h1s[0] ?? '').trim().toLowerCase() || null);
  const duplicateDescriptions = group((p) => (p.description ?? '').trim().toLowerCase() || null);
  const duplicateContent = group((p) => p.bodyText.length > 200 ? contentKey(p.bodyText) : null);

  // ---- transport / security ---------------------------------------------
  const home = byUrl.get(i.homepageUrl) ?? htmlPages[0];
  const ssl = await checkSsl(i.origin);
  const security = readSecurityHeaders(home);
  const httpsRedirectWorks = await checkHttpsRedirect(i.origin);
  const hostRedirectConsistent = await checkHostRedirect(i.origin);
  const notFoundStatus = await checkNotFound(i.origin);

  const homepageIndexable = !!home
    && !home.metaRobots.some((r) => r.includes('noindex'))
    && !(home.xRobotsTag ?? '').includes('noindex');

  const faviconFound = !!home?.favicon || await headOk(new URL('/favicon.ico', i.origin).toString());

  const redirectTargets = new Map<string, string>();
  for (const p of pages) {
    for (const hop of p.redirectChain) {
      try { redirectTargets.set(normalizeUrl(hop.url), new URL(hop.location, hop.url).toString()); }
      catch { /* malformed Location */ }
    }
  }

  return {
    origin: i.origin,
    homepageUrl: i.homepageUrl,
    startUrl: i.startUrl,
    pages,
    byUrl,
    robots: i.robots,
    sitemaps: i.sitemaps,
    sitemapUrls: i.sitemapUrls,
    sitemapMembership: i.membership,
    inbound,
    pageRank: pr.rank,
    orphans,
    duplicateTitles,
    duplicateH1s,
    duplicateDescriptions,
    duplicateContent,
    ssl,
    security,
    httpsRedirectWorks,
    hostRedirectConsistent,
    notFoundStatus,
    homepageIndexable,
    faviconFound,
    // One verdict for the site from the per-page fingerprints: pages can
    // legitimately differ (a WordPress blog in front of an app), so the
    // platform seen on the most pages wins.
    platform: aggregatePlatform(pages.filter((p) => p.isHtml).map((p) => p.platform)),
    hasSearchConsole: false,
    gsc: null,
    ga4: null,
    hasGa4: false,
    // Populated by the PageSpeed phase, which runs after this returns because
    // its sample depends on the PageRank computed here.
    pagespeed: [],
    pagespeedErrors: [],
    pagespeedAttempted: false,
    renderJs: false,
    renderFailures: [],
    redirectTargets,
  };
}

// ---------------------------------------------------------------------------

function readSecurityHeaders(page: PageData | undefined): SecurityHeaders {
  const h = page?.headers ?? {};
  const server = [h['server'], h['x-powered-by']].filter(Boolean).join(' ');
  return {
    xss: !!h['content-security-policy'] || !!h['x-xss-protection'],
    frameOptions: !!h['x-frame-options']
      || (h['content-security-policy'] ?? '').includes('frame-ancestors'),
    contentTypeOptions: (h['x-content-type-options'] ?? '').toLowerCase() === 'nosniff',
    hsts: !!h['strict-transport-security'],
    // Only report when a version number is actually exposed.
    serverVersionExposed: /\d+\.\d+/.test(server) ? server : null,
    setsCookies: !!h['set-cookie'],
  };
}

async function checkSsl(origin: string): Promise<SslInfo> {
  if (!origin.startsWith('https://')) {
    return { valid: false, validTo: null, daysRemaining: null, error: 'site is not served over HTTPS' };
  }
  try {
    const { connect } = await import('node:tls');
    const host = new URL(origin).hostname;
    return await new Promise<SslInfo>((resolve) => {
      const socket = connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
        const cert = socket.getPeerCertificate();
        const authorized = socket.authorized;
        const validTo = cert?.valid_to ?? null;
        const daysRemaining = validTo
          ? Math.round((Date.parse(validTo) - Date.now()) / 86_400_000) : null;
        socket.end();
        resolve({
          valid: authorized,
          validTo,
          daysRemaining,
          error: authorized ? null : (socket.authorizationError?.toString() ?? 'not authorized'),
        });
      });
      socket.on('error', (e) => resolve({ valid: false, validTo: null, daysRemaining: null, error: e.message }));
      socket.on('timeout', () => { socket.destroy(); resolve({ valid: false, validTo: null, daysRemaining: null, error: 'TLS handshake timeout' }); });
    });
  } catch (e) {
    return { valid: false, validTo: null, daysRemaining: null, error: (e as Error).message };
  }
}

async function checkHttpsRedirect(origin: string): Promise<boolean> {
  if (!origin.startsWith('https://')) return false;
  const httpUrl = origin.replace(/^https:/, 'http:');
  const r = await fetchUrl(httpUrl, 10_000, false);
  if (r.redirectChain.length === 0) return false;
  try { return new URL(r.finalUrl).protocol === 'https:'; } catch { return false; }
}

/** True when exactly one of www / non-www serves 200 and the other redirects. */
async function checkHostRedirect(origin: string): Promise<boolean> {
  try {
    const u = new URL(origin);
    const isWww = u.hostname.startsWith('www.');
    const other = new URL(origin);
    other.hostname = isWww ? u.hostname.replace(/^www\./, '') : 'www.' + u.hostname;

    const r = await fetchUrl(other.toString(), 10_000, false);
    if (r.status === 0) return true; // other host does not resolve at all: unambiguous
    return r.redirectChain.length > 0;
  } catch { return true; }
}

async function checkNotFound(origin: string): Promise<number | null> {
  const probe = new URL('/sitechecker-404-probe-' + Date.now(), origin).toString();
  const r = await fetchUrl(probe, 10_000, false);
  return r.status || null;
}

async function headOk(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'user-agent': USER_AGENT } });
    return res.ok;
  } catch { return false; }
}
