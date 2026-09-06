/**
 * Extraction layer.
 *
 * Turns one HTTP response into a fully parsed PageData record. Every check in
 * src/core/checks/ reads from this and nothing else, which is what keeps ~300
 * check definitions down to a few lines each and keeps parsing cost to one pass
 * per page rather than one per check.
 */
import * as cheerio from 'cheerio';
import { fingerprintNext } from './nextjs/detect.ts';
import { detectPlatform } from './platform/detect.ts';
import type { PlatformFingerprint } from './platform/types.ts';
import type { NextFingerprint } from './nextjs/types.ts';

export interface RedirectHop {
  url: string;
  status: number;
  location: string;
}

export interface LinkRecord {
  rawHref: string;
  href: string | null;        // resolved absolute URL, null if unresolvable
  anchor: string;
  rel: string[];
  nofollow: boolean;
  sponsored: boolean;
  ugc: boolean;
  isInternal: boolean;
  isExternal: boolean;
  isFragmentOnly: boolean;
  fragment: string | null;
  protocol: string;
  inFooter: boolean;
  inNav: boolean;
  wrapsImage: boolean;
  imageAlt: string | null;
  onclick: string | null;
  /** DOM order index, used for "links before H1" */
  order: number;
  beforeH1: boolean;
}

export interface ImageRecord {
  src: string;
  rawSrc: string;
  alt: string | null;
  hasAltAttr: boolean;
  width: number | null;
  height: number | null;
  loading: string | null;
  isNextImage: boolean;
  inLink: boolean;
}

export interface AssetRecord {
  url: string;
  rawUrl: string;
  isInline: boolean;
  async: boolean;
  defer: boolean;
  inHead: boolean;
}

export interface TableRecord {
  hasCaption: boolean;
  hasTh: boolean;
}

export interface FormRecord {
  method: string;
  action: string | null;
  hasPasswordField: boolean;
  postsToHttp: boolean;
}

export interface HeadingRecord {
  level: number;
  text: string;
  hasInnerTags: boolean;
  startsLowercase: boolean;
}

export interface PageData {
  // ---- request / response -------------------------------------------------
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  redirectChain: RedirectHop[];
  ttfbMs: number;
  totalMs: number;
  bytes: number;
  contentType: string;
  html: string;
  fetchError: string | null;
  timedOut: boolean;
  isHtml: boolean;
  depth: number;
  /** discovered in an XML sitemap */
  inSitemap: boolean;
  sitemapsContaining: string[];
  disallowedByRobots: boolean;

  // ---- document structure -------------------------------------------------
  doctype: string | null;
  hasDoctype: boolean;
  contentBeforeDoctype: string;
  contentAfterHtml: string;
  tag: {
    htmlOpen: number; htmlClose: number;
    headOpen: number; headClose: number;
    bodyOpen: number; bodyClose: number;
    title: number; description: number; h1: number;
  };
  htmlTagEmpty: boolean;

  // ---- head ---------------------------------------------------------------
  title: string | null;
  titles: string[];
  description: string | null;
  descriptions: string[];
  canonical: string | null;
  canonicals: string[];
  canonicalHeader: string | null;
  canonicalInHead: boolean;
  canonicalIsRelative: boolean;
  metaRobots: string[];
  metaRobotsOutsideHead: boolean;
  xRobotsTag: string | null;
  charset: string | null;
  viewports: string[];
  baseHrefs: string[];
  htmlLang: string | null;
  hreflang: Array<{ href: string; lang: string; rawHref: string }>;
  favicon: string | null;
  noscriptInHeadInvalid: boolean;

  // ---- social -------------------------------------------------------------
  og: Record<string, string>;
  twitter: Record<string, string>;

  // ---- content ------------------------------------------------------------
  headings: HeadingRecord[];
  h1s: string[];
  h2s: string[];
  bodyText: string;
  wordCount: number;
  textLength: number;
  textToCodeRatio: number;
  paragraphCount: number;
  listCount: number;
  strongCount: number;
  commentBytes: number;
  hasLoremIpsum: boolean;
  hasPhpError: boolean;
  hasCaptcha: boolean;
  hasAdminAuthor: boolean;
  lastModified: string | null;

