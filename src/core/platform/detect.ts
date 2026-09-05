/**
 * Platform and framework fingerprinting from one HTTP response.
 *
 * Deliberately evidence-based rather than a single guess: each rule contributes
 * a confidence and a human-readable reason, and the report shows the reasons.
 * A verdict a user cannot audit is worse than no verdict, because checks are
 * skipped on the strength of it.
 *
 * Only headers and raw HTML are used — the same material the crawler already
 * has. Nothing here issues extra requests, so fingerprinting costs nothing on
 * top of the crawl.
 */
import type {
  PlatformFingerprint, PlatformId, PlatformKind, PlatformMatch,
} from './types.ts';
import { PHP_PLATFORMS, UNKNOWN_PLATFORM } from './types.ts';

export interface PlatformInput {
  url: string;
  status: number;
  headers: Record<string, string>;
  html: string;
  /** the Next.js detector's verdict, which is far more thorough than a regex */
  isNext?: boolean;
}

interface Rule {
  id: PlatformId;
  label: string;
  kind: PlatformKind;
  /** Each hit adds its weight. Weights are capped at 1 when summed. */
  signals: Array<{
    weight: number;
    reason: string;
    test: (ctx: Ctx) => boolean;
  }>;
}

interface Ctx {
  html: string;
  /** lowercased once — every rule scans it */
  lower: string;
  headers: Record<string, string>;
  header: (name: string) => string;
  /** content of <meta name="generator"> lowercased, '' when absent */
  generator: string;
}

const has = (haystack: string, needle: string): boolean => haystack.includes(needle);

// ---------------------------------------------------------------------------
// Rules
//
// Weights: 0.9+ is a signature that only that platform emits (a wp-content
// path, a Shopify object). 0.4-0.6 is strong but shared (an X-Powered-By, a
// cookie name). Below that is corroboration only — never enough alone.
// ---------------------------------------------------------------------------

