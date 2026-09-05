/**
 * Where in the HTML does a given finding live?
 *
 * The checks themselves deliberately do not carry offsets. They are predicates
 * over a parsed `PageData` — asking each of 321 of them to also track a source
 * position would double their size and couple them to raw markup they never
 * otherwise touch.
 *
 * So location is resolved separately here, by check id. Each locator is a small
 * search over the raw HTML that answers "show me the thing this check is
 * complaining about". Checks with no meaningful source position (site-level
 * facts, PageSpeed metrics, robots.txt rules) simply have no locator, and the
 * UI hides the code view for them rather than pointing somewhere arbitrary.
 */

export interface SourceLocation {
  offset: number;
  /** length of the matched text, so the UI can underline it */
  length: number;
  /** what was matched, for the UI caption */
  label: string;
}

type Locator = (html: string) => SourceLocation | null;

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

function find(html: string, re: RegExp, label: string): SourceLocation | null {
  re.lastIndex = 0;
  const m = re.exec(html);
  if (!m) return null;
  return { offset: m.index, length: m[0].length, label };
}

/** Nth (1-based) match, for "more than one X" findings. */
function findNth(html: string, re: RegExp, n: number, label: string): SourceLocation | null {
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let count = 0;
  for (let m = global.exec(html); m; m = global.exec(html)) {
    if (++count === n) return { offset: m.index, length: m[0].length, label };
  }
  return null;
}

/** First tag of `name` that does NOT contain `attr`. */
function findTagMissingAttr(html: string, name: string, attr: string, label: string): SourceLocation | null {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi');
  for (let m = re.exec(html); m; m = re.exec(html)) {
    if (!new RegExp(`\\s${attr}\\s*=`, 'i').test(m[0])) {
      return { offset: m.index, length: m[0].length, label };
    }
  }
  return null;
}

/** The <head> element, used as a fallback for "this tag is missing entirely". */
function headOpen(html: string): SourceLocation | null {
  return find(html, /<head\b[^>]*>/i, '<head>');
}