  /**
   * True when this row is a sub-resource the crawler fetched to size it (a
   * stylesheet, script or image referenced by a page) rather than a URL the
   * site publishes as content. Status and transport checks still apply to
   * these — a 404 stylesheet is a real finding — but content checks must not,
   * or every bundler chunk is reported as a page needing a title.
   */
  isSubresource: boolean;

  // ---- links / assets -----------------------------------------------------
  links: LinkRecord[];
  images: ImageRecord[];
  scripts: AssetRecord[];
  stylesheets: AssetRecord[];

  // ---- code ---------------------------------------------------------------
  domNodes: number;
  domDepth: number;
  domMaxWidth: number;
  styleAttrCount: number;
  duplicateIds: string[];
  tables: TableRecord[];
  forms: FormRecord[];
  gtmCodes: string[];
  gtmInBody: boolean;
  mapTagCount: number;
  legacyPluginCount: number;
  structuredDataFormats: string[];
  emptySrcCount: number;

  // ---- framework ----------------------------------------------------------
  next: NextFingerprint;
  /** what the site is built with — gates checks that cannot apply. */
  platform: PlatformFingerprint;

  // ---- JavaScript rendering ------------------------------------------------
  /** true when this record was built from the post-hydration DOM */
  renderedWithJs: boolean;
  /** console.error output and uncaught exceptions raised while the page ran */
  jsConsoleErrors: string[];
  /** navigationStart -> domContentLoadedEventEnd, browser path only */
  domContentLoadedMs: number;
  /** navigationStart -> loadEventEnd, browser path only */
  loadCompleteMs: number;
  /**
   * Visible body text in the *server* response, recorded even on the rendered
   * path. The gap between this and `textLength` is precisely how much content
   * only exists after hydration.
   */
  serverTextLength: number;
  /** the framework mount point found, when the server response was a shell */
  spaFramework: string | null;
  /** true when the raw server HTML was a client-rendered shell */
  isClientRenderedShell: boolean;
}

export interface ExtractInput {
  url: string;
  finalUrl: string;
  status: number;
  headers: Record<string, string>;
  html: string;
  redirectChain: RedirectHop[];
  ttfbMs: number;
  totalMs: number;
  fetchError?: string | null;
  timedOut?: boolean;
  depth?: number;
  /** set for stylesheets, scripts and images fetched by the asset pass */
  isSubresource?: boolean;
  /** set when `html` is post-hydration DOM rather than the raw response */
  renderedWithJs?: boolean;
  jsConsoleErrors?: string[];
  domContentLoadedMs?: number;
  loadCompleteMs?: number;
  /**
   * Body text length of the raw server response. On the rendered path the
   * caller supplies this from the pre-render fetch so the hydration gap stays
   * measurable; on the raw path it is derived from `html` itself.
   */
  serverTextLength?: number;
  spaFramework?: string | null;
  isClientRenderedShell?: boolean;
}

// ---------------------------------------------------------------------------

const LOREM = /\blorem\s+ipsum\b|\bdolor\s+sit\s+amet\b/i;
const PHP_ERROR = /(Fatal error|Parse error|Warning):\s*.{0,80}\bin\b\s+\/?\w[^\s<]*\.php\s+on line \d+/i;
const CAPTCHA = /recaptcha|hcaptcha|g-recaptcha|cf-turnstile|are you a robot/i;
const GTM = /GTM-[A-Z0-9]{4,10}/g;
const NON_DESCRIPTIVE_ANCHORS = new Set([
  'click here', 'here', 'read more', 'more', 'link', 'this', 'this page', 'learn more',
  'continue', 'continue reading', 'go', 'download', 'view', 'see more', 'details',
]);