const RULES: Rule[] = [
  {
    id: 'wordpress', label: 'WordPress', kind: 'cms',
    signals: [
      { weight: 0.95, reason: 'links assets from /wp-content/', test: (c) => has(c.lower, '/wp-content/') },
      { weight: 0.9, reason: 'links assets from /wp-includes/', test: (c) => has(c.lower, '/wp-includes/') },
      { weight: 0.9, reason: 'meta generator names WordPress', test: (c) => has(c.generator, 'wordpress') },
      { weight: 0.5, reason: 'exposes the WordPress REST API link header', test: (c) => has(c.header('link'), '/wp-json/') },
      { weight: 0.4, reason: 'emits a wp-emoji or wp-block script', test: (c) => has(c.lower, 'wp-emoji') || has(c.lower, 'wp-block-library') },
    ],
  },
  {
    id: 'woocommerce', label: 'WooCommerce', kind: 'ecommerce',
    signals: [
      { weight: 0.9, reason: 'ships WooCommerce assets', test: (c) => has(c.lower, '/plugins/woocommerce/') || has(c.lower, 'woocommerce-page') },
      { weight: 0.5, reason: 'sets a woocommerce cookie', test: (c) => has(c.header('set-cookie'), 'woocommerce_') },
    ],
  },
  {
    id: 'shopify', label: 'Shopify', kind: 'ecommerce',
    signals: [
      { weight: 0.95, reason: 'serves assets from cdn.shopify.com', test: (c) => has(c.lower, 'cdn.shopify.com') || has(c.lower, 'cdn/shop/') },
      { weight: 0.9, reason: 'defines the Shopify JS global', test: (c) => has(c.html, 'Shopify.theme') || has(c.html, 'var Shopify =') },
      { weight: 0.6, reason: 'sets the X-ShopId response header', test: (c) => !!c.header('x-shopid') || !!c.header('x-shopify-stage') },
    ],
  },
  {
    id: 'drupal', label: 'Drupal', kind: 'cms',
    signals: [
      { weight: 0.9, reason: 'meta generator names Drupal', test: (c) => has(c.generator, 'drupal') },
      { weight: 0.85, reason: 'emits drupalSettings', test: (c) => has(c.html, 'drupalSettings') || has(c.lower, '/sites/default/files/') },
      { weight: 0.6, reason: 'sends the X-Drupal-Cache header', test: (c) => !!c.header('x-drupal-cache') || !!c.header('x-drupal-dynamic-cache') },
    ],
  },
  {
    id: 'joomla', label: 'Joomla', kind: 'cms',
    signals: [
      { weight: 0.9, reason: 'meta generator names Joomla', test: (c) => has(c.generator, 'joomla') },
      { weight: 0.7, reason: 'links /media/jui/ or /templates/ assets', test: (c) => has(c.lower, '/media/jui/') || has(c.lower, '/media/system/js/') },
    ],
  },
  {
    id: 'ghost', label: 'Ghost', kind: 'cms',
    signals: [
      { weight: 0.9, reason: 'meta generator names Ghost', test: (c) => has(c.generator, 'ghost') },
      { weight: 0.6, reason: 'links /assets/built/ Ghost theme assets', test: (c) => has(c.lower, 'ghost-sdk') || has(c.lower, '/assets/built/') },
    ],
  },
  {
    id: 'typo3', label: 'TYPO3', kind: 'cms',
    signals: [
      { weight: 0.9, reason: 'meta generator names TYPO3', test: (c) => has(c.generator, 'typo3') },
      { weight: 0.6, reason: 'links /typo3conf/ or /typo3temp/', test: (c) => has(c.lower, '/typo3conf/') || has(c.lower, '/typo3temp/') },
    ],
  },
  {
    id: 'craft', label: 'Craft CMS', kind: 'cms',
    signals: [
      { weight: 0.7, reason: 'sends a Craft CSRF or session cookie', test: (c) => has(c.header('set-cookie'), 'craftsessionid') },
      { weight: 0.6, reason: 'links /cpresources/', test: (c) => has(c.lower, '/cpresources/') },
    ],
  },
  {
    id: 'wix', label: 'Wix', kind: 'site-builder',
    signals: [
      { weight: 0.95, reason: 'serves from static.wixstatic.com', test: (c) => has(c.lower, 'wixstatic.com') || has(c.lower, 'wix.com') },
      { weight: 0.8, reason: 'meta generator names Wix', test: (c) => has(c.generator, 'wix') },
      { weight: 0.6, reason: 'sends an X-Wix response header', test: (c) => Object.keys(c.headers).some((h) => h.startsWith('x-wix-')) },
    ],
  },
  {
    id: 'squarespace', label: 'Squarespace', kind: 'site-builder',
    signals: [
      { weight: 0.95, reason: 'serves from squarespace-cdn.com', test: (c) => has(c.lower, 'squarespace-cdn.com') || has(c.lower, 'static1.squarespace.com') },
      { weight: 0.8, reason: 'defines Static.SQUARESPACE_CONTEXT', test: (c) => has(c.html, 'SQUARESPACE_CONTEXT') },
    ],
  },
  {
    id: 'webflow', label: 'Webflow', kind: 'site-builder',
    signals: [
      { weight: 0.9, reason: 'meta generator names Webflow', test: (c) => has(c.generator, 'webflow') },
      { weight: 0.85, reason: 'uses Webflow data attributes', test: (c) => has(c.lower, 'data-wf-page') || has(c.lower, 'data-wf-site') },
    ],
  },
  {
    id: 'weebly', label: 'Weebly', kind: 'site-builder',
    signals: [
      { weight: 0.9, reason: 'links Weebly editor assets', test: (c) => has(c.lower, 'weebly.com') || has(c.lower, '_wl_') },
    ],
  },
  {
    id: 'framer', label: 'Framer', kind: 'site-builder',
    signals: [
      { weight: 0.9, reason: 'meta generator names Framer', test: (c) => has(c.generator, 'framer') },
      { weight: 0.7, reason: 'serves from framerusercontent.com', test: (c) => has(c.lower, 'framerusercontent.com') },
    ],
  },
  {
    id: 'blogger', label: 'Blogger', kind: 'site-builder',
    signals: [
      { weight: 0.9, reason: 'meta generator names Blogger', test: (c) => has(c.generator, 'blogger') },
      { weight: 0.7, reason: 'links blogspot resources', test: (c) => has(c.lower, 'blogblog.com') || has(c.lower, '.blogspot.') },
    ],
  },
  {
    id: 'magento', label: 'Magento', kind: 'ecommerce',
    signals: [
      { weight: 0.85, reason: 'emits Magento requirejs config', test: (c) => has(c.lower, '/static/frontend/') || has(c.lower, 'mage/requirejs') },
      { weight: 0.6, reason: 'sets a Magento section cookie', test: (c) => has(c.header('set-cookie'), 'mage-') },
    ],
  },
  {
    id: 'prestashop', label: 'PrestaShop', kind: 'ecommerce',
    signals: [
      { weight: 0.85, reason: 'defines the prestashop JS global', test: (c) => has(c.lower, 'var prestashop') || has(c.generator, 'prestashop') },
    ],
  },
  {
    id: 'bigcommerce', label: 'BigCommerce', kind: 'ecommerce',
    signals: [
      { weight: 0.9, reason: 'serves from cdn11.bigcommerce.com', test: (c) => has(c.lower, 'bigcommerce.com/s-') || has(c.lower, 'cdn11.bigcommerce.com') },
    ],
  },
  {
    id: 'salesforce-commerce', label: 'Salesforce Commerce Cloud', kind: 'ecommerce',
    signals: [
      { weight: 0.85, reason: 'uses demandware URLs', test: (c) => has(c.lower, 'demandware.static') || has(c.lower, '/on/demandware.store/') },
    ],
  },
  {
    // The dedicated fingerprinter is far more thorough and overrides this, but
    // the rule keeps this module correct on its own — it is used directly by
    // tests and by anything that has a response without a Next verdict.
    id: 'nextjs', label: 'Next.js', kind: 'framework',
    signals: [
      { weight: 0.9, reason: 'serves /_next/static/ assets', test: (c) => has(c.lower, '/_next/static/') },
      { weight: 0.9, reason: 'exposes __NEXT_DATA__', test: (c) => has(c.html, '__NEXT_DATA__') },
      { weight: 0.85, reason: 'streams an App Router flight payload', test: (c) => has(c.html, 'self.__next_f') },
    ],
  },
  {
    id: 'nuxt', label: 'Nuxt', kind: 'framework',
    signals: [
      { weight: 0.95, reason: 'exposes the __NUXT__ payload', test: (c) => has(c.html, '__NUXT__') || has(c.html, '__nuxt') },
      { weight: 0.6, reason: 'serves /_nuxt/ assets', test: (c) => has(c.lower, '/_nuxt/') },
    ],
  },
  {
    id: 'astro', label: 'Astro', kind: 'framework',
    signals: [
      { weight: 0.9, reason: 'meta generator names Astro', test: (c) => has(c.generator, 'astro') },
      { weight: 0.7, reason: 'emits astro-island or astro- scoped classes', test: (c) => has(c.lower, 'astro-island') || has(c.lower, 'data-astro-') },
    ],
  },
  {
    id: 'sveltekit', label: 'SvelteKit', kind: 'framework',
    signals: [
      { weight: 0.9, reason: 'emits the SvelteKit hydration payload', test: (c) => has(c.html, '__sveltekit') || has(c.lower, 'data-sveltekit') },
    ],
  },
  {
    id: 'remix', label: 'Remix', kind: 'framework',
    signals: [
      { weight: 0.9, reason: 'exposes __remixContext', test: (c) => has(c.html, '__remixContext') || has(c.html, '__remixManifest') },
    ],
  },
  {
    id: 'gatsby', label: 'Gatsby', kind: 'framework',
    signals: [
      { weight: 0.9, reason: 'mounts ___gatsby', test: (c) => has(c.html, 'id="___gatsby"') || has(c.html, '___gatsby') },
      { weight: 0.5, reason: 'meta generator names Gatsby', test: (c) => has(c.generator, 'gatsby') },
    ],
  },
  {
    id: 'docusaurus', label: 'Docusaurus', kind: 'framework',
    signals: [
      { weight: 0.9, reason: 'meta generator names Docusaurus', test: (c) => has(c.generator, 'docusaurus') },
      { weight: 0.6, reason: 'mounts __docusaurus', test: (c) => has(c.html, '__docusaurus') },
    ],
  },
  {
    id: 'angular', label: 'Angular', kind: 'framework',
    signals: [
      { weight: 0.85, reason: 'uses an <app-root> mount or ng- attributes', test: (c) => has(c.lower, '<app-root') || has(c.lower, 'ng-version=') },
    ],
  },
  {
    id: 'vue', label: 'Vue', kind: 'framework',
    signals: [
      { weight: 0.5, reason: 'uses Vue attributes', test: (c) => has(c.lower, 'data-v-app') || has(c.lower, '__vue__') },
    ],
  },
  {
    id: 'react', label: 'React', kind: 'framework',
    signals: [
      // Only meaningful once the meta-frameworks above have been ruled out.
      { weight: 0.45, reason: 'hydrates with React', test: (c) => has(c.html, 'data-reactroot') || has(c.html, '__REACT_DEVTOOLS') },
    ],
  },
  {
    id: 'laravel', label: 'Laravel', kind: 'server',
    signals: [
      { weight: 0.8, reason: 'sets the laravel_session cookie', test: (c) => has(c.header('set-cookie'), 'laravel_session') || has(c.header('set-cookie'), 'xsrf-token') },
      { weight: 0.5, reason: 'emits a Livewire or Laravel Mix asset', test: (c) => has(c.lower, 'livewire') },
    ],
  },
  {
    id: 'django', label: 'Django', kind: 'server',
    signals: [
      { weight: 0.8, reason: 'sets the csrftoken / sessionid cookie pair', test: (c) => has(c.header('set-cookie'), 'csrftoken') },
      { weight: 0.5, reason: 'links /static/admin/ assets', test: (c) => has(c.lower, '/static/admin/') },
    ],
  },
  {
    id: 'rails', label: 'Ruby on Rails', kind: 'server',
    signals: [
      { weight: 0.8, reason: 'emits a csrf-param meta tag', test: (c) => has(c.lower, 'name="csrf-param"') },
      { weight: 0.5, reason: 'sets a _session_id cookie', test: (c) => has(c.header('set-cookie'), '_session_id') },
    ],
  },
  {
    id: 'aspnet', label: 'ASP.NET', kind: 'server',
    signals: [
      { weight: 0.8, reason: 'sends the X-AspNet-Version header', test: (c) => !!c.header('x-aspnet-version') || !!c.header('x-aspnetmvc-version') },
      { weight: 0.7, reason: 'emits __VIEWSTATE', test: (c) => has(c.html, '__VIEWSTATE') },
    ],
  },
  {
    id: 'hugo', label: 'Hugo', kind: 'ssg',
    signals: [
      { weight: 0.9, reason: 'meta generator names Hugo', test: (c) => has(c.generator, 'hugo') },
    ],
  },
  {
    id: 'jekyll', label: 'Jekyll', kind: 'ssg',
    signals: [
      { weight: 0.9, reason: 'meta generator names Jekyll', test: (c) => has(c.generator, 'jekyll') },
    ],
  },
  {
    id: 'eleventy', label: 'Eleventy', kind: 'ssg',
    signals: [
      { weight: 0.9, reason: 'meta generator names Eleventy', test: (c) => has(c.generator, 'eleventy') || has(c.generator, '11ty') },
    ],
  },
];

