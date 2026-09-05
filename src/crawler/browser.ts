/**
 * Headless browser layer for JavaScript rendering.
 *
 * Kept deliberately off the default path. Rendering costs 50-100x a raw fetch,
 * so it exists for sites whose content genuinely does not survive without it —
 * client-rendered SPAs — and is opt-in everywhere else.
 *
 * Three things keep it from becoming the bottleneck it usually is:
 *   1. One browser and one context per crawl job, with a page created and
 *      closed per URL. Launching a browser per URL is the classic mistake.
 *   2. Aggressive request blocking. Images, fonts, media and analytics have no
 *      bearing on the extracted DOM but dominate render time and memory.
 *   3. Guaranteed teardown. A leaked Chromium process survives the crawl and
 *      the dev server, and the user has no idea why their RAM is gone.
 */
import type { Browser, BrowserContext, Page } from 'playwright-core';

export interface RenderOptions {
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle';
  timeoutMs: number;
  /** block images/fonts/media/analytics during render */
  blockResources: boolean;
  userAgent: string;
}

export interface RenderResult {
  html: string;
  status: number;
  finalUrl: string;
  headers: Record<string, string>;
  /** console.error + uncaught exceptions raised while the page ran */
  consoleErrors: string[];
  ttfbMs: number;
  /** navigationStart -> domContentLoadedEventEnd */
  domContentLoadedMs: number;
  /** navigationStart -> loadEventEnd */
  loadCompleteMs: number;
  totalMs: number;
  error: string | null;
  timedOut: boolean;
}

/** Extensions with no bearing on the extracted DOM. */
const BLOCKED_EXTENSIONS = /\.(png|jpe?g|webp|avif|gif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|avi|mov)(\?|$)/i;

/** Third parties that cost time and never change what we extract. */
const BLOCKED_HOSTS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'connect.facebook.net', 'hotjar.com', 'clarity.ms',
  'segment.io', 'segment.com', 'intercom.io', 'mixpanel.com',
  'fullstory.com', 'amplitude.com', 'sentry.io', 'newrelic.com',
  'googlesyndication.com', 'adservice.google.com', 'criteo.com',
];

// ---------------------------------------------------------------------------

export class BrowserPool {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private launching: Promise<void> | null = null;
  private closed = false;
  private readonly userAgent: string;

  // Declared and assigned separately rather than as a constructor parameter
  // property: this project runs .ts directly under Node's strip-only mode,
  // which rejects `constructor(private x: string)` outright.
  constructor(userAgent: string) {
    this.userAgent = userAgent;
  }

  /**
   * Resolve a Chromium binary without requiring a download.
   *
   * `npm install` deliberately does not fetch browsers — that would turn a
   * 5-second install into a 300 MB one for a feature most crawls never use. So
   * we try the Playwright-managed build, then the system Chrome or Edge that
   * almost every machine already has.
   */
  private async launch(): Promise<void> {
    const { chromium } = await import('playwright-core').catch(() => {
      throw new Error(
        'playwright-core is not installed. Run: npm install playwright-core',
      );
    });

    const args = [
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ];

    const attempts: Array<{ label: string; options: Record<string, unknown> }> = [];

    const explicit = process.env['PLAYWRIGHT_CHROMIUM_PATH']?.trim();
    if (explicit) attempts.push({ label: 'PLAYWRIGHT_CHROMIUM_PATH', options: { executablePath: explicit } });

    // Playwright's own build, if `npx playwright install chromium` has been run.
    try {
      const { existsSync } = await import('node:fs');
      const bundled = chromium.executablePath();
      if (bundled && existsSync(bundled)) {
        attempts.push({ label: 'bundled chromium', options: {} });
      }
    } catch { /* executablePath throws when no browsers are registered */ }

    attempts.push({ label: 'system Chrome', options: { channel: 'chrome' } });
    attempts.push({ label: 'system Edge', options: { channel: 'msedge' } });

    const failures: string[] = [];
    for (const attempt of attempts) {
      try {
        this.browser = await chromium.launch({ headless: true, args, ...attempt.options });
        break;
      } catch (err) {
        failures.push(`${attempt.label}: ${(err as Error).message.split('\n')[0]}`);
      }
    }

    if (!this.browser) {
      throw new Error(
        'Could not launch a Chromium browser for JavaScript rendering.\n' +
        'Install one with:  npx playwright install chromium\n' +
        'Or set PLAYWRIGHT_CHROMIUM_PATH to an existing Chrome/Edge binary.\n' +
        'Attempts:\n  ' + failures.join('\n  '),
      );
    }

    // One context for the whole crawl: pages are cheap, contexts are not, and
    // sharing cookies across pages of one site is the correct behaviour anyway.
    this.context = await this.browser.newContext({
      userAgent: this.userAgent,
      viewport: { width: 1280, height: 900 },
      ignoreHTTPSErrors: true,
      javaScriptEnabled: true,
      serviceWorkers: 'block',
    });
  }

  private async ensure(): Promise<BrowserContext> {
    if (this.closed) throw new Error('Browser pool has already been closed');
    if (this.context) return this.context;
    // Concurrent callers must not each launch a browser.
    this.launching ??= this.launch();
    await this.launching;
    if (!this.context) throw new Error('Browser context failed to initialise');
    return this.context;
  }

  /** True once a browser has actually started, for reporting. */
  get isLaunched(): boolean {
    return this.browser !== null;
  }