export function isNonDescriptiveAnchor(anchor: string): boolean {
  return NON_DESCRIPTIVE_ANCHORS.has(anchor.trim().toLowerCase().replace(/[.!:>»→]+$/, '').trim());
}

/** Canonical form used for cross-page identity: lowercase host, no fragment, no trailing slash. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname !== '/' && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
    return u.toString();
  } catch {
    return raw;
  }
}

function resolve(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function sameSite(a: string, b: string): boolean {
  try {
    const ha = new URL(a).hostname.replace(/^www\./, '');
    const hb = new URL(b).hostname.replace(/^www\./, '');
    return ha === hb;
  } catch {
    return false;
  }
}

function countOccurrences(haystack: string, needle: RegExp): number {
  return (haystack.match(needle) ?? []).length;
}

/**
 * Count a closing structural tag, discounting React's streaming completion.
 *
 * When streaming SSR finishes — especially after a bailout to client rendering —
 * React flushes a second `</body></html>` pair at the end of the byte stream.
 * The document is still well-formed and browsers ignore the repeat, so counting
 * raw occurrences reports every streamed Next.js page as critically malformed.
 *
 * A genuine duplicate has real markup between the two occurrences. A streaming
 * flush has only scripts, whitespace and further closing tags, so if nothing
 * substantive sits between the first and last occurrence we count them as one.
 */
function countClosingTag(html: string, tag: 'html' | 'body'): number {
  const re = new RegExp('</' + tag + '\\s*>', 'gi');
  const positions = [...html.matchAll(re)].map((m) => m.index ?? 0);
  if (positions.length <= 1) return positions.length;

  const between = html.slice(positions[0]!, positions[positions.length - 1]!)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(html|body|div|template)[^>]*>/gi, '')
    .trim();

  return between.length === 0 ? 1 : positions.length;
}

// ---------------------------------------------------------------------------