const GENERATOR_RE = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']*)["']/i;
const GENERATOR_RE_ALT = /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']generator["']/i;

/** Fingerprint one response. Never throws; an unrecognised site is `unknown`. */
export function detectPlatform(input: PlatformInput): PlatformFingerprint {
  const html = input.html ?? '';
  if (!html) return UNKNOWN_PLATFORM;

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = String(v);

  const generatorMatch = html.match(GENERATOR_RE) ?? html.match(GENERATOR_RE_ALT);
  const ctx: Ctx = {
    html,
    lower: html.toLowerCase(),
    headers,
    header: (name) => headers[name] ?? '',
    generator: (generatorMatch?.[1] ?? '').toLowerCase(),
  };

  const matches: PlatformMatch[] = [];

  for (const rule of RULES) {
    let confidence = 0;
    const evidence: string[] = [];
    for (const signal of rule.signals) {
      let hit = false;
      try { hit = signal.test(ctx); } catch { hit = false; }
      if (!hit) continue;
      confidence += signal.weight;
      evidence.push(signal.reason);
    }
    if (evidence.length === 0) continue;
    matches.push({
      id: rule.id, label: rule.label, kind: rule.kind,
      confidence: Math.min(1, confidence), evidence,
    });
  }

  // Next.js is detected by its own far more thorough fingerprinter; trust it
  // over anything a regex here would conclude.
  if (input.isNext) {
    const i = matches.findIndex((m) => m.id === 'nextjs');
    const evidence = i === -1 ? [] : matches[i]!.evidence;
    if (i !== -1) matches.splice(i, 1);
    matches.push({
      id: 'nextjs', label: 'Next.js', kind: 'framework', confidence: 1,
      evidence: ['identified by the Next.js fingerprinter', ...evidence],
    });
  }

  // A generator we have no rule for is still worth reporting: it names the
  // platform in the site's own words, which beats guessing "unknown".
  if (matches.length === 0 && ctx.generator) {
    return {
      id: 'unknown', label: titleCase(ctx.generator.slice(0, 40)), kind: 'unknown',
      confidence: 0.4, evidence: [`meta generator says "${ctx.generator.slice(0, 60)}"`],
      matches: [], runsPhp: false,
    };
  }

  if (matches.length === 0) return UNKNOWN_PLATFORM;

  matches.sort((a, b) => b.confidence - a.confidence);

  // A meta-framework outranks the UI library it is built on: a Next.js site
  // that also trips the React rule is a Next.js site, not a React site.
  const primary = pickPrimary(matches);

  return {
    id: primary.id,
    label: primary.label,
    kind: primary.kind,
    confidence: primary.confidence,
    evidence: primary.evidence,
    matches,
    runsPhp: matches.some((m) => PHP_PLATFORMS.has(m.id)),
  };
}

