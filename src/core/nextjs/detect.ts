import type {
  NextFingerprint, NextRouter, RenderStrategy, CacheState,
  NextImageUsage, NextFontUsage, MiddlewareSignals,
} from './types.ts';

export interface RawResponse {
  url: string;
  status: number;
  /** header names MUST be lowercased by the fetcher */
  headers: Record<string, string>;
  /** the HTML exactly as delivered, before any JS execution */
  html: string;
}

const CACHE_STATES = ['HIT', 'MISS', 'STALE', 'BYPASS', 'PRERENDER', 'REVALIDATED'] as const;

const num = (v: string | undefined | null): number | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const cacheState = (v: string | undefined): CacheState => {
  if (!v) return null;
  const u = v.trim().toUpperCase();
  return (CACHE_STATES as readonly string[]).includes(u) ? (u as CacheState) : null;
};

/** Pull one attribute out of a tag string. */
function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  if (!m) return null;
  return (m[2] ?? m[3] ?? m[4] ?? '').trim();
}

/** true when the attribute is present at all, including as a bare boolean attr */
function hasAttr(tag: string, name: string): boolean {
  return new RegExp('\\s' + name + '(\\s|=|>|/)', 'i').test(tag);
}

// ---------------------------------------------------------------------------
// Router + build identity
// ---------------------------------------------------------------------------