export function extractPage(input: ExtractInput): PageData {
  const {
    url, finalUrl, status, headers, html,
    redirectChain, ttfbMs, totalMs,
  } = input;

  const contentType = (headers['content-type'] ?? '').toLowerCase();
  const isHtml = contentType.includes('text/html') || contentType.includes('application/xhtml');
  const bytes = Buffer.byteLength(html, 'utf8');

  // Non-HTML or failed responses skip parsing entirely; status-code checks still apply.
  if (!isHtml || !html) {
    return emptyPage(input, contentType, bytes, isHtml);
  }

  const $ = cheerio.load(html, { xml: false });
  const base = finalUrl;

  // ---- raw-string structural facts (cheerio normalises these away) ---------
  const doctypeMatch = html.match(/<!doctype\s+([^>]*)>/i);
  const beforeDoctype = doctypeMatch
    ? html.slice(0, html.toLowerCase().indexOf('<!doctype')).trim()
    : '';
  const htmlCloseIdx = html.toLowerCase().lastIndexOf('</html>');
  const afterHtml = htmlCloseIdx >= 0 ? html.slice(htmlCloseIdx + 7).trim() : '';

  const tag = {
    htmlOpen: countOccurrences(html, /<html[\s>]/gi),
    htmlClose: countClosingTag(html, 'html'),
    headOpen: countOccurrences(html, /<head[\s>]/gi),
    headClose: countOccurrences(html, /<\/head\s*>/gi),
    bodyOpen: countOccurrences(html, /<body[\s>]/gi),
    bodyClose: countClosingTag(html, 'body'),
    title: $('title').length,
    description: $('meta[name="description" i]').length,
    h1: $('h1').length,
  };

  const commentBytes = (html.match(/<!--[\s\S]*?-->/g) ?? [])
    .filter((c) => !/^<!--\s*\[if|^<!--\s*\$|^<!--\/?\$/.test(c))
    .reduce((s, c) => s + c.length, 0);

  // ---- head ---------------------------------------------------------------
  const titles = $('title').map((_, el) => $(el).text().trim()).get();
  const descriptions = $('meta[name="description" i]')
    .map((_, el) => ($(el).attr('content') ?? '').trim()).get();

  const canonicalEls = $('link[rel="canonical" i]');
  const canonicalsRaw = canonicalEls.map((_, el) => ($(el).attr('href') ?? '').trim()).get();
  const canonicals = canonicalsRaw.map((h) => resolve(base, h)).filter((h): h is string => !!h);
  const canonicalInHead = canonicalEls.toArray().every((el) => $(el).parents('head').length > 0);
  const canonicalIsRelative = canonicalsRaw.some((h) => h !== '' && !/^https?:\/\//i.test(h));

  const linkHeader = headers['link'] ?? '';
  const canonicalHeaderMatch = linkHeader.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?canonical"?/i);

  const metaRobotsEls = $('meta[name="robots" i], meta[name="googlebot" i]');
  const metaRobots = metaRobotsEls.map((_, el) => ($(el).attr('content') ?? '').toLowerCase()).get();
  const metaRobotsOutsideHead = metaRobotsEls.toArray().some((el) => $(el).parents('head').length === 0);

  // Three valid ways to declare encoding: the modern meta[charset], the legacy
  // http-equiv form, and the Content-Type response header.
  const charset = $('meta[charset]').attr('charset')
    ?? $('meta[http-equiv="content-type" i]').attr('content')?.match(/charset=([\w-]+)/i)?.[1]
    ?? headers['content-type']?.match(/charset=([\w-]+)/i)?.[1]
    ?? null;

  const viewports = $('meta[name="viewport" i]').map((_, el) => $(el).attr('content') ?? '').get();
  const baseHrefs = $('base[href]').map((_, el) => ($(el).attr('href') ?? '').trim()).get();

  const hreflang = $('link[rel="alternate" i][hreflang]').map((_, el) => {
    const rawHref = ($(el).attr('href') ?? '').trim();
    return { rawHref, href: resolve(base, rawHref) ?? rawHref, lang: ($(el).attr('hreflang') ?? '').trim() };
  }).get();

  const faviconRaw = $('link[rel~="icon" i]').attr('href') ?? null;

  // A <noscript> in <head> may only contain link/style/meta.
  const noscriptInHeadInvalid = $('head noscript').toArray().some((el) => {
    const inner = $(el).html() ?? '';
    return /<(?!\/?(link|style|meta)\b)[a-z]/i.test(inner);
  });

  // ---- social -------------------------------------------------------------
  const og: Record<string, string> = {};
  $('meta[property^="og:" i]').each((_, el) => {
    const p = ($(el).attr('property') ?? '').toLowerCase().slice(3);
    if (p && !(p in og)) og[p] = ($(el).attr('content') ?? '').trim();
  });
  const twitter: Record<string, string> = {};
  $('meta[name^="twitter:" i]').each((_, el) => {
    const p = ($(el).attr('name') ?? '').toLowerCase().slice(8);
    if (p && !(p in twitter)) twitter[p] = ($(el).attr('content') ?? '').trim();
  });

  // ---- content ------------------------------------------------------------
  const headings: HeadingRecord[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, ' ').trim();
    const inner = $el.html() ?? '';
    headings.push({
      level: Number(el.tagName.slice(1)),
      text,
      hasInnerTags: /<(?!\/?(b|i|em|strong|span|br)\b)[a-z]/i.test(inner),
      startsLowercase: /^[a-z]/.test(text),
    });
  });

  const $body = $('body');
  const bodyClone = $body.clone();
  bodyClone.find('script, style, noscript, template, svg').remove();
  const bodyText = bodyClone.text().replace(/\s+/g, ' ').trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;

  // ---- links --------------------------------------------------------------
  const firstH1 = $('h1').first();
  const allElements = $('*').toArray();
  const h1Index = firstH1.length ? allElements.indexOf(firstH1[0]!) : -1;

  const links: LinkRecord[] = [];
  $('a').each((i, el) => {
    const $el = $(el);
    const rawHref = ($el.attr('href') ?? '').trim();
    const rel = ($el.attr('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const anchor = $el.text().replace(/\s+/g, ' ').trim();
    const $img = $el.find('img').first();
    const isFragmentOnly = rawHref.startsWith('#');
    const resolved = rawHref && !rawHref.startsWith('javascript:') ? resolve(base, rawHref) : null;

    let protocol = '';
    try { protocol = resolved ? new URL(resolved).protocol : (rawHref.split(':')[0] ?? '') + ':'; } catch { /* ignore */ }

    const order = allElements.indexOf(el);
    links.push({
      rawHref,
      href: resolved,
      anchor,
      rel,
      nofollow: rel.includes('nofollow'),
      sponsored: rel.includes('sponsored'),
      ugc: rel.includes('ugc'),
      isInternal: !!resolved && sameSite(resolved, base),
      isExternal: !!resolved && !sameSite(resolved, base) && /^https?:/.test(protocol),
      isFragmentOnly,
      fragment: (() => { try { return resolved ? (new URL(resolved).hash || null) : null; } catch { return null; } })(),
      protocol,
      inFooter: $el.parents('footer, [role="contentinfo"], .footer, #footer').length > 0,
      inNav: $el.parents('nav, [role="navigation"], header').length > 0,
      wrapsImage: $img.length > 0,
      imageAlt: $img.length > 0 ? ($img.attr('alt') ?? null) : null,
      onclick: $el.attr('onclick') ?? null,
      order,
      beforeH1: h1Index >= 0 && order < h1Index,
    });
  });

  // ---- images / assets ----------------------------------------------------
  const images: ImageRecord[] = $('img').map((_, el) => {
    const $el = $(el);
    const rawSrc = ($el.attr('src') ?? '').trim();
    const w = Number($el.attr('width'));
    const h = Number($el.attr('height'));
    return {
      rawSrc,
      src: resolve(base, rawSrc) ?? rawSrc,
      alt: $el.attr('alt') ?? null,
      hasAltAttr: $el.attr('alt') !== undefined,
      width: Number.isFinite(w) ? w : null,
      height: Number.isFinite(h) ? h : null,
      loading: $el.attr('loading') ?? null,
      isNextImage: $el.attr('data-nimg') !== undefined || rawSrc.includes('/_next/image?'),
      inLink: $el.parents('a').length > 0,
    };
  }).get();

  const scripts: AssetRecord[] = $('script').map((_, el) => {
    const $el = $(el);
    const rawUrl = ($el.attr('src') ?? '').trim();
    return {
      rawUrl,
      url: rawUrl ? (resolve(base, rawUrl) ?? rawUrl) : '',
      isInline: !rawUrl,
      async: $el.attr('async') !== undefined,
      defer: $el.attr('defer') !== undefined,
      inHead: $el.parents('head').length > 0,
    };
  }).get();

  const stylesheets: AssetRecord[] = $('link[rel="stylesheet" i]').map((_, el) => {
    const $el = $(el);
    const rawUrl = ($el.attr('href') ?? '').trim();
    return {
      rawUrl,
      url: rawUrl ? (resolve(base, rawUrl) ?? rawUrl) : '',
      isInline: false,
      async: false,
      defer: false,
      inHead: $el.parents('head').length > 0,
    };
  }).get();

  // ---- DOM metrics --------------------------------------------------------
  // Traverse through cheerio selections rather than raw nodes: the node type is
  // not exported in cheerio 1.x, and this keeps the walk fully typed.
  let domDepth = 0;
  let domMaxWidth = 0;
  const measure = (sel: cheerio.Cheerio<never>, d: number): void => {
    if (d > domDepth) domDepth = d;
    const kids = sel.children();
    if (kids.length > domMaxWidth) domMaxWidth = kids.length;
    kids.each((_, k) => measure($(k) as unknown as cheerio.Cheerio<never>, d + 1));
  };
  measure($('html') as unknown as cheerio.Cheerio<never>, 1);

  // ---- ids / tables / forms ----------------------------------------------
  const idCounts = new Map<string, number>();
  $('[id]').each((_, el) => {
    const id = $(el).attr('id')!;
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  });
  const duplicateIds = [...idCounts.entries()].filter(([, n]) => n > 1).map(([id]) => id);

  const tables: TableRecord[] = $('table').map((_, el) => ({
    hasCaption: $(el).find('caption').length > 0,
    hasTh: $(el).find('th').length > 0,
  })).get();

  const forms: FormRecord[] = $('form').map((_, el) => {
    const $el = $(el);
    const action = $el.attr('action') ?? null;
    const abs = action ? resolve(base, action) : null;
    return {
      method: ($el.attr('method') ?? 'get').toLowerCase(),
      action,
      hasPasswordField: $el.find('input[type="password" i]').length > 0,
      postsToHttp: !!abs && abs.startsWith('http://'),
    };
  }).get();

  const structuredDataFormats: string[] = [];
  if ($('script[type="application/ld+json"]').length) structuredDataFormats.push('json-ld');
  if ($('[itemscope]').length) structuredDataFormats.push('microdata');
  if ($('[typeof], [vocab]').length) structuredDataFormats.push('rdfa');

  const gtmCodes = [...new Set(html.match(GTM) ?? [])];
  const bodyHtml = $body.html() ?? '';

  const textLength = bodyText.length;

  // Fingerprint once: the platform detector defers to it for Next.js.
  const nextFingerprint = fingerprintNext({ url: finalUrl, status, headers, html });

  return {
    url,
    finalUrl,
    status,
    headers,
    redirectChain,
    ttfbMs,
    totalMs,
    bytes,
    contentType,
    html,
    fetchError: input.fetchError ?? null,
    timedOut: input.timedOut ?? false,
    isHtml,
    depth: input.depth ?? 0,
    inSitemap: false,
    sitemapsContaining: [],
    disallowedByRobots: false,

    doctype: doctypeMatch?.[1]?.trim() ?? null,
    hasDoctype: !!doctypeMatch,
    contentBeforeDoctype: beforeDoctype,
    contentAfterHtml: afterHtml,
    tag,
    htmlTagEmpty: ($('html').html() ?? '').trim().length === 0,

    title: titles[0] ?? null,
    titles,
    description: descriptions[0] ?? null,
    descriptions,
    canonical: canonicals[0] ?? null,
    canonicals,
    canonicalHeader: canonicalHeaderMatch?.[1] ?? null,
    canonicalInHead,
    canonicalIsRelative,
    metaRobots,
    metaRobotsOutsideHead,
    xRobotsTag: headers['x-robots-tag'] ?? null,
    charset,
    viewports,
    baseHrefs,
    htmlLang: $('html').attr('lang') ?? null,
    hreflang,
    favicon: faviconRaw ? resolve(base, faviconRaw) : null,
    noscriptInHeadInvalid,

    og,
    twitter,

    headings,
    h1s: headings.filter((h) => h.level === 1).map((h) => h.text),
    h2s: headings.filter((h) => h.level === 2).map((h) => h.text),
    bodyText,
    wordCount,
    textLength,
    textToCodeRatio: bytes > 0 ? textLength / bytes : 0,
    paragraphCount: $('p').length,
    listCount: $('ul, ol, dl').length,
    strongCount: $('strong, b').length,
    commentBytes,
    hasLoremIpsum: LOREM.test(bodyText),
    hasPhpError: PHP_ERROR.test(html),
    hasCaptcha: CAPTCHA.test(html),
    hasAdminAuthor: /(?:by|author)[:\s]+admin\b/i.test(bodyText),
    lastModified: headers['last-modified'] ?? null,

    isSubresource: input.isSubresource ?? false,

    links,
    images,
    scripts,
    stylesheets,

    domNodes: allElements.length,
    domDepth,
    domMaxWidth,
    styleAttrCount: $('[style]').length,
    duplicateIds,
    tables,
    forms,
    gtmCodes,
    gtmInBody: GTM.test(bodyHtml) || /googletagmanager\.com\/gtm\.js/.test(bodyHtml),
    mapTagCount: $('map').length,
    legacyPluginCount: $('applet, embed, object[classid]').length,
    structuredDataFormats,
    emptySrcCount: $('[src=""]').length,

    next: nextFingerprint,
    platform: detectPlatform({ url: finalUrl, status, headers, html, isNext: nextFingerprint.isNext }),

    renderedWithJs: input.renderedWithJs ?? false,
    jsConsoleErrors: input.jsConsoleErrors ?? [],
    domContentLoadedMs: input.domContentLoadedMs ?? 0,
    loadCompleteMs: input.loadCompleteMs ?? 0,
    serverTextLength: input.serverTextLength ?? bodyText.length,
    spaFramework: input.spaFramework ?? null,
    isClientRenderedShell: input.isClientRenderedShell ?? false,
  };
}

/** Minimal record for non-HTML or failed fetches. */
function emptyPage(i: ExtractInput, contentType: string, bytes: number, isHtml: boolean): PageData {
  const stubNext = fingerprintNext({ url: i.finalUrl, status: i.status, headers: i.headers, html: i.html });

  return {
    url: i.url, finalUrl: i.finalUrl, status: i.status, headers: i.headers,
    redirectChain: i.redirectChain, ttfbMs: i.ttfbMs, totalMs: i.totalMs, bytes,
    contentType, html: i.html, fetchError: i.fetchError ?? null,
    timedOut: i.timedOut ?? false, isHtml, depth: i.depth ?? 0,
    inSitemap: false, sitemapsContaining: [], disallowedByRobots: false,
    doctype: null, hasDoctype: false, contentBeforeDoctype: '', contentAfterHtml: '',
    tag: { htmlOpen: 0, htmlClose: 0, headOpen: 0, headClose: 0, bodyOpen: 0, bodyClose: 0, title: 0, description: 0, h1: 0 },
    htmlTagEmpty: false,
    title: null, titles: [], description: null, descriptions: [],
    canonical: null, canonicals: [], canonicalHeader: null, canonicalInHead: true,
    canonicalIsRelative: false, metaRobots: [], metaRobotsOutsideHead: false,
    xRobotsTag: i.headers['x-robots-tag'] ?? null, charset: null, viewports: [], baseHrefs: [],
    htmlLang: null, hreflang: [], favicon: null, noscriptInHeadInvalid: false,
    og: {}, twitter: {},
    headings: [], h1s: [], h2s: [], bodyText: '', wordCount: 0, textLength: 0,
    textToCodeRatio: 0, paragraphCount: 0, listCount: 0, strongCount: 0, commentBytes: 0,
    hasLoremIpsum: false, hasPhpError: false, hasCaptcha: false, hasAdminAuthor: false,
    lastModified: i.headers['last-modified'] ?? null,
    isSubresource: i.isSubresource ?? false,
    links: [], images: [], scripts: [], stylesheets: [],
    domNodes: 0, domDepth: 0, domMaxWidth: 0, styleAttrCount: 0, duplicateIds: [],
    tables: [], forms: [], gtmCodes: [], gtmInBody: false, mapTagCount: 0,
    legacyPluginCount: 0, structuredDataFormats: [], emptySrcCount: 0,
    next: stubNext,
    platform: detectPlatform({ url: i.finalUrl, status: i.status, headers: i.headers, html: i.html, isNext: stubNext.isNext }),
    renderedWithJs: i.renderedWithJs ?? false,
    jsConsoleErrors: i.jsConsoleErrors ?? [],
    domContentLoadedMs: i.domContentLoadedMs ?? 0,
    loadCompleteMs: i.loadCompleteMs ?? 0,
    serverTextLength: i.serverTextLength ?? 0,
    spaFramework: i.spaFramework ?? null,
    isClientRenderedShell: i.isClientRenderedShell ?? false,
  };
}