/** Generic UI libraries only win when nothing more specific matched. */
const GENERIC: ReadonlySet<PlatformId> = new Set<PlatformId>(['react', 'vue']);

function pickPrimary(matches: PlatformMatch[]): PlatformMatch {
  const specific = matches.filter((m) => !GENERIC.has(m.id));
  return (specific[0] ?? matches[0])!;
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Reduce per-page fingerprints to one verdict for the site.
 *
 * Pages of a site can legitimately differ — a WordPress blog in front of a
 * Next.js app — so the winner is the platform seen on the most pages, with
 * confidence carried from the strongest single detection rather than averaged
 * (one unambiguous signature is worth more than many weak ones).
 */
export function aggregatePlatform(pages: PlatformFingerprint[]): PlatformFingerprint {
  const seen = pages.filter((p) => p.id !== 'unknown' || p.evidence.length > 0);
  if (seen.length === 0) return UNKNOWN_PLATFORM;

  const byId = new Map<string, { count: number; best: PlatformFingerprint }>();
  for (const p of seen) {
    const entry = byId.get(p.id);
    if (!entry) byId.set(p.id, { count: 1, best: p });
    else {
      entry.count++;
      if (p.confidence > entry.best.confidence) entry.best = p;
    }
  }

  const ranked = [...byId.values()].sort(
    (a, b) => b.count - a.count || b.best.confidence - a.best.confidence,
  );
  const winner = ranked[0]!.best;

  // Union the secondary matches across pages, so a stack detected on only some
  // pages (WooCommerce on shop pages) still gates checks for the whole site.
  const allMatches = new Map<PlatformId, PlatformMatch>();
  for (const p of seen) {
    for (const m of p.matches) {
      const existing = allMatches.get(m.id);
      if (!existing || m.confidence > existing.confidence) allMatches.set(m.id, m);
    }
  }
  const matches = [...allMatches.values()].sort((a, b) => b.confidence - a.confidence);

  return {
    ...winner,
    matches,
    runsPhp: matches.some((m) => PHP_PLATFORMS.has(m.id)),
  };
}
