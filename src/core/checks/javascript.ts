/**
 * JavaScript rendering checks.
 *
 * Two of these fire only on the rendered path, because they need a browser to
 * have actually executed the page. The SPA-detection notice is the opposite: it
 * runs on the *raw* path, to tell you that a rendered crawl would see something
 * quite different from what you are currently looking at.
 */
import { pageCheck, type PageCheck } from './types.ts';
import type { PageData } from '../extract.ts';

const rendered = (p: PageData) => p.renderedWithJs && p.isHtml && p.status === 200;
const raw = (p: PageData) => !p.renderedWithJs && p.isHtml && p.status === 200;

export const JS_CHECKS: PageCheck[] = [
  pageCheck({
    id: 'spa.client-rendering-detected',
    title: 'Client-side rendering detected — re-crawl with JavaScript rendering',
    category: 'content-relevance',
    severity: 'notice',
    why:
      'The server response is an empty framework mount point with essentially no body text, so this crawl is auditing a shell rather than the page a user sees. Google renders JavaScript on a deferred, budgeted queue, and most other crawlers, LLM retrievers and social unfurlers do not render at all — so the shell is what many consumers actually index.',
    fix:
      'Re-run the crawl with JavaScript rendering enabled (--render-js, or the toggle in crawl settings) to audit the hydrated DOM. For the underlying problem, server-render the content: it is the only way non-rendering consumers ever see it.',
    appliesTo: raw,
    test: (p) => {
      if (!p.isClientRenderedShell) return false;
      return p.spaFramework
        ? `${p.spaFramework} shell with ${p.serverTextLength} chars of server-rendered text`
        : `client-rendered shell with ${p.serverTextLength} chars of server-rendered text`;
    },
  }),

  pageCheck({
    id: 'js.empty-root-fallback',
    title: 'DOM failed to mount — container still empty after rendering',
    category: 'content-relevance',
    severity: 'blocker',
    why:
      'The page was rendered in a real browser and the mount point is still empty. This is not a crawling limitation — the application genuinely failed to boot, so every visitor sees a blank page. Usually a runtime exception during mount, a failed chunk request, or a hydration mismatch that unmounted the tree.',
    fix:
      'Check the console errors captured alongside this finding — the first uncaught exception is almost always the cause. Verify every JavaScript chunk returns 200 and that no framework-level error boundary is swallowing a mount failure.',
    appliesTo: rendered,
    test: (p) => {
      // Rendered, yet still no content: the framework never mounted.
      if (p.textLength >= 200) return false;
      const detail = p.spaFramework ? `${p.spaFramework} mount point` : 'root container';
      return `${detail} still empty after JavaScript execution (${p.textLength} chars of text)`
        + (p.jsConsoleErrors.length ? `; first error: ${p.jsConsoleErrors[0]}` : '');
    },
  }),

  pageCheck({
    id: 'js.console-errors-present',
    title: 'JavaScript runtime errors during rendering',
    category: 'code-validation',
    severity: 'warning',
    why:
      'Uncaught exceptions and console errors raised while the page loaded. Even when the page appears to work, a runtime error means some code path did not complete — commonly the one that would have set metadata, loaded content below the fold, or fired analytics.',
    fix:
      'Fix the errors listed in the detail. Errors originating from third-party scripts still cost main-thread time and can block your own code from running.',
    appliesTo: rendered,
    test: (p) => {
      if (p.jsConsoleErrors.length === 0) return false;
      const first = p.jsConsoleErrors[0]!;
      return `${p.jsConsoleErrors.length} error(s); first: ${first.slice(0, 160)}`;
    },
  }),

  pageCheck({
    id: 'js.client-injected-meta',
    title: 'Title or canonical only exists after hydration',
    category: 'indexability',
    severity: 'notice',
    why:
      'Metadata injected by client-side JavaScript is absent from the server response. Google will usually pick it up on the render pass, but social crawlers and LLM retrievers read the raw HTML and will see the fallback — which is why shared links so often show the wrong title.',
    fix:
      'Emit title, description and canonical server-side. In Next.js use the Metadata API; in a Vite or CRA SPA, prerender the routes or move to a framework that renders metadata on the server.',
    appliesTo: rendered,
    test: (p) => {
      // Only meaningful when the server response was a shell: on an SSR page
      // the metadata was already there and nothing was injected.
      if (!p.isClientRenderedShell) return false;
      const injected: string[] = [];
      if (p.title) injected.push('title');
      if (p.canonical) injected.push('canonical');
      if (p.description) injected.push('description');
      return injected.length > 0
        ? `${injected.join(', ')} present only after hydration` : false;
    },
  }),

  pageCheck({
    id: 'js.hydration-content-gap',
    title: 'Most page content requires JavaScript',
    category: 'content-relevance',
    severity: 'critical',
    why:
      'The rendered DOM contains substantially more text than the server response. That gap is content invisible to any consumer that does not execute JavaScript, and it is deferred even for those that do.',
    fix:
      'Move data fetching to the server so the content ships in the initial HTML. Keep client-side fetching for genuinely interactive, post-load state.',
    appliesTo: rendered,
    test: (p) => {
      if (p.textLength < 200) return false; // the empty-mount check owns this case
      if (p.serverTextLength >= p.textLength * 0.5) return false;
      const pct = Math.round((1 - p.serverTextLength / p.textLength) * 100);
      return `${pct}% of body text appears only after hydration `
        + `(${p.serverTextLength} chars server-rendered vs ${p.textLength} after JS)`;
    },
  }),
];
