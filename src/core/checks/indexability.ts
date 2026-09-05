/**
 * Indexability — 57 checks.
 * Anything that can block or complicate crawling and indexing by Googlebot.
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck } from './types.ts';
import { normalizeUrl, type PageData } from '../extract.ts';

const robotsHas = (p: PageData, directive: string): boolean =>
  p.metaRobots.some((r) => r.split(',').map((s) => s.trim()).includes(directive));

const headerHas = (p: PageData, directive: string): boolean =>
  (p.xRobotsTag ?? '').toLowerCase().split(',').map((s) => s.trim()).includes(directive);

const isNoindex = (p: PageData): boolean => robotsHas(p, 'none') || robotsHas(p, 'noindex') || headerHas(p, 'noindex') || headerHas(p, 'none');
const isNofollow = (p: PageData): boolean => robotsHas(p, 'none') || robotsHas(p, 'nofollow') || headerHas(p, 'nofollow') || headerHas(p, 'none');

// ---------------------------------------------------------------------------
// Canonical
// ---------------------------------------------------------------------------

const canonicalChecks: PageCheck[] = [
  pageCheck({
    id: 'canonical-is-missing',
    title: 'Canonical is missing',
    category: 'indexability', severity: 'warning',
    why: 'Without a canonical, Google chooses which URL to index. On sites with URL parameters, session ids or trailing-slash variants this splits ranking signals across near-identical URLs.',
    fix: 'Add a self-referencing <link rel="canonical" href="..."> to every indexable page. In Next.js App Router set alternates.canonical in generateMetadata.',
    test: (p) => p.canonicals.length === 0 && !p.canonicalHeader,
  }),
  pageCheck({
    id: 'canonical-is-empty',
    title: 'Canonical is empty',
    category: 'indexability', severity: 'critical',
    why: 'An empty href resolves to the current URL in some parsers and is ignored by others. Behaviour is undefined, so the signal is unreliable.',
    fix: 'Either populate the href with an absolute URL or remove the tag entirely.',
    test: (p) => p.canonicals.length > 0 && p.canonicals.some((c) => c.trim() === ''),
  }),
  pageCheck({
    id: 'canonical-not-equal-url',
    title: 'Canonical ≠ URL',
    category: 'indexability', severity: 'warning',
    why: 'This page points at a different URL as the indexing target, so it will not be indexed in its own right. That is correct for genuine duplicates and a serious error otherwise.',
    fix: 'Confirm the target is intentional. If this page should rank, make the canonical self-referencing.',
    test: (p) => {
      if (!p.canonical) return false;
      return normalizeUrl(p.canonical) !== normalizeUrl(p.finalUrl)
        ? 'canonical -> ' + p.canonical : false;
    },
  }),
  pageCheck({
    id: 'canonical-relative-url',
    title: 'Canonical is a relative URL',
    category: 'indexability', severity: 'warning',
    why: 'Relative canonicals resolve against the <base> tag, which is easy to get wrong and can silently point at the wrong host after a migration.',
    fix: 'Always use absolute canonical URLs including the protocol and host. In Next.js set metadataBase so relative values are resolved correctly at build time.',
    test: (p) => p.canonicalIsRelative,
  }),
  pageCheck({
    id: 'canonical-outside-head',
    title: 'Canonical outside of <head>',
    category: 'indexability', severity: 'critical',
    why: 'Google only honours rel=canonical inside <head>. A canonical in <body> is ignored entirely, so the page behaves as if it had none.',
    fix: 'Move the tag into <head>. This usually happens when a component injects it after hydration or an unclosed tag in <head> forces the parser to open <body> early.',
    test: (p) => p.canonicals.length > 0 && !p.canonicalInHead,
  }),
  pageCheck({
    id: 'multiple-canonical-tags',
    title: 'Multiple canonical tags',
    category: 'indexability', severity: 'warning',
    why: 'When more than one canonical is declared, Google ignores all of them and picks its own target.',
    fix: 'Emit exactly one canonical. Check for a layout and a page component both setting it.',
    test: (p) => {
      const total = p.canonicals.length + (p.canonicalHeader ? 1 : 0);
      return total > 1 ? total + ' canonical directives' : false;
    },
  }),
  pageCheck({
    id: 'mismatched-canonical-html-header',
    title: 'Mismatched canonical tag in HTML and HTTP header',
    category: 'indexability', severity: 'critical',
    why: 'The HTML canonical and the Link header name different targets. Conflicting signals mean Google disregards both.',
    fix: 'Emit the canonical in one place only, normally the HTML tag.',
    test: (p) => {
      if (!p.canonical || !p.canonicalHeader) return false;
      return normalizeUrl(p.canonical) !== normalizeUrl(p.canonicalHeader)
        ? 'html: ' + p.canonical + ' / header: ' + p.canonicalHeader : false;
    },
  }),
  pageCheck({
    id: 'canonical-tag-html-and-header',
    title: 'Canonical tag in HTML and HTTP header',
    category: 'duplicate-content', severity: 'notice',
    why: 'Declaring the same canonical twice is redundant and risks the two drifting apart during future changes.',
    fix: 'Keep the HTML tag and drop the Link header, or vice versa.',
    test: (p) => !!p.canonical && !!p.canonicalHeader,
  }),
  pageCheck({
    id: 'canonical-to-non-200',
    title: 'Canonical to non-200',
    category: 'indexability', severity: 'blocker',
    why: 'The canonical points at a URL that does not return 200. Google cannot consolidate signals onto a page that does not exist, so this page may drop out of the index entirely.',
    fix: 'Point the canonical at a live 200 URL.',
    test: (p, site) => {
      if (!p.canonical) return false;
      const t = site.byUrl.get(normalizeUrl(p.canonical));
      return t && t.status !== 200 ? 'canonical -> ' + t.status + ' ' + p.canonical : false;
    },
  }),
  pageCheck({
    id: 'canonical-points-redirect',
    title: 'Canonical points to a redirect',
    category: 'indexability', severity: 'critical',
    why: 'Canonicalising to a redirect adds a hop before Google reaches the real target and weakens the consolidation signal.',
    fix: 'Point the canonical at the final destination URL directly.',
    test: (p, site) => {
      if (!p.canonical) return false;
      const t = site.byUrl.get(normalizeUrl(p.canonical));
      return t && t.status >= 300 && t.status < 400 ? 'canonical -> ' + t.status : false;
    },
  }),
  pageCheck({
    id: 'canonical-points-noindex',
    title: 'Canonical points to a noindex URL',
    category: 'indexability', severity: 'critical',
    why: 'Signals are consolidated onto a page that is explicitly excluded from the index, so neither URL can rank.',
    fix: 'Either remove noindex from the target or point the canonical elsewhere.',
    test: (p, site) => {
      if (!p.canonical) return false;
      const t = site.byUrl.get(normalizeUrl(p.canonical));
      return !!t && isNoindex(t);
    },
  }),
  pageCheck({
    id: 'canonical-points-disallowed',
    title: 'Canonical points to a disallowed URL',
    category: 'indexability', severity: 'critical',
    why: 'Google cannot crawl the canonical target, so it cannot verify the relationship or transfer signals.',
    fix: 'Allow the target in robots.txt, or canonicalise to a crawlable URL.',
    test: (p, site) => !!p.canonical && site.robots.isDisallowed(p.canonical),
  }),
  pageCheck({
    id: 'canonical-points-another-canonicalized-url',
    title: 'Canonical points to another canonicalized URL',
    category: 'indexability', severity: 'critical',
    why: 'Chained canonicals (A->B->C) are not reliably followed. Google may treat the chain as a contradiction and ignore it.',
    fix: 'Point every page in the group directly at the final target.',
    test: (p, site) => {
      if (!p.canonical) return false;
      const t = site.byUrl.get(normalizeUrl(p.canonical));
      if (!t || !t.canonical) return false;
      return normalizeUrl(t.canonical) !== normalizeUrl(t.finalUrl)
        && normalizeUrl(p.canonical) !== normalizeUrl(p.finalUrl);
    },
  }),
  pageCheck({
    id: 'canonicalized-url-noindex-nofollow',
    title: 'Canonicalized URL is noindex, nofollow',
    category: 'indexability', severity: 'critical',
    why: 'Combining a canonical with noindex sends contradictory instructions: consolidate this page into another, but also exclude it. Google may apply the noindex to the canonical target.',
    fix: 'Use one or the other. Canonical for duplicates, noindex for pages that must never appear.',
    test: (p) => !!p.canonical && normalizeUrl(p.canonical) !== normalizeUrl(p.finalUrl) && isNoindex(p),
  }),
  pageCheck({
    id: 'canonical-from-http-to-https',
    title: 'Canonical from HTTP to HTTPS',
    category: 'indexability', severity: 'notice',
    why: 'An HTTP page canonicalising to HTTPS is usually correct during a migration, but leaves the HTTP URL reachable.',
    fix: 'Add a 301 redirect from HTTP to HTTPS rather than relying on the canonical alone.',
    test: (p) => p.finalUrl.startsWith('http://') && !!p.canonical && p.canonical.startsWith('https://'),
  }),
  pageCheck({
    id: 'canonical-from-https-to-http',
    title: 'Canonical from HTTPS to HTTP',
    category: 'indexability', severity: 'critical',
    why: 'This asks Google to index the insecure version of a secure page — the opposite of the intended direction.',
    fix: 'Change the canonical to the HTTPS URL.',
    test: (p) => p.finalUrl.startsWith('https://') && !!p.canonical && p.canonical.startsWith('http://'),
  }),
  pageCheck({
    id: 'canonical-points-external-url',
    title: 'Canonical points to external URL',
    category: 'duplicate-content', severity: 'critical',
    why: 'The page hands its ranking signals to another domain. Correct for syndicated content, catastrophic when accidental.',
    fix: 'Verify this is deliberate. Accidental cross-domain canonicals usually come from a staging URL left in a config value.',
    test: (p) => {
      if (!p.canonical) return false;
      try {
        const c = new URL(p.canonical).hostname.replace(/^www\./, '');
        const s = new URL(p.finalUrl).hostname.replace(/^www\./, '');
        return c !== s ? 'canonical -> ' + c : false;
      } catch { return false; }
    },
  }),
  pageCheck({
    id: 'canonical-points-homepage',
    title: 'Canonical points to homepage',
    category: 'duplicate-content', severity: 'critical',
    why: 'A common template bug: every page canonicalises to the homepage, so the entire site collapses to one indexable URL.',
    fix: 'Make canonicals self-referencing per page. Check for a hardcoded site URL in a shared layout.',
    test: (p, site) => {
      if (!p.canonical) return false;
      const isHome = normalizeUrl(p.finalUrl) === normalizeUrl(site.homepageUrl);
      return !isHome && normalizeUrl(p.canonical) === normalizeUrl(site.homepageUrl);
    },
  }),
  pageCheck({
    id: 'canonical-loop',
    title: 'Canonical loop',
    category: 'duplicate-content', severity: 'critical',
    why: 'Two pages canonicalise to each other, so there is no terminal target. Google discards the signal entirely.',
    fix: 'Choose one URL as the target and make the other point at it one-directionally.',
    test: (p, site) => {
      if (!p.canonical) return false;
      const t = site.byUrl.get(normalizeUrl(p.canonical));
      if (!t || !t.canonical) return false;
      return normalizeUrl(t.canonical) === normalizeUrl(p.finalUrl)
        && normalizeUrl(p.canonical) !== normalizeUrl(p.finalUrl);
    },
  }),
];

// ---------------------------------------------------------------------------
// Robots directives
// ---------------------------------------------------------------------------

const robotsChecks: PageCheck[] = [
  pageCheck({
    id: 'meta-noindex-pages',
    title: 'Meta noindex pages',
    category: 'indexability', severity: 'critical',
    why: 'The page is explicitly excluded from search results. Intentional for admin and thank-you pages; a serious defect anywhere else.',
    fix: 'Remove the noindex directive from pages that should rank. In Next.js check the robots field in generateMetadata.',
    test: (p) => isNoindex(p),
  }),
  pageCheck({
    id: 'meta-nofollow-pages',
    title: 'Meta nofollow pages',
    category: 'indexability', severity: 'critical',
    why: 'Googlebot will not follow any link on this page, so pages reachable only from here become orphaned.',
    fix: 'Remove the nofollow directive unless this page genuinely must not pass link equity.',
    test: (p) => isNofollow(p),
  }),
  pageCheck({
    id: 'noindex-follow-page',
    title: 'Noindex follow page',
    category: 'indexability', severity: 'warning',
    why: 'The page is excluded from the index but its links are still followed. Valid for pagination and filters, but worth confirming.',
    fix: 'Confirm this is intentional. Google eventually treats long-lived noindex pages as nofollow as well.',
    test: (p) => isNoindex(p) && !isNofollow(p),
  }),
  pageCheck({
    id: 'noindex-html-and-header',
    title: 'Noindex in HTML and HTTP header',
    category: 'indexability', severity: 'warning',
    why: 'The directive is duplicated across two mechanisms, which makes it easy to remove one and believe the page is now indexable when it is not.',
    fix: 'Declare noindex in one place only.',
    test: (p) => robotsHas(p, 'noindex') && headerHas(p, 'noindex'),
  }),
  pageCheck({
    id: 'nofollow-html-and-header',
    title: 'Nofollow in HTML and HTTP header',
    category: 'indexability', severity: 'warning',
    why: 'Duplicated nofollow across tag and header, same maintenance hazard as duplicated noindex.',
    fix: 'Declare nofollow in one place only.',
    test: (p) => robotsHas(p, 'nofollow') && headerHas(p, 'nofollow'),
  }),
  pageCheck({
    id: 'mismatched-noindex-html-header',
    title: 'Mismatched noindex directives in HTML and header',
    category: 'indexability', severity: 'critical',
    why: 'The tag says index and the header says noindex, or the reverse. Google applies the most restrictive, so the page is excluded.',
    fix: 'Make the two agree, or remove one.',
    test: (p) => robotsHas(p, 'noindex') !== headerHas(p, 'noindex')
      && (robotsHas(p, 'index') || headerHas(p, 'index')),
  }),
  pageCheck({
    id: 'mismatched-nofollow-html-header',
    title: 'Mismatched nofollow directives in HTML and header',
    category: 'indexability', severity: 'critical',
    why: 'Conflicting follow/nofollow instructions. Google applies the most restrictive one, so links on this page are not crawled.',
    fix: 'Make the tag and header agree.',
    test: (p) => robotsHas(p, 'nofollow') !== headerHas(p, 'nofollow')
      && (robotsHas(p, 'follow') || headerHas(p, 'follow')),
  }),
  pageCheck({
    id: 'multiple-noindex-directives',
    title: 'Multiple noindex directives',
    category: 'indexability', severity: 'warning',
    why: 'Several noindex declarations on one page make the true state hard to audit and easy to half-remove.',
    fix: 'Consolidate to a single robots directive.',
    test: (p) => p.metaRobots.filter((r) => r.includes('noindex')).length > 1,
  }),
  pageCheck({
    id: 'meta-robots-outside-head',
    title: 'Meta robots found outside of <head>',
    category: 'indexability', severity: 'critical',
    why: 'Robots meta tags are only honoured inside <head>. Outside it they are silently ignored, so a page you believe is excluded is being indexed.',
    fix: 'Move the tag into <head>.',
    test: (p) => p.metaRobotsOutsideHead,
  }),
  pageCheck({
    id: 'disallowed-by-robots-txt',
    title: 'Disallowed by robots.txt',
    category: 'indexability', severity: 'critical',
    why: 'Googlebot is blocked from fetching this URL. It can still be indexed from links without any content, producing an empty search result.',
    fix: 'Remove the Disallow rule if the page should rank. To keep a page out of the index use noindex and leave it crawlable.',
    appliesTo: (p) => p.isHtml,
    test: (p) => p.disallowedByRobots,
  }),
  pageCheck({
    id: 'non-indexable-pages',
    title: 'Non-indexable pages',
    category: 'indexability', severity: 'warning',
    why: 'Rolls up every reason a page cannot be indexed: noindex, robots.txt block, non-200 status, or canonicalisation elsewhere.',
    fix: 'Review each cause individually in the more specific checks in this category.',
    appliesTo: (p) => p.isHtml,
    test: (p) => {
      if (p.status !== 200) return 'status ' + p.status;
      if (p.disallowedByRobots) return 'disallowed by robots.txt';
      if (isNoindex(p)) return 'noindex';
      if (p.canonical && normalizeUrl(p.canonical) !== normalizeUrl(p.finalUrl)) return 'canonicalised elsewhere';
      return false;
    },
  }),
  pageCheck({
    id: 'page-contains-rel-sponsored',
    title: 'Page contains rel=sponsored attributes',
    category: 'indexability', severity: 'notice',
    why: 'rel=sponsored marks paid links. Correct usage is required to stay within Google link-spam policy, so it is worth confirming placement is deliberate.',
    fix: 'Verify sponsored links are genuinely paid placements. Use rel=ugc for user-generated links and rel=nofollow for untrusted ones.',
    test: (p) => {
      const n = p.links.filter((l) => l.sponsored).length;
      return n > 0 ? n + ' sponsored link(s)' : false;
    },
  }),
];

// ---------------------------------------------------------------------------
// Document structure
// ---------------------------------------------------------------------------

const structureChecks: PageCheck[] = [
  pageCheck({
    id: 'html-tag-missing', title: '<html> tag is missing',
    category: 'indexability', severity: 'critical',
    why: 'A document without a root <html> element is invalid. Parsers recover differently, so rendering and extraction become unpredictable.',
    fix: 'Ensure the document template emits <html>.',
    test: (p) => p.tag.htmlOpen === 0,
  }),
  pageCheck({
    id: 'html-close-missing', title: '</html> tag is missing',
    category: 'indexability', severity: 'warning',
    why: 'An unclosed root element usually means the response was truncated mid-render.',
    fix: 'Check for a server error or timeout during streaming.',
    test: (p) => p.tag.htmlOpen > 0 && p.tag.htmlClose === 0,
  }),
  pageCheck({
    id: 'head-tag-missing', title: '<head> tag is missing',
    category: 'indexability', severity: 'critical',
    why: 'Without <head>, browsers auto-create one and metadata placement becomes unreliable — title, canonical and robots tags may be reparented into <body> and ignored.',
    fix: 'Ensure the template emits an explicit <head>.',
    test: (p) => p.tag.headOpen === 0,
  }),
  pageCheck({
    id: 'head-close-missing', title: '</head> tag is missing',
    category: 'indexability', severity: 'warning',
    why: 'An unclosed <head> causes the parser to guess where <body> begins, which can push metadata out of scope.',
    fix: 'Close the head element explicitly.',
    test: (p) => p.tag.headOpen > 0 && p.tag.headClose === 0,
  }),
  pageCheck({
    id: 'body-tag-missing', title: '<body> tag is missing',
    category: 'indexability', severity: 'critical',
    why: 'No body element means no defined content container. Extraction and rendering both degrade.',
    fix: 'Ensure the template emits <body>.',
    test: (p) => p.tag.bodyOpen === 0,
  }),
  pageCheck({
    id: 'body-close-missing', title: '</body> tag is missing',
    category: 'indexability', severity: 'warning',
    why: 'Usually indicates a truncated response or a template that terminates early.',
    fix: 'Verify the full document is being flushed.',
    test: (p) => p.tag.bodyOpen > 0 && p.tag.bodyClose === 0,
  }),
  pageCheck({
    id: 'multiple-html-tags', title: 'More than one <html> tag on page',
    category: 'indexability', severity: 'critical',
    why: 'Two root elements means two documents concatenated — usually a template rendered twice or a fragment injected at the wrong level.',
    fix: 'Find the duplicated layout wrapper.',
    test: (p) => p.tag.htmlOpen > 1,
  }),
  pageCheck({
    id: 'multiple-html-close', title: 'More than one </html> tag on page',
    category: 'indexability', severity: 'critical',
    why: 'Duplicate closing root tags corrupt the parse tree; content after the first is often discarded.',
    fix: 'Remove the duplicate closing tag from the template.',
    test: (p) => p.tag.htmlClose > 1,
  }),
  pageCheck({
    id: 'multiple-head-tags', title: 'More than one <head> tag on page',
    category: 'indexability', severity: 'critical',
    why: 'Only the first head is honoured. Metadata declared in the second is silently dropped.',
    fix: 'Merge the two head sections.',
    test: (p) => p.tag.headOpen > 1,
  }),
  pageCheck({
    id: 'multiple-head-close', title: 'More than one </head> tag on page',
    category: 'indexability', severity: 'critical',
    why: 'A premature </head> ends metadata parsing, so any tag after it lands in <body> and is ignored.',
    fix: 'Remove the stray closing tag.',
    test: (p) => p.tag.headClose > 1,
  }),
  pageCheck({
    id: 'multiple-body-tags', title: 'More than one <body> tag on page',
    category: 'indexability', severity: 'critical',
    why: 'Duplicate body elements are merged unpredictably by parsers, changing DOM structure and CSS scoping.',
    fix: 'Find the duplicated layout wrapper.',
    test: (p) => p.tag.bodyOpen > 1,
  }),
  pageCheck({
    id: 'multiple-body-close', title: 'More than one </body> tag on page',
    category: 'indexability', severity: 'critical',
    why: 'Content after the first </body> may be discarded entirely.',
    fix: 'Remove the duplicate closing tag.',
    test: (p) => p.tag.bodyClose > 1,
  }),
  pageCheck({
    id: 'content-after-html', title: 'Page has content after </html>',
    category: 'indexability', severity: 'warning',
    why: 'Markup after the closing root tag is invalid. It commonly indicates a template fragment or debug output leaking into the response.',
    fix: 'Remove trailing output. Check for stray echo/console output in server middleware.',
    test: (p) => p.contentAfterHtml.length > 0
      ? p.contentAfterHtml.length + ' bytes after </html>' : false,
  }),
  pageCheck({
    id: 'content-before-doctype', title: 'Page has content before <!doctype html>',
    category: 'indexability', severity: 'critical',
    why: 'Any output before the doctype forces browsers into quirks mode, which changes box-model and layout behaviour site-wide.',
    fix: 'Remove leading whitespace or output. Usually a BOM or a stray newline in a server template.',
    test: (p) => p.contentBeforeDoctype.length > 0
      ? JSON.stringify(p.contentBeforeDoctype.slice(0, 60)) : false,
  }),
  pageCheck({
    id: 'no-character-encoding', title: 'Page has no declared character encoding',
    category: 'indexability', severity: 'critical',
    why: 'Without a declared charset the browser guesses, which mangles non-ASCII text and can break how search engines read the content.',
    fix: 'Add <meta charset="utf-8"> as the first element in <head>, or set it in the Content-Type header.',
    test: (p) => !p.charset,
  }),
  pageCheck({
    id: 'noscript-head-invalid', title: 'Noscript in head contains invalid HTML elements',
    category: 'indexability', severity: 'warning',
    why: 'Inside <head>, a <noscript> may only contain link, style and meta. Anything else forces the parser to close <head> early, pushing the rest of your metadata into <body> where it is ignored.',
    fix: 'Move the noscript block into <body>, or restrict its contents to link/style/meta.',
    test: (p) => p.noscriptInHeadInvalid,
  }),
  pageCheck({
    id: 'multiple-base-urls', title: 'Multiple base URLs',
    category: 'indexability', severity: 'warning',
    why: 'The spec allows one <base> element. Extra ones are ignored, but their presence means relative URL resolution is not what the author expected.',
    fix: 'Keep a single <base> element, or remove it and use absolute URLs.',
    test: (p) => p.baseHrefs.length > 1,
  }),
  pageCheck({
    id: 'multiple-mismatched-base-urls', title: 'Multiple, mismatched base URLs',
    category: 'indexability', severity: 'warning',
    why: 'Several <base> elements with different values. Only the first applies, so every relative URL on the page may resolve against an unintended host.',
    fix: 'Remove all but the correct <base> element.',
    test: (p) => new Set(p.baseHrefs).size > 1 ? p.baseHrefs.join(', ') : false,
  }),
  pageCheck({
    id: 'base-url-malformed-empty', title: 'Base URL malformed or empty',
    category: 'indexability', severity: 'warning',
    why: 'An empty or invalid <base href> makes every relative link on the page resolve unpredictably.',
    fix: 'Set a valid absolute URL, or remove the element.',
    test: (p) => p.baseHrefs.some((b) => {
      if (b.trim() === '') return true;
      try { new URL(b, p.finalUrl); return false; } catch { return true; }
    }),
  }),
  pageCheck({
    id: 'h1-has-other-tags-inside', title: 'H1 has other tags inside',
    category: 'indexability', severity: 'notice',
    why: 'Block-level or interactive elements nested inside a heading make its text harder to parse and can break how the heading is announced to screen readers.',
    fix: 'Keep headings to plain text and inline formatting.',
    test: (p) => p.headings.some((h) => h.level === 1 && h.hasInnerTags),
  }),
  pageCheck({
    id: 'h2-has-other-tags-inside', title: 'H2 has other tags inside',
    category: 'indexability', severity: 'notice',
    why: 'Same parsing and accessibility concern as an H1 containing block elements.',
    fix: 'Keep headings to plain text and inline formatting.',
    test: (p) => p.headings.some((h) => h.level === 2 && h.hasInnerTags),
  }),
  pageCheck({
    id: 'double-slash-in-url', title: 'Double slash in URL',
    category: 'indexability', severity: 'warning',
    why: 'A doubled slash in the path usually serves identical content at a second URL, creating a duplicate.',
    fix: 'Normalise paths when building links and 301 the doubled form to the canonical one.',
    appliesTo: (p) => p.isHtml,
    test: (p) => {
      try { return new URL(p.finalUrl).pathname.includes('//'); } catch { return false; }
    },
  }),
  pageCheck({
    id: 'more-than-three-parameters', title: 'More than three parameters in URL',
    category: 'indexability', severity: 'notice',
    why: 'Long parameter strings multiply crawlable URL permutations and dilute crawl budget.',
    fix: 'Reduce parameters, or mark non-essential ones as ignorable and canonicalise to the clean URL.',
    appliesTo: (p) => p.isHtml,
    test: (p) => {
      try {
        const n = [...new URL(p.finalUrl).searchParams.keys()].length;
        return n > 3 ? n + ' parameters' : false;
      } catch { return false; }
    },
  }),
  pageCheck({
    id: 'form-with-get-method', title: 'Page contains a form with a GET method',
    category: 'indexability', severity: 'notice',
    why: 'GET forms generate crawlable parameterised URLs from user input, which can produce large volumes of low-value indexable pages.',
    fix: 'Use POST for search and filter forms, or block the resulting parameter patterns in robots.txt.',
    test: (p) => p.forms.some((f) => f.method === 'get'),
  }),
  pageCheck({
    id: 'content-type-not-html', title: 'Page has content-type other than text/html',
    category: 'indexability', severity: 'notice',
    why: 'A non-HTML content type on a page expected to be a document means it will not be parsed or indexed as one.',
    fix: 'Set Content-Type: text/html; charset=utf-8 for HTML responses.',
    appliesTo: (p) => p.status === 200,
    test: (p) => !p.isHtml ? p.contentType || 'no content-type' : false,
  }),
  pageCheck({
    id: 'disallowed-css-files', title: 'Page has disallowed CSS files',
    category: 'indexability', severity: 'critical',
    why: 'Blocking CSS from Googlebot prevents it from rendering the page as users see it, which affects mobile-friendliness assessment and layout-dependent evaluation.',
    fix: 'Allow CSS paths in robots.txt.',
    test: (p, site) => {
      const bad = p.stylesheets.filter((s) => s.url && site.robots.isDisallowed(s.url));
      return bad.length ? bad.length + ' blocked stylesheet(s)' : false;
    },
  }),
  pageCheck({
    id: 'disallowed-js-files', title: 'Page has disallowed JavaScript files',
    category: 'indexability', severity: 'critical',
    why: 'Blocked JavaScript prevents Googlebot from rendering client-side content, which on a JS-heavy site means large parts of the page are never seen.',
    fix: 'Allow script paths in robots.txt.',
    test: (p, site) => {
      const bad = p.scripts.filter((s) => s.url && site.robots.isDisallowed(s.url));
      return bad.length ? bad.length + ' blocked script(s)' : false;
    },
  }),
  pageCheck({
    id: 'disallowed-images', title: 'Page has disallowed images',
    category: 'indexability', severity: 'warning',
    why: 'Blocked images cannot be indexed in Google Images and cannot contribute to page rendering.',
    fix: 'Allow image paths in robots.txt.',
    test: (p, site) => {
      const bad = p.images.filter((i) => i.src && site.robots.isDisallowed(i.src));
      return bad.length ? bad.length + ' blocked image(s)' : false;
    },
  }),
];

// ---------------------------------------------------------------------------
// Site-level
// ---------------------------------------------------------------------------

const siteChecks: SiteCheck[] = [
  siteCheck({
    id: 'error-page-404-status', title: 'Error page responds 404 status code',
    category: 'indexability', severity: 'critical',
    why: 'A missing page that returns 200 is a soft 404. Google indexes the error page as real content and wastes crawl budget on infinite non-existent URLs.',
    fix: 'Return a real 404 status. In Next.js App Router call notFound() so the framework sets the status — a catch-all route rendering an error UI still returns 200 unless you do.',
    test: (site) => site.notFoundStatus !== null && site.notFoundStatus !== 404
      ? 'a known-missing URL returned ' + site.notFoundStatus : false,
  }),
  siteCheck({
    id: 'homepage-open-for-scanning', title: 'Home page is open for scanning by search engine robots in robots.txt',
    category: 'indexability', severity: 'blocker',
    why: 'If robots.txt blocks the homepage, the entire site is effectively removed from search.',
    fix: 'Remove the Disallow rule covering /.',
    test: (site) => !site.robots.homepageAllowed,
  }),
  siteCheck({
    id: 'homepage-open-for-indexing', title: 'Home page is open for indexing in search engines',
    category: 'indexability', severity: 'blocker',
    why: 'A noindex on the homepage removes the most important page on the site from search results.',
    fix: 'Remove the noindex directive from the homepage.',
    test: (site) => !site.homepageIndexable,
  }),
];

export const INDEXABILITY_CHECKS = [
  ...canonicalChecks, ...robotsChecks, ...structureChecks, ...siteChecks,
];