function detectRouter(html: string): { router: NextRouter; nextData: string | null } {
  const nextDataMatch = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  const hasPages = !!nextDataMatch;
  const hasApp = /self\.__next_f\s*\.\s*push\s*\(/.test(html);

  const router: NextRouter =
    hasPages && hasApp ? 'hybrid' : hasApp ? 'app' : hasPages ? 'pages' : 'unknown';

  return { router, nextData: nextDataMatch?.[1] ?? null };
}

/**
 * Build identity, used to detect "a deploy happened" and trigger a recrawl.
 * Four sources, most authoritative first — modern App Router builds no longer
 * emit _buildManifest.js, so the asset-path strategy alone misses them.
 */
function detectBuildId(
  html: string,
  nextData: Record<string, unknown> | null,
  headers: Record<string, string>,
): string | null {
  const b = nextData?.['buildId'];
  if (typeof b === 'string' && b) return b;

  if (headers['x-nextjs-deployment-id']) return headers['x-nextjs-deployment-id'];

  // Pages Router and older App Router: /_next/static/<buildId>/_buildManifest.js
  const manifest = html.match(/\/_next\/static\/([^/"']+)\/_(?:build|ssg)Manifest\.js/);
  if (manifest?.[1]) return manifest[1];

  // Next 15+ with deploymentId (and every Vercel deployment) stamps ?dpl=... on assets
  const dpl = html.match(/[?&]dpl=(dpl_[A-Za-z0-9_]+|[A-Za-z0-9_-]{8,})/);
  return dpl?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Rendering strategy — the headline diagnostic
// ---------------------------------------------------------------------------

interface StrategyInput {
  headers: Record<string, string>;
  html: string;
  router: NextRouter;
  pagesData: NextFingerprint['pagesData'];
  flight: NextFingerprint['flight'];
  cacheControl: string | null;
  sMaxAge: number | null;
}

function detectStrategy(i: StrategyInput): { strategy: RenderStrategy; evidence: string[] } {
  const ev: string[] = [];
  const h = i.headers;

  const nextCache = cacheState(h['x-nextjs-cache']);
  const vercelCache = cacheState(h['x-vercel-cache']);
  const prerendered = h['x-nextjs-prerender'] === '1' || vercelCache === 'PRERENDER';

  if (nextCache) ev.push('x-nextjs-cache: ' + nextCache);
  if (vercelCache) ev.push('x-vercel-cache: ' + vercelCache);
  if (i.cacheControl) ev.push('cache-control: ' + i.cacheControl);

  // Pages Router states its data-fetching mode outright in __NEXT_DATA__.
  if (i.pagesData?.gssp) {
    ev.push('__NEXT_DATA__.gssp = true (getServerSideProps)');
    return { strategy: 'ssr', evidence: ev };
  }
  if (i.pagesData?.gsp) {
    ev.push('__NEXT_DATA__.gsp = true (getStaticProps)');
    return { strategy: i.sMaxAge && i.sMaxAge > 0 ? 'isr' : 'static', evidence: ev };
  }

  // App Router: a Suspense boundary that never received its content means the
  // crawler was served loading.tsx skeleton markup instead of the real page.
  // Boundaries that opened and later resolved in the same stream are healthy.
  const unresolved = countUnresolvedSuspense(i.html);
  if (unresolved > 0) {
    ev.push(unresolved + ' Suspense boundary(ies) never resolved in this response');
    return { strategy: 'streaming', evidence: ev };
  }

  // A CDN hit proves the response was cacheable, so it is prerendered or ISR.
  // This must be tested BEFORE the uncacheable heuristic: static App Router pages
  // ship `cache-control: public, max-age=0, must-revalidate` and are cached at the
  // edge regardless, so max-age=0 on its own does not mean per-request rendering.
  const cdnHit = prerendered || nextCache === 'HIT' || nextCache === 'STALE' ||
    vercelCache === 'HIT' || vercelCache === 'STALE' || vercelCache === 'REVALIDATED';

  if (cdnHit) {
    const revalidating = (i.sMaxAge && i.sMaxAge > 0) || nextCache === 'STALE' || vercelCache === 'STALE';
    return { strategy: revalidating ? 'isr' : 'static', evidence: ev };
  }

  // no-store / private without any cache hit is force-dynamic or an uncached fetch.
  if (i.cacheControl && /no-store|private/.test(i.cacheControl)) {
    ev.push('response is explicitly uncacheable -> rendered per request');
    return { strategy: 'ssr', evidence: ev };
  }
  if (vercelCache === 'BYPASS' || nextCache === 'BYPASS') {
    ev.push('cache bypassed -> rendered per request');
    return { strategy: 'ssr', evidence: ev };
  }

  // Shell with no server-rendered body content: everything waits on hydration.
  const bodyText = extractBodyText(i.html);
  if (i.router !== 'unknown' && bodyText.length < 200) {
    ev.push('server HTML carries only ' + bodyText.length + ' chars of text -> content is client-rendered');
    return { strategy: 'client', evidence: ev };
  }

  if (i.sMaxAge && i.sMaxAge > 0) return { strategy: 'isr', evidence: ev };
  return { strategy: 'unknown', evidence: ev };
}

/** Visible text in body, with script/style/template stripped. */
export function extractBodyText(html: string): string {
  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? html;
  return body
    .replace(/<(script|style|noscript|template|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// RSC flight payload (App Router)
// ---------------------------------------------------------------------------

function parseFlight(html: string): NextFingerprint['flight'] {
  const pushes = html.match(/self\.__next_f\s*\.\s*push\s*\(/g);
  if (!pushes) return null;

  let bytes = 0;
  const re = /self\.__next_f\s*\.\s*push\s*\(\s*\[\s*\d+\s*,\s*("(?:[^"\\]|\\.)*")/g;
  for (let m = re.exec(html); m; m = re.exec(html)) bytes += (m[1]?.length ?? 0);

  return { chunkCount: pushes.length, bytes, hasUnresolvedSuspense: countUnresolvedSuspense(html) > 0 };
}

/**
 * Count Suspense boundaries whose content never arrived in this response.
 *
 * React's streaming runtime opens a pending boundary as `<!--$?-->` plus a
 * `<template id="B:n">` placeholder, then later flushes the real content and
 * calls `$RC("B:n","S:n")` to swap it in. A fully streamed document therefore
 * contains many pending markers that ARE resolved by the end of the byte stream.
 *
 * Naively testing for `<!--$?-->` reports every streamed page as broken — it is
 * the difference between "this page streams" (fine) and "this page shipped a
 * skeleton to Googlebot" (critical). Only a `B:n` with no matching `$RC` is a
 * real finding.
 */
export function countUnresolvedSuspense(html: string): number {
  const opened = new Set<string>();
  for (const m of html.matchAll(/<template[^>]+id=["']B:(\d+)["']/gi)) {
    if (m[1]) opened.add(m[1]);
  }
  if (opened.size === 0) return 0;

  for (const m of html.matchAll(/\$RC\s*\(\s*["']B:(\d+)["']/g)) {
    if (m[1]) opened.delete(m[1]);
  }
  return opened.size;
}

// ---------------------------------------------------------------------------
// next/image
// ---------------------------------------------------------------------------

function parseImages(html: string): NextImageUsage[] {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';
  const preloadedSrcs = new Set<string>();
  for (const tag of head.match(/<link[^>]*>/gi) ?? []) {
    if (/rel\s*=\s*["']?preload/i.test(tag) && /as\s*=\s*["']?image/i.test(tag)) {
      const href = attr(tag, 'href') ?? attr(tag, 'imagesrcset');
      if (href) preloadedSrcs.add(href);
    }
  }

  const out: NextImageUsage[] = [];
  for (const tag of html.match(/<img[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src') ?? '';
    const srcset = attr(tag, 'srcset') ?? '';
    const optimizerHit = src.includes('/_next/image?') || srcset.includes('/_next/image?');
    const nimg = attr(tag, 'data-nimg');

    const srcsetWidths = [...srcset.matchAll(/\s(\d+)w/g)]
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b);

    const qs = (src.match(/[?&]q=(\d+)/) ?? srcset.match(/[?&]q=(\d+)/))?.[1];

    out.push({
      src,
      isNextImage: optimizerHit || nimg !== null,
      layout: nimg,
      width: num(attr(tag, 'width')),
      height: num(attr(tag, 'height')),
      sizes: attr(tag, 'sizes'),
      loading: attr(tag, 'loading'),
      fetchPriority: attr(tag, 'fetchpriority'),
      // data-nimg present but the optimizer endpoint absent => unoptimized or custom loader
      unoptimized: nimg !== null && !optimizerHit,
      quality: num(qs ?? null),
      srcsetWidths,
      preloaded: !!src && [...preloadedSrcs].some((p) => p === src || p.includes(src)),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// next/font
// ---------------------------------------------------------------------------

const EXTERNAL_FONT_HOSTS =
  /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fast\.fonts\.net|@fontsource/i;

function parseFonts(html: string): NextFontUsage {
  // next/font emits hashed utility classes: __className_1a2b3c, __variable_1a2b3c
  const selfHostedClasses = [...new Set(
    [...html.matchAll(/__(?:className|variable)_[a-z0-9]+/gi)].map((m) => m[0]),
  )];

  const selfHostedFiles = [...new Set(
    [...html.matchAll(/\/_next\/static\/media\/[^"')\s]+\.(?:woff2?|ttf|otf)/gi)].map((m) => m[0]),
  )];

  const externalStylesheets: string[] = [];
  for (const tag of html.match(/<link[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href') ?? '';
    const isStyle =
      /rel\s*=\s*["']?stylesheet/i.test(tag) || /as\s*=\s*["']?(font|style)/i.test(tag);
    if (isStyle && EXTERNAL_FONT_HOSTS.test(href)) externalStylesheets.push(href);
  }

  const faces = html.match(/@font-face\s*\{[^}]*\}/gi) ?? [];
  const faceCountWithoutDisplay = faces.filter((f) => !/font-display\s*:/i.test(f)).length;

  return { selfHostedClasses, selfHostedFiles, externalStylesheets, faceCountWithoutDisplay };
}

// ---------------------------------------------------------------------------

function parseMiddleware(h: Record<string, string>): MiddlewareSignals {
  const rewrote = 'x-middleware-rewrite' in h;
  return {
    present:
      rewrote || 'x-middleware-next' in h || 'x-middleware-set-cookie' in h || 'x-matched-path' in h,
    rewrote,
    matchedPath: h['x-matched-path'] ?? h['x-middleware-rewrite'] ?? null,
    setCookie: 'x-middleware-set-cookie' in h,
  };
}

function parseScripts(html: string): { blocking: string[]; route: string[] } {
  const blocking: string[] = [];
  const route: string[] = [];
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';

  for (const tag of html.match(/<script[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src');
    if (!src) continue;
    if (src.includes('/_next/static/')) {
      route.push(src);
      continue;
    }
    // next/script strategy="beforeInteractive" hoists into head with no defer/async
    if (head.includes(tag) && !hasAttr(tag, 'defer') && !hasAttr(tag, 'async')) {
      blocking.push(src);
    }
  }
  return { blocking, route };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function fingerprintNext(res: RawResponse): NextFingerprint {
  const { headers: h, html } = res;
  const { router, nextData } = detectRouter(html);

  const poweredByNext = (h['x-powered-by'] ?? '').toLowerCase().includes('next.js');
  const hasNextAssets = html.includes('/_next/static/');
  const isNext = router !== 'unknown' || poweredByNext || hasNextAssets;

  let parsedNextData: Record<string, unknown> | null = null;
  if (nextData) {
    try {
      parsedNextData = JSON.parse(nextData) as Record<string, unknown>;
    } catch {
      /* malformed __NEXT_DATA__ is itself a finding; the check pack reports it */
    }
  }

  const pagesData: NextFingerprint['pagesData'] = parsedNextData
    ? {
        gsp: parsedNextData['gsp'] === true,
        gssp: parsedNextData['gssp'] === true,
        isFallback: parsedNextData['isFallback'] === true,
        propsBytes: JSON.stringify(parsedNextData['props'] ?? {}).length,
      }
    : null;

  const flight = parseFlight(html);

  const cacheControl = h['cache-control'] ?? null;
  const sMaxAge = num(cacheControl?.match(/s-maxage=(\d+)/)?.[1]);
  const swr = num(cacheControl?.match(/stale-while-revalidate(?:=(\d+))?/)?.[1]);

  const { strategy, evidence } = detectStrategy({
    headers: h, html, router, pagesData, flight, cacheControl, sMaxAge,
  });

  const scripts = parseScripts(html);

  return {
    isNext,
    buildId: detectBuildId(html, parsedNextData, h),
    version: h['x-nextjs-version'] ?? null,
    router,
    strategy,
    strategyEvidence: evidence,
    cache: {
      nextCache: cacheState(h['x-nextjs-cache']),
      vercelCache: cacheState(h['x-vercel-cache']),
      cacheControl,
      sMaxAge,
      staleWhileRevalidate: swr,
      age: num(h['age']),
    },
    pagesData,
    flight,
    images: parseImages(html),
    fonts: parseFonts(html),
    middleware: parseMiddleware(h),
    blockingScripts: scripts.blocking,
    routeScripts: [...new Set(scripts.route)],
  };
}
