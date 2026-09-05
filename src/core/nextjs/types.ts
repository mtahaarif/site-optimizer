/**
 * Next.js runtime fingerprint, derived from a single HTTP response.
 *
 * Everything here is recoverable black-box (headers + HTML), which means it works
 * on any deployed Next.js site with no repo access. The white-box analyser in
 * ../buildinfo/ enriches these fields when the .next/ directory is available.
 */

export type NextRouter = 'app' | 'pages' | 'hybrid' | 'unknown';

/**
 * How the page was produced. This is the single most important SEO fact about a
 * Next.js route and no general-purpose crawler reports it.
 */
export type RenderStrategy =
  | 'static'        // prerendered at build time, no revalidate
  | 'isr'           // prerendered + revalidate window
  | 'ssr'           // rendered per request
  | 'streaming'     // SSR with unresolved Suspense boundaries in the initial flush
  | 'client'        // shell only; meaningful content requires hydration
  | 'unknown';

export type CacheState = 'HIT' | 'MISS' | 'STALE' | 'BYPASS' | 'PRERENDER' | 'REVALIDATED' | null;

export interface NextImageUsage {
  src: string;
  /** next/image stamps data-nimg; absence means a raw <img> slipped through */
  isNextImage: boolean;
  /** data-nimg value: "1" (intrinsic), "fill", "responsive" */
  layout: string | null;
  width: number | null;
  height: number | null;
  sizes: string | null;
  loading: string | null;
  fetchPriority: string | null;
  /** true when the optimizer is bypassed (unoptimized prop or external loader) */
  unoptimized: boolean;
  /** quality parsed out of /_next/image?q= */
  quality: number | null;
  /** widths offered in srcset, ascending */
  srcsetWidths: number[];
  /** appears above the fold per <link rel=preload as=image> in <head> */
  preloaded: boolean;
}

export interface NextFontUsage {
  /** next/font generates hashed class names: __className_1a2b3c / __variable_1a2b3c */
  selfHostedClasses: string[];
  /** self-hosted font files under /_next/static/media */
  selfHostedFiles: string[];
  /** render-blocking external font stylesheets — the thing next/font exists to remove */
  externalStylesheets: string[];
  /** @font-face blocks missing font-display */
  faceCountWithoutDisplay: number;
}

export interface MiddlewareSignals {
  present: boolean;
  rewrote: boolean;
  matchedPath: string | null;
  setCookie: boolean;
}

export interface NextFingerprint {
  isNext: boolean;
  /** parsed from /_next/static/<buildId>/_buildManifest.js or __NEXT_DATA__.buildId */
  buildId: string | null;
  version: string | null;
  router: NextRouter;
  strategy: RenderStrategy;
  /** why we concluded `strategy` — surfaced in the UI so the verdict is auditable */
  strategyEvidence: string[];

  cache: {
    nextCache: CacheState;
    vercelCache: CacheState;
    cacheControl: string | null;
    /** s-maxage, i.e. the ISR revalidate window in seconds */
    sMaxAge: number | null;
    staleWhileRevalidate: number | null;
    age: number | null;
  };

  /** Pages Router only — __NEXT_DATA__ states the data-fetching mode outright */
  pagesData: {
    gsp: boolean;          // getStaticProps
    gssp: boolean;         // getServerSideProps
    isFallback: boolean;
    /** serialized pageProps byte size — bloat here is shipped to every visitor */
    propsBytes: number;
  } | null;

  /** App Router only — inline RSC flight payload */
  flight: {
    chunkCount: number;
    /** total bytes of inline flight payload; counts against text-to-code ratio */
    bytes: number;
    /** React streaming placeholders present => Suspense unresolved at first flush */
    hasUnresolvedSuspense: boolean;
  } | null;

  images: NextImageUsage[];
  fonts: NextFontUsage;
  middleware: MiddlewareSignals;

  /** scripts injected with next/script beforeInteractive block hydration */
  blockingScripts: string[];
  /** absolute JS transferred for this route, from <script src> under /_next/static */
  routeScripts: string[];
}