const T = {
  title: /<title\b[^>]*>[\s\S]*?<\/title>/i,
  description: /<meta[^>]+name=["']description["'][^>]*>/i,
  canonical: /<link[^>]+rel=["']canonical["'][^>]*>/i,
  robots: /<meta[^>]+name=["']robots["'][^>]*>/i,
  viewport: /<meta[^>]+name=["']viewport["'][^>]*>/i,
  charset: /<meta[^>]+charset[^>]*>/i,
  h1: /<h1\b[^>]*>[\s\S]*?<\/h1>/i,
  htmlTag: /<html\b[^>]*>/i,
  base: /<base\b[^>]*>/i,
  doctype: /<!doctype[^>]*>/i,
};

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const LOCATORS: Record<string, Locator> = {
  // ---- title -------------------------------------------------------------
  'title-too-long': (h) => find(h, T.title, '<title>'),
  'title-too-short': (h) => find(h, T.title, '<title>'),
  'title-is-empty': (h) => find(h, T.title, '<title>'),
  'title-starts-lowercase': (h) => find(h, T.title, '<title>'),
  'title-outdated': (h) => find(h, T.title, '<title>'),
  'title-duplicates': (h) => find(h, T.title, '<title>'),
  'multiple-title-tags': (h) => findNth(h, T.title, 2, 'second <title>'),
  'title-is-missing': (h) => headOpen(h),

  // ---- description -------------------------------------------------------
  'description-too-long': (h) => find(h, T.description, 'meta description'),
  'description-too-short': (h) => find(h, T.description, 'meta description'),
  'description-is-empty': (h) => find(h, T.description, 'meta description'),
  'description-duplicates': (h) => find(h, T.description, 'meta description'),
  'description-equals-title': (h) => find(h, T.description, 'meta description'),
  'multiple-description-tags': (h) => findNth(h, T.description, 2, 'second meta description'),
  'description-is-missing': (h) => headOpen(h),

  // ---- headings ----------------------------------------------------------
  'h1-too-long': (h) => find(h, T.h1, '<h1>'),
  'h1-too-short': (h) => find(h, T.h1, '<h1>'),
  'h1-is-empty': (h) => find(h, T.h1, '<h1>'),
  'h1-duplicates': (h) => find(h, T.h1, '<h1>'),
  'h1-starts-lowercase': (h) => find(h, T.h1, '<h1>'),
  'h1-equals-title': (h) => find(h, T.h1, '<h1>'),
  'h1-equals-description': (h) => find(h, T.h1, '<h1>'),
  'h1-has-other-tags-inside': (h) => find(h, T.h1, '<h1>'),
  'multiple-h1': (h) => findNth(h, /<h1\b[^>]*>/i, 2, 'second <h1>'),
  'h1-is-missing': (h) => find(h, /<body\b[^>]*>/i, '<body>'),
  'h2-starts-lowercase': (h) => find(h, /<h2\b[^>]*>[\s\S]*?<\/h2>/i, '<h2>'),
  'h2-has-other-tags-inside': (h) => find(h, /<h2\b[^>]*>[\s\S]*?<\/h2>/i, '<h2>'),
  'headings-hierarchy-broken': (h) => find(h, /<h[1-6]\b[^>]*>/i, 'first heading'),

  // ---- canonical / robots ------------------------------------------------
  'canonical-not-equal-url': (h) => find(h, T.canonical, 'canonical'),
  'canonical-is-empty': (h) => find(h, T.canonical, 'canonical'),
  'canonical-relative-url': (h) => find(h, T.canonical, 'canonical'),
  'canonical-to-non-200': (h) => find(h, T.canonical, 'canonical'),
  'canonical-points-redirect': (h) => find(h, T.canonical, 'canonical'),
  'canonical-points-noindex': (h) => find(h, T.canonical, 'canonical'),
  'canonical-points-disallowed': (h) => find(h, T.canonical, 'canonical'),
  'canonical-points-external-url': (h) => find(h, T.canonical, 'canonical'),
  'canonical-points-homepage': (h) => find(h, T.canonical, 'canonical'),
  'canonical-loop': (h) => find(h, T.canonical, 'canonical'),
  'canonical-outside-head': (h) => find(h, T.canonical, 'canonical'),
  'canonical-from-http-to-https': (h) => find(h, T.canonical, 'canonical'),
  'canonical-from-https-to-http': (h) => find(h, T.canonical, 'canonical'),
  'canonical-points-another-canonicalized-url': (h) => find(h, T.canonical, 'canonical'),
  'canonicalized-url-noindex-nofollow': (h) => find(h, T.canonical, 'canonical'),
  'multiple-canonical-tags': (h) => findNth(h, T.canonical, 2, 'second canonical'),
  'canonical-is-missing': (h) => headOpen(h),

  'meta-noindex-pages': (h) => find(h, T.robots, 'meta robots'),
  'meta-nofollow-pages': (h) => find(h, T.robots, 'meta robots'),
  'noindex-follow-page': (h) => find(h, T.robots, 'meta robots'),
  'meta-robots-outside-head': (h) => find(h, T.robots, 'meta robots'),
  'multiple-noindex-directives': (h) => findNth(h, T.robots, 2, 'second meta robots'),
  'non-indexable-pages': (h) => find(h, T.robots, 'meta robots') ?? headOpen(h),

  // ---- document structure ------------------------------------------------
  'no-doctype': (h) => ({ offset: 0, length: Math.min(60, h.length), label: 'start of document' }),
  'content-before-doctype': (h) => ({ offset: 0, length: Math.max(1, h.toLowerCase().indexOf('<!doctype')), label: 'content before doctype' }),
  'content-after-html': (h) => {
    const i = h.toLowerCase().lastIndexOf('</html>');
    return i === -1 ? null : { offset: i + 7, length: Math.min(120, h.length - i - 7), label: 'content after </html>' };
  },
  'multiple-html-tags': (h) => findNth(h, /<html\b[^>]*>/i, 2, 'second <html>'),
  'multiple-head-tags': (h) => findNth(h, /<head\b[^>]*>/i, 2, 'second <head>'),
  'multiple-body-tags': (h) => findNth(h, /<body\b[^>]*>/i, 2, 'second <body>'),
  'multiple-html-close': (h) => findNth(h, /<\/html\s*>/i, 2, 'second </html>'),
  'multiple-head-close': (h) => findNth(h, /<\/head\s*>/i, 2, 'second </head>'),
  'multiple-body-close': (h) => findNth(h, /<\/body\s*>/i, 2, 'second </body>'),
  'html-tag-missing': (h) => ({ offset: 0, length: Math.min(80, h.length), label: 'start of document' }),
  'head-tag-missing': (h) => find(h, T.htmlTag, '<html>'),
  'body-tag-missing': (h) => find(h, T.htmlTag, '<html>'),
  'html-close-missing': (h) => ({ offset: Math.max(0, h.length - 120), length: 120, label: 'end of document' }),
  'head-close-missing': (h) => headOpen(h),
  'body-close-missing': (h) => ({ offset: Math.max(0, h.length - 120), length: 120, label: 'end of document' }),
  'html-tag-empty': (h) => find(h, T.htmlTag, '<html>'),
  'noscript-head-invalid': (h) => find(h, /<noscript\b[^>]*>/i, '<noscript> in head'),
  'no-character-encoding': (h) => headOpen(h),
  'html-lang-missing': (h) => find(h, T.htmlTag, '<html>'),
  'html-lang-invalid': (h) => find(h, T.htmlTag, '<html>'),
  'hreflang-defined-html-lang-missing': (h) => find(h, T.htmlTag, '<html>'),

  'multiple-base-urls': (h) => findNth(h, T.base, 2, 'second <base>'),
  'multiple-mismatched-base-urls': (h) => findNth(h, T.base, 2, 'second <base>'),
  'base-url-malformed-empty': (h) => find(h, T.base, '<base>'),

  // ---- viewport / mobile -------------------------------------------------
  'viewport-missing': (h) => headOpen(h),
  'viewport-multiple': (h) => findNth(h, T.viewport, 2, 'second viewport'),
  'viewport-no-width': (h) => find(h, T.viewport, 'viewport'),
  'viewport-specific-width': (h) => find(h, T.viewport, 'viewport'),
  'viewport-missing-initial-scale': (h) => find(h, T.viewport, 'viewport'),
  'viewport-initial-scale-incorrect': (h) => find(h, T.viewport, 'viewport'),
  'viewport-maximum-scale': (h) => find(h, T.viewport, 'viewport'),
  'viewport-minimum-scale': (h) => find(h, T.viewport, 'viewport'),
  'viewport-prevents-scaling': (h) => find(h, T.viewport, 'viewport'),
  'image-map-tags': (h) => find(h, /<map\b[^>]*>/i, '<map>'),
  'unsupported-browser-plugins': (h) => find(h, /<(applet|embed|object)\b[^>]*>/i, 'legacy plugin element'),

  // ---- images ------------------------------------------------------------
  'missing-alt-text': (h) => findTagMissingAttr(h, 'img', 'alt', '<img> without alt'),
  'add-dimensions-to-images': (h) => findTagMissingAttr(h, 'img', 'width', '<img> without width'),
  'alt-text-one-word': (h) => find(h, /<img[^>]+alt=["'][^"'\s]+["'][^>]*>/i, '<img> with one-word alt'),
  'alt-text-too-long': (h) => find(h, /<img[^>]+alt=["'][^"']{100,}["'][^>]*>/i, '<img> with long alt'),
  'https-page-links-http-image': (h) => find(h, /<img[^>]+src=["']http:\/\/[^"']+["'][^>]*>/i, 'insecure <img>'),
  'serve-images-next-gen': (h) => find(h, /<img[^>]+src=["'][^"']+\.(?:jpe?g|png)[^"']*["'][^>]*>/i, 'legacy-format <img>'),
  'use-video-for-animated': (h) => find(h, /<img[^>]+src=["'][^"']+\.gif[^"']*["'][^>]*>/i, 'GIF <img>'),
  'next.image.fill-without-sizes': (h) => {
    const re = /<img[^>]*>/gi;
    for (let m = re.exec(h); m; m = re.exec(h)) {
      if (/data-nimg=["']fill["']/i.test(m[0]) && !/\ssizes=/i.test(m[0])) {
        return { offset: m.index, length: m[0].length, label: 'fill image without sizes' };
      }
    }
    return null;
  },
  'next.image.unoptimized': (h) => find(h, /<img[^>]+data-nimg[^>]*>/i, 'next/image element'),
  'next.image.lcp-not-prioritised': (h) => find(h, /<img[^>]+data-nimg[^>]*>/i, 'next/image element'),
  'next.image.raw-img-tag': (h) => {
    const re = /<img\b[^>]*>/gi;
    for (let m = re.exec(h); m; m = re.exec(h)) {
      if (!/data-nimg/i.test(m[0]) && !/\/_next\/image\?/.test(m[0])) {
        return { offset: m.index, length: m[0].length, label: 'raw <img>' };
      }
    }
    return null;
  },
  'empty-src-attributes': (h) => find(h, /<[a-z]+[^>]+src=["']["'][^>]*>/i, 'empty src'),

  // ---- links -------------------------------------------------------------
  'empty-href-attribute': (h) => find(h, /<a\b[^>]*\shref=["']["'][^>]*>/i, 'empty href'),
  'empty-links-hash': (h) => find(h, /<a\b[^>]*\shref=["']#["'][^>]*>/i, 'href="#"'),
  'link-url-in-onclick': (h) => find(h, /<a\b[^>]*\sonclick=[^>]*>/i, 'onclick navigation'),
  'link-localhost': (h) => find(h, /<a\b[^>]*href=["'][^"']*(?:localhost|127\.0\.0\.1)[^"']*["'][^>]*>/i, 'localhost link'),
  'link-whitespace-href': (h) => find(h, /<a\b[^>]*href=["'][^"']*\s[^"']*["'][^>]*>/i, 'href with whitespace'),
  'nofollow-outgoing-internal-links': (h) => find(h, /<a\b[^>]*rel=["'][^"']*nofollow[^"']*["'][^>]*>/i, 'nofollow link'),
  'internal-link-no-anchor-text': (h) => find(h, /<a\b[^>]*>\s*<\/a>/i, 'link with no text'),
  'page-contains-rel-sponsored': (h) => find(h, /<a\b[^>]*rel=["'][^"']*sponsored[^"']*["'][^>]*>/i, 'rel=sponsored'),

  // ---- social ------------------------------------------------------------
  'open-graph-tags-missing': (h) => headOpen(h),
  'open-graph-tags-incomplete': (h) => find(h, /<meta[^>]+property=["']og:[^"']*["'][^>]*>/i, 'Open Graph tag'),
  'open-graph-url-not-canonical': (h) => find(h, /<meta[^>]+property=["']og:url["'][^>]*>/i, 'og:url'),
  'og-image-relative': (h) => find(h, /<meta[^>]+property=["']og:image["'][^>]*>/i, 'og:image'),
  'next.metadata.relative-og-image': (h) => find(h, /<meta[^>]+property=["']og:image["'][^>]*>/i, 'og:image'),
  'twitter-card-missing': (h) => headOpen(h),
  'twitter-card-incomplete': (h) => find(h, /<meta[^>]+name=["']twitter:[^"']*["'][^>]*>/i, 'Twitter card tag'),
  'twitter-description-too-long': (h) => find(h, /<meta[^>]+name=["']twitter:description["'][^>]*>/i, 'twitter:description'),

  // ---- code validation ---------------------------------------------------
  'tags-with-style-attributes': (h) => find(h, /<[a-z][a-z0-9]*\b[^>]*\sstyle=["'][^"']*["'][^>]*>/i, 'inline style'),
  'table-no-caption': (h) => find(h, /<table\b[^>]*>/i, '<table>'),
  'table-no-th': (h) => find(h, /<table\b[^>]*>/i, '<table>'),
  'gtm-in-body': (h) => {
    const body = h.toLowerCase().indexOf('<body');
    if (body === -1) return null;
    const i = h.indexOf('GTM-', body);
    return i === -1 ? null : { offset: i, length: 14, label: 'GTM container in <body>' };
  },
  'php-fatal-error': (h) => find(h, /(?:Fatal error|Parse error|Warning):[^<\n]{0,160}/i, 'PHP error output'),
  'lorem-ipsum': (h) => find(h, /lorem\s+ipsum/i, 'placeholder text'),
  'meta-refresh-redirect': (h) => find(h, /<meta[^>]+http-equiv=["']?refresh["']?[^>]*>/i, 'meta refresh'),
  'form-with-get-method': (h) => find(h, /<form\b[^>]*>/i, '<form>'),
  'https-form-posts-to-http': (h) => find(h, /<form[^>]+action=["']http:\/\/[^"']+["'][^>]*>/i, 'insecure form action'),
  'http-url-password-field': (h) => find(h, /<input[^>]+type=["']password["'][^>]*>/i, 'password input'),

  // ---- resources ---------------------------------------------------------
  'https-links-http-css': (h) => find(h, /<link[^>]+href=["']http:\/\/[^"']+["'][^>]*>/i, 'insecure stylesheet'),
  'https-links-http-javascript': (h) => find(h, /<script[^>]+src=["']http:\/\/[^"']+["'][^>]*>/i, 'insecure script'),
  'next.script.blocking': (h) => find(h, /<script(?![^>]*\b(?:async|defer)\b)[^>]+src=[^>]*>/i, 'blocking script'),
  'next.font.external-blocking': (h) => find(h, /<link[^>]+href=["'][^"']*fonts\.googleapis\.com[^"']*["'][^>]*>/i, 'Google Fonts link'),
  'http-link-w3-org': (h) => find(h, /["']http:\/\/[^"']*w3\.org[^"']*["']/i, 'insecure w3.org reference'),
  'http-link-schema-org': (h) => find(h, /["']http:\/\/[^"']*schema\.org[^"']*["']/i, 'insecure schema.org reference'),
  'http-link-ogp-me': (h) => find(h, /["']http:\/\/[^"']*ogp\.me[^"']*["']/i, 'insecure ogp.me reference'),

  // ---- Next.js payload ---------------------------------------------------
  'next.payload.rsc-bloat': (h) => find(h, /self\.__next_f\s*\.\s*push\s*\(/i, 'inline RSC flight payload'),
  'next.payload.props-bloat': (h) => find(h, /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>/i, '__NEXT_DATA__'),
  'text-to-code-ratio-low': (h) => find(h, /self\.__next_f\s*\.\s*push\s*\(/i, 'inline payload')
    ?? find(h, /<script\b[^>]*>/i, 'first <script>'),
  'next.render.unresolved-suspense': (h) => find(h, /<template\s+id=["']B:\d+["'][^>]*>/i, 'unresolved Suspense boundary'),

  // ---- SPA ---------------------------------------------------------------
  'spa.client-rendering-detected': (h) =>
    find(h, /<(?:div[^>]+id=["'](?:root|app|__next|__nuxt|svelte)["']|app-root)[^>]*>\s*<\/(?:div|app-root)>/i, 'empty mount point'),
  'js.empty-root-fallback': (h) =>
    find(h, /<(?:div[^>]+id=["'](?:root|app|__next|__nuxt|svelte)["']|app-root)[^>]*>/i, 'mount point'),
};

/** Ids whose defect has an identifiable position in the source. */
export function hasLocator(checkId: string): boolean {
  return checkId in LOCATORS;
}

export function locatableCheckIds(): string[] {
  return Object.keys(LOCATORS);
}

/**
 * Resolve where a finding lives in the given HTML.
 *
 * Returns null when the check has no locator, or when its locator cannot find
 * the pattern — which happens legitimately, for instance when a check fired on
 * the rendered DOM but the snapshot holds the raw server HTML.
 */
export function locateFinding(checkId: string, html: string): SourceLocation | null {
  const locator = LOCATORS[checkId];
  if (!locator || !html) return null;
  try {
    const found = locator(html);
    if (!found) return null;
    // Guard against a locator returning a nonsensical position.
    if (found.offset < 0 || found.offset >= html.length) return null;
    return { ...found, length: Math.max(1, Math.min(found.length, 2000)) };
  } catch {
    return null;
  }
}
