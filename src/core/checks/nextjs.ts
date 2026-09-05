/**
 * Next.js — 15 checks.
 *
 * Every check here is invisible to a general-purpose crawler. Sitechecker,
 * Ahrefs, Semrush, Screaming Frog and Sitebulb all reason about rendered HTML
 * only, so they report the symptom ("this page is slow", "text-to-code ratio is
 * low") but never the Next.js cause. These name the cause.
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck } from './types.ts';
import { extractBodyText, countUnresolvedSuspense } from '../nextjs/detect.ts';
import type { PageData } from '../extract.ts';

const isNext = (p: PageData) => p.next.isNext && p.isHtml && p.status === 200;

const pageChecks: PageCheck[] = [
  pageCheck({
    id: 'next.render.unresolved-suspense',
    title: 'Suspense boundary never resolved — crawler received a skeleton',
    category: 'nextjs', severity: 'blocker', requiresNext: true,
    why: 'A Suspense boundary opened during streaming SSR but its content never arrived in the response. Googlebot indexes what it receives, so the indexed copy of this page is the loading.tsx skeleton rather than the real content. This is the most damaging App Router defect and it is invisible to any tool that inspects only the final hydrated DOM.',
    fix: 'Find the boundary whose data never settles — usually an await on a fetch with no timeout, a stalling third-party API, or a generateStaticParams miss forcing on-demand render past the streaming budget. Give the fetch an explicit timeout, or move it above the boundary so it blocks the initial flush instead of streaming late.',
    appliesTo: isNext,
    test: (p) => {
      const n = countUnresolvedSuspense(p.html);
      return n > 0 ? n + ' boundary(ies) opened but never received content' : false;
    },
  }),
  pageCheck({
    id: 'next.render.client-only-content',
    title: 'Page content requires hydration to exist',
    category: 'nextjs', severity: 'blocker', requiresNext: true,
    why: 'The server response carries almost no text. The page is a shell whose content is fetched client-side, typically a client component calling useEffect. Google can render JavaScript but does so on a deferred, budgeted queue; other crawlers, LLM retrievers and social unfurlers generally do not render at all.',
    fix: 'Move the data fetch into the Server Component and pass results down as props, or use a Server Action. Keep useEffect only for genuinely interactive post-load state.',
    appliesTo: isNext,
    test: (p) => {
      const text = extractBodyText(p.html);
      return text.length < 200 ? 'only ' + text.length + ' chars of body text server-rendered' : false;
    },
  }),
  pageCheck({
    id: 'next.render.unexpectedly-dynamic',
    title: 'Route renders per request but has no per-request content',
    category: 'nextjs', severity: 'critical', requiresNext: true,
    why: 'The response is uncacheable, so every visitor and every crawler request pays full server render cost, multiplying TTFB across the crawl budget. Most such routes are dynamic by accident: one call to cookies(), headers() or searchParams opts the entire segment out of static generation.',
    fix: 'Run next build and check the route legend — ƒ means dynamic, ○ static, ● SSG. Remove the dynamic API call, or isolate it behind its own Suspense boundary so only that subtree is dynamic. If data changes on a schedule, use export const revalidate = N for ISR.',
    appliesTo: isNext,
    test: (p) => {
      if (p.next.strategy !== 'ssr') return false;
      try { if (new URL(p.finalUrl).search) return false; } catch { /* keep going */ }
      return 'strategy=ssr; ' + p.next.strategyEvidence.join('; ');
    },
  }),
  pageCheck({
    id: 'next.image.raw-img-tag',
    title: 'Raw <img> bypasses the Next.js image optimizer',
    category: 'nextjs', severity: 'warning', requiresNext: true,
    why: 'These images skip format negotiation (AVIF/WebP), responsive srcset generation and automatic dimensions, so full-size originals ship to phones and contribute avoidable layout shift.',
    fix: 'Replace with next/image. For remote sources add the host to images.remotePatterns in next.config.',
    appliesTo: isNext,
    test: (p) => {
      const raw = p.images.filter((i) => !i.isNextImage && i.src && !i.src.startsWith('data:'));
      return raw.length ? raw.length + ' raw <img> element(s)' : false;
    },
  }),
  pageCheck({
    id: 'next.image.lcp-not-prioritised',
    title: 'Likely LCP image is lazy-loaded',
    category: 'nextjs', severity: 'warning', requiresNext: true,
    why: 'next/image lazy-loads by default. When the largest above-the-fold image is lazy, the browser cannot start fetching until layout completes, delaying Largest Contentful Paint by hundreds of milliseconds on mobile.',
    fix: 'Add the priority prop to the hero image. Next then emits fetchpriority="high" and a preload link so the fetch starts during HTML parse. Use it on exactly one image per route.',
    appliesTo: isNext,
    test: (p) => {
      const imgs = p.next.images.filter((i) => i.isNextImage);
      if (imgs.length === 0) return false;
      if (imgs.some((i) => i.preloaded || i.fetchPriority === 'high')) return false;
      const candidate = imgs.find((i) => (i.width ?? 0) * (i.height ?? 0) > 40_000)
        ?? imgs.find((i) => i.layout === 'fill');
      if (!candidate) return false;
      if (candidate.loading !== 'lazy' && candidate.loading !== null) return false;
      return 'no image sets priority; likely LCP candidate is ' + candidate.src.slice(0, 80);
    },
  }),
  pageCheck({
    id: 'next.image.fill-without-sizes',
    title: 'next/image fill without a sizes attribute',
    category: 'nextjs', severity: 'warning', requiresNext: true,
    why: 'With fill and no sizes, Next assumes the image spans the full viewport and the browser selects the largest srcset candidate — often a 3840px file inside a 400px card. One of the most common sources of wasted mobile bandwidth in Next apps.',
    fix: 'Add a sizes prop describing the rendered width at each breakpoint, e.g. sizes="(max-width: 768px) 100vw, 33vw".',
    appliesTo: isNext,
    test: (p) => {
      const bad = p.next.images.filter((i) => i.isNextImage && i.layout === 'fill' && !i.sizes);
      if (!bad.length) return false;
      const wasted = bad.filter((i) => (i.srcsetWidths.at(-1) ?? 0) >= 1920).length;
      return bad.length + ' fill image(s) without sizes'
        + (wasted ? '; ' + wasted + ' offer candidates ≥1920px' : '');
    },
  }),
  pageCheck({
    id: 'next.image.unoptimized',
    title: 'next/image with the optimizer disabled',
    category: 'nextjs', severity: 'opportunity', requiresNext: true,
    why: 'The unoptimized prop or a custom loader bypasses format conversion and resizing, so the component provides layout stability but none of the bandwidth benefit.',
    fix: 'Remove unoptimized where possible. If a custom loader is required, ensure it performs equivalent resizing and format negotiation.',
    appliesTo: isNext,
    test: (p) => {
      const n = p.next.images.filter((i) => i.unoptimized).length;
      return n ? n + ' unoptimized next/image element(s)' : false;
    },
  }),
  pageCheck({
    id: 'next.font.external-blocking',
    title: 'Render-blocking external font stylesheet',
    category: 'nextjs', severity: 'warning', requiresNext: true,
    why: 'A link to fonts.googleapis.com blocks first render behind a third-party DNS lookup, TLS handshake and round trip, then a second round trip to fonts.gstatic.com for the files. next/font exists specifically to remove this.',
    fix: 'Use next/font/google and apply the generated className. Zero runtime requests to Google, and no layout shift because Next computes a size-adjusted fallback automatically.',
    appliesTo: isNext,
    test: (p) => {
      const ext = p.next.fonts.externalStylesheets;
      return ext.length ? ext.length + ' external font stylesheet(s)' : false;
    },
  }),
  pageCheck({
    id: 'next.payload.rsc-bloat',
    title: 'Inline RSC flight payload dominates the HTML response',
    category: 'nextjs', severity: 'warning', requiresNext: true,
    why: 'App Router serialises the React tree into inline self.__next_f.push() scripts. When this exceeds roughly half the document it inflates TTFB and transfer size on every request — and it is what drags the text-to-code ratio down, the symptom generic crawlers report without ever identifying the cause.',
    fix: 'Pass less data across the server/client boundary. Select only the fields client components need rather than forwarding whole API objects, and check for entire collections being serialised when the page renders only the first ten rows.',
    appliesTo: isNext,
    test: (p) => {
      const f = p.next.flight;
      if (!f || p.bytes === 0) return false;
      const ratio = f.bytes / p.bytes;
      if (ratio < 0.45 || f.bytes < 100_000) return false;
      return Math.round(f.bytes / 1024) + ' KB = ' + Math.round(ratio * 100) + '% of the response';
    },
  }),
  pageCheck({
    id: 'next.payload.props-bloat',
    title: '__NEXT_DATA__ props payload is oversized',
    category: 'nextjs', severity: 'warning', requiresNext: true,
    why: 'Everything returned from getStaticProps or getServerSideProps is embedded in the HTML and shipped to every visitor whether the page renders it or not. Large payloads are usually an un-narrowed CMS or database response.',
    fix: 'Return only the fields the page renders. Paginate lists rather than embedding them whole.',
    appliesTo: isNext,
    test: (p) => {
      const d = p.next.pagesData;
      return d && d.propsBytes >= 128_000 ? Math.round(d.propsBytes / 1024) + ' KB of pageProps' : false;
    },
  }),
  pageCheck({
    id: 'next.script.blocking',
    title: 'Render-blocking third-party script in <head>',
    category: 'nextjs', severity: 'warning', requiresNext: true,
    why: 'A head script with neither defer nor async halts HTML parsing until it downloads and executes. In Next this is almost always next/script with strategy="beforeInteractive", intended only for scripts that must run before hydration.',
    fix: 'Use the default afterInteractive for analytics and tag managers, or lazyOnload for chat widgets. Reserve beforeInteractive for scripts that genuinely cannot run later.',
    appliesTo: isNext,
    test: (p) => {
      const n = p.next.blockingScripts.length;
      return n ? n + ' blocking script(s)' : false;
    },
  }),
  pageCheck({
    id: 'next.metadata.relative-og-image',
    title: 'Open Graph image is relative — metadataBase is probably missing',
    category: 'nextjs', severity: 'warning', requiresNext: true,
    why: 'Social crawlers require absolute image URLs. In the App Router, a relative og:image almost always means metadataBase is unset in the root layout, so Next cannot expand the path. Previews render with no image at all.',
    fix: 'Set metadataBase: new URL(process.env.SITE_URL) in your root layout metadata export.',
    appliesTo: isNext,
    test: (p) => {
      if (p.next.router !== 'app') return false;
      const img = p.og['image'];
      return img && !/^https?:\/\//i.test(img) ? 'og:image = ' + img : false;
    },
  }),
];