  async render(url: string, opts: RenderOptions): Promise<RenderResult> {
    const started = Date.now();
    const consoleErrors: string[] = [];
    let page: Page | null = null;

    const empty = (error: string, timedOut = false): RenderResult => ({
      html: '', status: 0, finalUrl: url, headers: {}, consoleErrors,
      ttfbMs: 0, domContentLoadedMs: 0, loadCompleteMs: 0,
      totalMs: Date.now() - started, error, timedOut,
    });

    try {
      const context = await this.ensure();
      page = await context.newPage();

      // ---- console + runtime errors -------------------------------------
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
      });
      page.on('pageerror', (err) => {
        consoleErrors.push(`Uncaught ${err.name}: ${err.message}`.slice(0, 300));
      });

      // ---- request blocking ---------------------------------------------
      if (opts.blockResources) {
        await page.route('**/*', (route) => {
          const req = route.request();
          const type = req.resourceType();
          const reqUrl = req.url();

          if (type === 'image' || type === 'media' || type === 'font') return route.abort();
          if (BLOCKED_EXTENSIONS.test(reqUrl)) return route.abort();
          if (BLOCKED_HOSTS.some((h) => reqUrl.includes(h))) return route.abort();
          return route.continue();
        });
      }

      const response = await page.goto(url, {
        waitUntil: opts.waitUntil,
        timeout: opts.timeoutMs,
      });

      const html = await page.content();

      // ---- timings from the Navigation Timing API ------------------------
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
        if (nav) {
          return {
            ttfb: Math.round(nav.responseStart),
            dcl: Math.round(nav.domContentLoadedEventEnd),
            load: Math.round(nav.loadEventEnd),
          };
        }
        return { ttfb: 0, dcl: 0, load: 0 };
      }).catch(() => ({ ttfb: 0, dcl: 0, load: 0 }));

      const headers: Record<string, string> = {};
      if (response) {
        for (const [k, v] of Object.entries(await response.allHeaders())) {
          headers[k.toLowerCase()] = v;
        }
      }

      return {
        html,
        status: response?.status() ?? 0,
        finalUrl: page.url(),
        headers,
        consoleErrors,
        ttfbMs: timing.ttfb,
        domContentLoadedMs: timing.dcl,
        loadCompleteMs: timing.load,
        totalMs: Date.now() - started,
        error: null,
        timedOut: false,
      };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      const timedOut = /timeout|Timeout/i.test(message);
      return empty(timedOut ? `render timeout after ${opts.timeoutMs}ms` : message.split('\n')[0]!, timedOut);
    } finally {
      // Closing the page, not the context, is what keeps memory flat across a
      // long crawl — an unclosed page holds its whole heap until GC decides.
      if (page) await page.close().catch(() => { /* already gone */ });
    }
  }

  /** Idempotent teardown. Safe to call from a finally block or an abort handler. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try { await this.context?.close(); } catch { /* already closed */ }
    try { await this.browser?.close(); } catch { /* already closed */ }
    this.context = null;
    this.browser = null;
  }
}

// ---------------------------------------------------------------------------
// SPA detection — used on the raw path to tell the user rendering would help
// ---------------------------------------------------------------------------

/** Framework mount points that are empty until JavaScript runs. */
const MOUNT_SELECTORS: Array<{ pattern: RegExp; framework: string }> = [
  { pattern: /<div[^>]+id=["']root["'][^>]*>\s*<\/div>/i, framework: 'React (CRA / Vite)' },
  { pattern: /<div[^>]+id=["']app["'][^>]*>\s*<\/div>/i, framework: 'Vue / Vite' },
  { pattern: /<app-root[^>]*>\s*<\/app-root>/i, framework: 'Angular' },
  { pattern: /<div[^>]+id=["']__next["'][^>]*>\s*<\/div>/i, framework: 'Next.js (empty shell)' },
  { pattern: /<div[^>]+id=["']svelte["'][^>]*>\s*<\/div>/i, framework: 'Svelte' },
  { pattern: /<div[^>]+id=["']__nuxt["'][^>]*>\s*<\/div>/i, framework: 'Nuxt (empty shell)' },
];

export interface SpaSignal {
  isClientRendered: boolean;
  framework: string | null;
  /** characters of visible body text found in the server response */
  serverTextLength: number;
}

/**
 * Detect a shell whose content only exists after hydration.
 *
 * Deliberately conservative: an empty mount point alone is not enough, because
 * a perfectly good SSR page can have an empty secondary container. It must also
 * ship essentially no body text, which is the thing that actually breaks
 * indexing.
 */
export function detectSpaShell(html: string, bodyTextLength: number): SpaSignal {
  for (const { pattern, framework } of MOUNT_SELECTORS) {
    if (pattern.test(html)) {
      return {
        isClientRendered: bodyTextLength < 200,
        framework,
        serverTextLength: bodyTextLength,
      };
    }
  }

  // No recognised mount point, but a script-heavy document with no text is
  // still a client-rendered shell — just from a framework we do not name.
  const hasScripts = /<script[^>]+src=/i.test(html);
  if (hasScripts && bodyTextLength < 100) {
    return { isClientRendered: true, framework: null, serverTextLength: bodyTextLength };
  }

  return { isClientRendered: false, framework: null, serverTextLength: bodyTextLength };
}
