/**
 * Content Relevance — 42 checks.
 *
 * Thresholds are deliberately strict and match Sitechecker's published limits so
 * parity reports line up. They live in CONTENT_LIMITS so they can be tuned in
 * one place rather than scattered through the checks.
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck } from './types.ts';

export const CONTENT_LIMITS = {
  titleMax: 60,
  titleMin: 30,
  descriptionMax: 160,
  descriptionMin: 70,
  h1Max: 70,
  h1Min: 10,
  altMax: 100,
  lowWordCount: 300,
  minCodeBytes: 500,
  textToCodeRatioMin: 0.10,
  staleAfterDays: 365,
};

const L = CONTENT_LIMITS;

const titleChecks: PageCheck[] = [
  pageCheck({
    id: 'title-is-missing', title: 'Title is missing',
    category: 'content-relevance', severity: 'blocker',
    why: 'The title tag is the single strongest on-page relevance signal and the headline of every search result. Without one Google generates its own from page content, usually badly.',
    fix: 'Add a unique <title> describing the page. In Next.js App Router export metadata.title or return it from generateMetadata.',
    test: (p) => p.tag.title === 0,
  }),
  pageCheck({
    id: 'title-is-empty', title: 'Title is empty',
    category: 'content-relevance', severity: 'blocker',
    why: 'A present but empty title is worse than none: it signals a template bug and leaves the search snippet headline blank.',
    fix: 'Populate the title, and add a fallback in the layout for pages whose data fails to load.',
    test: (p) => p.tag.title > 0 && (p.title ?? '').trim() === '',
  }),
  pageCheck({
    id: 'title-too-long', title: 'Title too long',
    category: 'content-relevance', severity: 'warning',
    why: `Titles beyond ~${L.titleMax} characters are truncated in search results, so the end of the title never reaches the user.`,
    fix: `Keep titles under ${L.titleMax} characters with the distinguishing words first.`,
    test: (p) => (p.title?.length ?? 0) > L.titleMax ? p.title!.length + ' chars' : false,
  }),
  pageCheck({
    id: 'title-too-short', title: 'Title too short',
    category: 'content-relevance', severity: 'warning',
    why: `Titles under ~${L.titleMin} characters usually waste available snippet space and under-describe the page.`,
    fix: 'Expand the title with the specific terms the page should rank for.',
    test: (p) => {
      const n = p.title?.trim().length ?? 0;
      return n > 0 && n < L.titleMin ? n + ' chars' : false;
    },
  }),
  pageCheck({
    id: 'multiple-title-tags', title: 'More than one title tag on page',
    category: 'content-relevance', severity: 'warning',
    why: 'Only the first title is used. A second one usually means a layout and a page component both set it, so the intended title is being discarded.',
    fix: 'Emit exactly one title element.',
    test: (p) => p.tag.title > 1 ? p.tag.title + ' title tags' : false,
  }),
  pageCheck({
    id: 'title-starts-lowercase', title: 'Title starts with a lowercase letter',
    category: 'content-relevance', severity: 'notice',
    why: 'A lowercase opening usually indicates a programmatically assembled title rather than an authored one, and reads as unpolished in results.',
    fix: 'Capitalise the first word.',
    test: (p) => !!p.title && /^[a-z]/.test(p.title),
  }),
  pageCheck({
    id: 'title-outdated', title: 'Page might have an outdated title',
    category: 'content-relevance', severity: 'notice',
    why: 'A title containing a year earlier than the current one signals stale content to users scanning results.',
    fix: 'Update the year in the title, or remove it so the page does not date itself.',
    test: (p) => {
      const m = p.title?.match(/\b(19|20)\d{2}\b/);
      if (!m) return false;
      const year = Number(m[0]);
      const now = new Date().getFullYear();
      return year < now ? 'title references ' + year : false;
    },
  }),
];

const descriptionChecks: PageCheck[] = [
  pageCheck({
    id: 'description-is-missing', title: 'Description is missing',
    category: 'content-relevance', severity: 'warning',
    why: 'Without a meta description Google extracts an arbitrary snippet from the page, which is rarely the most persuasive summary and directly costs click-through rate.',
    fix: 'Write a unique description per page. In Next.js set metadata.description.',
    test: (p) => p.tag.description === 0,
  }),
  pageCheck({
    id: 'description-is-empty', title: 'Description is empty',
    category: 'content-relevance', severity: 'warning',
    why: 'An empty description tag provides no snippet guidance and signals a template that failed to populate.',
    fix: 'Populate the description or remove the tag.',
    test: (p) => p.tag.description > 0 && (p.description ?? '').trim() === '',
  }),
  pageCheck({
    id: 'description-too-long', title: 'Description too long',
    category: 'content-relevance', severity: 'warning',
    why: `Descriptions beyond ~${L.descriptionMax} characters are truncated, so any call to action at the end is lost.`,
    fix: `Keep descriptions under ${L.descriptionMax} characters.`,
    test: (p) => (p.description?.length ?? 0) > L.descriptionMax ? p.description!.length + ' chars' : false,
  }),
  pageCheck({
    id: 'description-too-short', title: 'Description too short',
    category: 'content-relevance', severity: 'notice',
    why: `Under ~${L.descriptionMin} characters leaves most of the snippet unused.`,
    fix: 'Expand the description to use the available space.',
    test: (p) => {
      const n = p.description?.trim().length ?? 0;
      return n > 0 && n < L.descriptionMin ? n + ' chars' : false;
    },
  }),
  pageCheck({
    id: 'multiple-description-tags', title: 'More than one description tag on page',
    category: 'content-relevance', severity: 'warning',
    why: 'Only the first description is used; the rest are ignored, so the intended one may not be the one shown.',
    fix: 'Emit exactly one meta description.',
    test: (p) => p.tag.description > 1 ? p.tag.description + ' description tags' : false,
  }),
  pageCheck({
    id: 'description-equals-title', title: 'Description = Title',
    category: 'content-relevance', severity: 'warning',
    why: 'A description identical to the title wastes the snippet: the user reads the same sentence twice and learns nothing new.',
    fix: 'Write a description that expands on the title rather than repeating it.',
    test: (p) => !!p.title && !!p.description
      && p.title.trim().toLowerCase() === p.description.trim().toLowerCase(),
  }),
];

const headingChecks: PageCheck[] = [
  pageCheck({
    id: 'h1-is-missing', title: 'H1 is missing',
    category: 'content-relevance', severity: 'critical',
    why: 'The H1 states the page topic to both users and search engines, and anchors the document outline for assistive technology.',
    fix: 'Add exactly one H1 describing the page.',
    test: (p) => p.tag.h1 === 0,
  }),
  pageCheck({
    id: 'h1-is-empty', title: 'H1 is empty',
    category: 'content-relevance', severity: 'critical',
    why: 'An H1 element with no text provides no topic signal and usually indicates a data-binding failure.',
    fix: 'Populate the H1, with a fallback when the source field is empty.',
    test: (p) => p.tag.h1 > 0 && p.h1s.every((h) => h.trim() === ''),
  }),
  pageCheck({
    id: 'h1-too-long', title: 'H1 too long',
    category: 'content-relevance', severity: 'notice',
    why: `An H1 beyond ~${L.h1Max} characters dilutes the topic signal and rarely reads well as a page headline.`,
    fix: 'Tighten the headline; move detail into the first paragraph.',
    test: (p) => {
      const long = p.h1s.find((h) => h.length > L.h1Max);
      return long ? long.length + ' chars' : false;
    },
  }),
  pageCheck({
    id: 'h1-too-short', title: 'H1 too short',
    category: 'content-relevance', severity: 'notice',
    why: `Under ~${L.h1Min} characters an H1 is usually a label rather than a description of the page.`,
    fix: 'Expand the H1 into a descriptive headline.',
    test: (p) => {
      const s = p.h1s.find((h) => h.trim().length > 0 && h.trim().length < L.h1Min);
      return s ? '"' + s + '"' : false;
    },
  }),
  pageCheck({
    id: 'multiple-h1', title: 'More than one h1 on page',
    category: 'duplicate-content', severity: 'warning',
    why: 'Multiple H1s split the topic signal and flatten the document outline that screen readers depend on.',
    fix: 'Keep one H1 and demote the others to H2.',
    test: (p) => p.tag.h1 > 1 ? p.tag.h1 + ' H1 tags' : false,
  }),
  pageCheck({
    id: 'h1-starts-lowercase', title: 'H1 starts with a lowercase letter',
    category: 'content-relevance', severity: 'notice',
    why: 'Usually indicates a programmatically generated heading rather than authored copy.',
    fix: 'Capitalise the first word.',
    test: (p) => p.h1s.some((h) => /^[a-z]/.test(h)),
  }),
  pageCheck({
    id: 'h2-is-missing', title: 'H2 is missing',
    category: 'content-relevance', severity: 'notice',
    why: 'Long content with no subheadings is harder to scan and gives search engines fewer structural cues about subtopics.',
    fix: 'Break the content into sections with H2 subheadings.',
    test: (p) => p.wordCount > L.lowWordCount && p.h2s.length === 0,
  }),
  pageCheck({
    id: 'h2-starts-lowercase', title: 'H2 starts with a lowercase letter',
    category: 'content-relevance', severity: 'notice',
    why: 'Inconsistent heading capitalisation reads as unedited.',
    fix: 'Capitalise the first word of each subheading.',
    test: (p) => p.h2s.some((h) => /^[a-z]/.test(h)),
  }),
];

const bodyChecks: PageCheck[] = [
  pageCheck({
    id: 'low-word-count', title: 'Low word count',
    category: 'content-relevance', severity: 'warning',
    why: `Under ~${L.lowWordCount} words a page rarely covers a topic in enough depth to compete, and risks being classed as thin content.`,
    fix: 'Expand the content, or consolidate several thin pages into one substantial one.',
    test: (p) => p.wordCount < L.lowWordCount ? p.wordCount + ' words' : false,
  }),
  pageCheck({
    id: 'text-to-code-ratio-low', title: 'Text to code ratio < 10%',
    category: 'content-relevance', severity: 'warning',
    why: 'A very low ratio of visible text to markup means the page ships far more code than content. On Next.js this is usually inline RSC flight payload or serialised props rather than genuine markup bloat.',
    fix: 'Reduce payload rather than padding text. Check the Next.js pack for RSC payload weight, and trim data passed across the server/client boundary.',
    test: (p) => p.textToCodeRatio < L.textToCodeRatioMin
      ? (p.textToCodeRatio * 100).toFixed(1) + '%' : false,
  }),
  pageCheck({
    id: 'page-code-under-500', title: 'Page code has less than 500 symbols',
    category: 'content-relevance', severity: 'critical',
    why: 'A response this small is almost never a real page — usually an error stub, an empty shell or a failed render.',
    fix: 'Verify the page renders content server-side.',
    test: (p) => p.bytes < L.minCodeBytes ? p.bytes + ' bytes' : false,
  }),
  pageCheck({
    id: 'paragraphs-are-missing', title: 'Paragraphs are missing',
    category: 'content-relevance', severity: 'notice',
    why: 'Content with no paragraph elements is usually laid out entirely with divs, which removes the semantic structure search engines and screen readers rely on.',
    fix: 'Wrap prose in <p> elements.',
    test: (p) => p.wordCount > 100 && p.paragraphCount === 0,
  }),
  pageCheck({
    id: 'no-list-markdown', title: 'Page has no list markdown',
    category: 'content-relevance', severity: 'notice',
    why: 'Lists are strongly favoured for featured snippets and make long content far easier to scan.',
    fix: 'Use <ul>/<ol> for enumerable content rather than line breaks.',
    test: (p) => p.wordCount > L.lowWordCount && p.listCount === 0,
  }),
  pageCheck({
    id: 'no-strong-importance-elements', title: 'Page has no strong importance elements',
    category: 'content-relevance', severity: 'notice',
    why: 'No emphasis anywhere in substantial content means nothing is marked as important, which weakens both scanning and semantic signals.',
    fix: 'Use <strong> for genuinely important terms. Do not bold everything.',
    test: (p) => p.wordCount > L.lowWordCount && p.strongCount === 0,
  }),
  pageCheck({
    id: 'lorem-ipsum', title: 'Lorem Ipsum content on the live site',
    category: 'content-relevance', severity: 'critical',
    why: 'Placeholder text on a live page means unfinished content shipped to production and is visible to users and search engines alike.',
    fix: 'Replace the placeholder copy.',
    test: (p) => p.hasLoremIpsum,
  }),
  pageCheck({
    id: 'author-box-admin', title: 'Author box with "Admin"',
    category: 'content-relevance', severity: 'warning',
    why: 'A default "Admin" byline undermines the author signals that support E-E-A-T assessment.',
    fix: 'Set a real author name and profile.',
    // "Admin" as a byline is a CMS default. Elsewhere the phrase "by admin"
    // is ordinary prose — documentation and support pages say it constantly.
    onlyOn: ['cms'],
    test: (p) => p.hasAdminAuthor,
  }),
  pageCheck({
    id: 'page-not-updated-1-year', title: 'Page has not been updated more than 1 year',
    category: 'content-relevance', severity: 'notice',
    why: 'Content untouched for over a year is more likely to be outdated, and freshness is a ranking factor in many query classes.',
    fix: 'Review and update, then ensure Last-Modified reflects the change.',
    test: (p) => {
      if (!p.lastModified) return false;
      const t = Date.parse(p.lastModified);
      if (Number.isNaN(t)) return false;
      const days = (Date.now() - t) / 86_400_000;
      return days > L.staleAfterDays ? Math.round(days) + ' days old' : false;
    },
  }),
  pageCheck({
    id: 'html-lang-missing', title: 'HTML lang attribute missing',
    category: 'content-relevance', severity: 'warning',
    why: 'Without lang, search engines and screen readers must guess the language, which affects both regional targeting and pronunciation.',
    fix: 'Set <html lang="en"> or the appropriate BCP-47 code.',
    test: (p) => !p.htmlLang,
  }),
];

const imageChecks: PageCheck[] = [
  pageCheck({
    id: 'missing-alt-text', title: 'Missing alt text',
    category: 'content-relevance', severity: 'warning',
    why: 'Images without alt text are invisible to screen readers and give search engines no way to understand them. It is also a baseline accessibility requirement.',
    fix: 'Add descriptive alt text. Use alt="" only for genuinely decorative images.',
    test: (p) => {
      const bad = p.images.filter((i) => !i.hasAltAttr && i.src && !i.src.startsWith('data:'));
      return bad.length ? bad.length + ' image(s) without alt' : false;
    },
  }),
  pageCheck({
    id: 'alt-text-one-word', title: 'Page has alt tags with one word',
    category: 'content-relevance', severity: 'notice',
    why: 'Single-word alt text is rarely a useful description and often just repeats the filename.',
    fix: 'Describe what the image shows in a short phrase.',
    test: (p) => {
      const bad = p.images.filter((i) => {
        const a = (i.alt ?? '').trim();
        return a.length > 0 && !a.includes(' ');
      });
      return bad.length ? bad.length + ' single-word alt(s)' : false;
    },
  }),
  pageCheck({
    id: 'alt-text-too-long', title: 'Alt text too long',
    category: 'content-relevance', severity: 'notice',
    why: `Alt text beyond ~${L.altMax} characters is truncated by some screen readers and usually indicates prose that belongs in the page body.`,
    fix: 'Keep alt concise; use a caption for longer explanation.',
    test: (p) => {
      const bad = p.images.filter((i) => (i.alt ?? '').length > L.altMax);
      return bad.length ? bad.length + ' overlong alt(s)' : false;
    },
  }),
  pageCheck({
    id: 'images-present', title: 'Images',
    category: 'content-relevance', severity: 'notice',
    why: 'Substantial content with no images is harder to engage with and forfeits image search traffic.',
    fix: 'Add relevant imagery with descriptive alt text.',
    test: (p) => p.wordCount > L.lowWordCount && p.images.length === 0,
  }),
  pageCheck({
    id: 'https-page-links-http-image', title: 'HTTPS page links to HTTP image',
    category: 'content-relevance', severity: 'critical',
    why: 'Insecure images on a secure page are blocked as mixed content by modern browsers, so they simply do not appear.',
    fix: 'Serve all images over HTTPS.',
    test: (p) => {
      if (!p.finalUrl.startsWith('https://')) return false;
      const bad = p.images.filter((i) => i.src.startsWith('http://'));
      return bad.length ? bad.length + ' insecure image(s)' : false;
    },
  }),
];

const fileTypeChecks: PageCheck[] = [
  pageCheck({
    id: 'non-html-urls', title: 'Non-HTML URLs',
    category: 'content-relevance', severity: 'notice',
    why: 'Non-HTML resources in the crawl are indexable but cannot carry standard on-page signals such as titles and headings.',
    fix: 'Confirm these should be indexed. Provide an HTML landing page for important documents.',
    appliesTo: (p) => p.status === 200,
    test: (p) => !p.isHtml ? p.contentType : false,
  }),
  pageCheck({
    id: 'pdf-files', title: 'PDF files',
    category: 'content-relevance', severity: 'notice',
    why: 'PDFs rank but convert poorly, are hard to read on mobile, and cannot be updated without replacing the file.',
    fix: 'Publish an HTML version and link the PDF as a download.',
    appliesTo: (p) => p.status === 200,
    test: (p) => p.contentType.includes('pdf') || /\.pdf($|\?)/i.test(p.finalUrl),
  }),
];

const siteChecks: SiteCheck[] = [
  siteCheck({
    id: 'site-has-favicon', title: 'Site has a favicon',
    category: 'content-relevance', severity: 'notice',
    why: 'Google shows the favicon beside mobile search results. A missing one leaves a generic placeholder and weakens brand recognition.',
    fix: 'Add a favicon. In Next.js App Router put icon.png or favicon.ico in app/.',
    test: (site) => !site.faviconFound,
  }),
  siteCheck({
    id: 'homepage-title-home', title: 'Homepage with the title tag of "Home"',
    category: 'content-relevance', severity: 'critical',
    why: 'A homepage titled "Home" wastes the most valuable title on the site, describing navigation rather than the business.',
    fix: 'Use the brand name plus a short value proposition.',
    test: (site) => {
      const home = site.byUrl.get(site.homepageUrl);
      const t = home?.title?.trim().toLowerCase();
      return t === 'home' || t === 'homepage' ? 'title is "' + home?.title + '"' : false;
    },
  }),
];

export const CONTENT_CHECKS = [
  ...titleChecks, ...descriptionChecks, ...headingChecks, ...bodyChecks,
  ...imageChecks, ...fileTypeChecks, ...siteChecks,
];