const siteChecks: SiteCheck[] = [
  siteCheck({
    id: 'next.build.drift-during-crawl',
    title: 'Deployment changed mid-crawl',
    category: 'nextjs', severity: 'notice', requiresNext: true,
    why: 'More than one build id was observed across the crawl, so the report mixes pages from different deployments. Issues may appear fixed or introduced purely as an artefact of that timing.',
    fix: 'Re-run against a stable deployment. Wiring the crawler to your deploy webhook and pinning each crawl to a single build id removes this class of false positive.',
    test: (site) => {
      const ids = new Set(site.pages.map((p) => p.next.buildId).filter(Boolean));
      return ids.size > 1 ? ids.size + ' build ids: ' + [...ids].join(', ') : false;
    },
  }),
  siteCheck({
    id: 'next.router.mixed',
    title: 'App Router and Pages Router both in use',
    category: 'nextjs', severity: 'opportunity', requiresNext: true,
    why: 'A part-migrated codebase runs two rendering pipelines with separate metadata systems, data fetching and caching. Divergent canonical and Open Graph handling between the two is a common source of duplicate-content findings.',
    fix: 'Track which routes remain on the Pages Router and migrate them. Until then, verify both pipelines emit identical canonical, hreflang and Open Graph conventions.',
    test: (site) => {
      const app = site.pages.filter((p) => p.next.router === 'app').length;
      const pages = site.pages.filter((p) => p.next.router === 'pages').length;
      const hybrid = site.pages.some((p) => p.next.router === 'hybrid');
      return (app > 0 && pages > 0) || hybrid
        ? app + ' App Router route(s), ' + pages + ' Pages Router route(s)' : false;
    },
  }),
  siteCheck({
    id: 'next.render.strategy-summary',
    title: 'All routes render dynamically',
    category: 'nextjs', severity: 'critical', requiresNext: true,
    why: 'No route on the site is statically generated or cached at the edge. Every request renders from scratch, which is the single largest avoidable cost in a Next.js deployment.',
    fix: 'Identify which routes genuinely need per-request data. Most marketing and content routes should be static or ISR.',
    test: (site) => {
      const next = site.pages.filter((p) => p.next.isNext && p.isHtml && p.status === 200);
      if (next.length < 3) return false;
      const dynamic = next.filter((p) => p.next.strategy === 'ssr').length;
      return dynamic === next.length ? 'all ' + next.length + ' routes are SSR' : false;
    },
  }),
];

export const NEXTJS_CHECKS = [...pageChecks, ...siteChecks];
