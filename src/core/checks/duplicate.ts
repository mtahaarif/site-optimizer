/**
 * Duplicate Content — 15 checks.
 * Pages competing with each other in the index.
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck } from './types.ts';
import { normalizeUrl } from '../extract.ts';

const dupeDetail = (group: string[] | undefined, self: string): string | false => {
  if (!group || group.length < 2) return false;
  const others = group.filter((u) => u !== self);
  return 'shared with ' + others.length + ' other page(s)';
};

const pageChecks: PageCheck[] = [
  pageCheck({
    id: 'title-duplicates', title: 'Title duplicates',
    category: 'duplicate-content', severity: 'critical',
    why: 'Identical titles across pages make them look interchangeable to Google, which suppresses all but one and splits ranking signals between them.',
    fix: 'Write a unique title per page. For paginated or filtered listings, include the distinguishing value in the title.',
    test: (p, site) => dupeDetail(
      site.duplicateTitles.get((p.title ?? '').trim().toLowerCase()), normalizeUrl(p.finalUrl)),
  }),
  pageCheck({
    id: 'h1-duplicates', title: 'H1 duplicates',
    category: 'duplicate-content', severity: 'warning',
    why: 'Duplicate H1s across pages weaken topical differentiation and often indicate near-duplicate content.',
    fix: 'Make each H1 specific to its page.',
    test: (p, site) => {
      const h1 = (p.h1s[0] ?? '').trim().toLowerCase();
      return h1 ? dupeDetail(site.duplicateH1s.get(h1), normalizeUrl(p.finalUrl)) : false;
    },
  }),
  pageCheck({
    id: 'description-duplicates', title: 'Description duplicates',
    category: 'duplicate-content', severity: 'warning',
    why: 'Duplicate descriptions produce identical snippets, so search results give the user no way to distinguish the pages.',
    fix: 'Write a unique description per page, or omit it and let Google generate one from content.',
    test: (p, site) => {
      const d = (p.description ?? '').trim().toLowerCase();
      return d ? dupeDetail(site.duplicateDescriptions.get(d), normalizeUrl(p.finalUrl)) : false;
    },
  }),
  pageCheck({
    id: 'duplicate-pages-without-canonical', title: 'Duplicate pages without canonical',
    category: 'content-relevance', severity: 'critical',
    why: 'Two pages with substantially identical body content and no canonical linking them. Google picks one arbitrarily and the other is suppressed.',
    fix: 'Add a canonical from the duplicate to the preferred URL, or consolidate the pages.',
    test: (p, site) => {
      const key = normalizeUrl(p.finalUrl);
      const group = site.duplicateContent.get(contentKey(p.bodyText));
      if (!group || group.length < 2) return false;
      if (p.canonical && normalizeUrl(p.canonical) !== key) return false;
      return 'content identical to ' + (group.length - 1) + ' other page(s)';
    },
  }),
  pageCheck({
    id: 'technically-duplicate-urls', title: 'Technically duplicate URLs',
    category: 'duplicate-content', severity: 'critical',
    why: 'The same content is reachable at URLs differing only by case, trailing slash or parameter order. Each variant is a separate crawlable URL competing with the others.',
    fix: 'Pick one form, 301 the rest to it, and normalise link generation so only the canonical form is emitted.',
    test: (p, site) => {
      const key = normalizeUrl(p.finalUrl).toLowerCase().replace(/\/$/, '');
      const matches = site.pages.filter((o) =>
        normalizeUrl(o.finalUrl).toLowerCase().replace(/\/$/, '') === key
        && normalizeUrl(o.finalUrl) !== normalizeUrl(p.finalUrl));
      return matches.length ? matches.length + ' URL variant(s) serve this content' : false;
    },
  }),
  pageCheck({
    id: 'page-identical-headings', title: 'Page has identical headings',
    category: 'duplicate-content', severity: 'notice',
    why: 'Repeated heading text within one page flattens the outline and offers no additional structure to a crawler.',
    fix: 'Make each heading distinct, or use a different element if the repetition is a visual pattern.',
    test: (p) => {
      const seen = new Map<string, number>();
      for (const h of p.headings) {
        if (!h.text) continue;
        const k = h.text.toLowerCase();
        seen.set(k, (seen.get(k) ?? 0) + 1);
      }
      const dupes = [...seen.entries()].filter(([, n]) => n > 1);
      return dupes.length ? dupes.length + ' repeated heading(s)' : false;
    },
  }),
  pageCheck({
    id: 'page-identical-alt-tags', title: 'Page has identical alt tags',
    category: 'duplicate-content', severity: 'notice',
    why: 'Multiple images sharing one alt text means at most one is being described accurately.',
    fix: 'Write alt text specific to each image.',
    test: (p) => {
      const seen = new Map<string, number>();
      for (const i of p.images) {
        const a = (i.alt ?? '').trim().toLowerCase();
        if (!a) continue;
        seen.set(a, (seen.get(a) ?? 0) + 1);
      }
      const dupes = [...seen.entries()].filter(([, n]) => n > 1);
      return dupes.length ? dupes.length + ' repeated alt text(s)' : false;
    },
  }),
  pageCheck({
    id: 'h1-equals-title', title: 'H1 = Title',
    category: 'duplicate-content', severity: 'notice',
    why: 'An H1 identical to the title forgoes a second opportunity to cover related phrasing. Not harmful, but a missed opportunity.',
    fix: 'Vary them: the title targets the search result, the H1 addresses the reader on the page.',
    test: (p) => !!p.title && !!p.h1s[0]
      && p.title.trim().toLowerCase() === p.h1s[0].trim().toLowerCase(),
  }),
  pageCheck({
    id: 'h1-equals-description', title: 'H1 = Description',
    category: 'duplicate-content', severity: 'notice',
    why: 'Reusing the H1 as the meta description wastes the snippet, which should sell the click rather than repeat the headline.',
    fix: 'Write a description that adds information beyond the heading.',
    test: (p) => !!p.description && !!p.h1s[0]
      && p.description.trim().toLowerCase() === p.h1s[0].trim().toLowerCase(),
  }),
  pageCheck({
    id: 'h1-equals-alt', title: 'H1 = Alt',
    category: 'duplicate-content', severity: 'notice',
    why: 'Alt text copied from the H1 describes the page rather than the image, so the image itself remains undescribed.',
    fix: 'Write alt text describing the image contents.',
    test: (p) => {
      const h1 = (p.h1s[0] ?? '').trim().toLowerCase();
      if (!h1) return false;
      const n = p.images.filter((i) => (i.alt ?? '').trim().toLowerCase() === h1).length;
      return n ? n + ' image(s) reuse the H1 as alt' : false;
    },
  }),
  pageCheck({
    id: 'title-equals-alt', title: 'Title = Alt',
    category: 'duplicate-content', severity: 'notice',
    why: 'Alt text copied from the page title does not describe the image.',
    fix: 'Write alt text describing the image contents.',
    test: (p) => {
      const t = (p.title ?? '').trim().toLowerCase();
      if (!t) return false;
      const n = p.images.filter((i) => (i.alt ?? '').trim().toLowerCase() === t).length;
      return n ? n + ' image(s) reuse the title as alt' : false;
    },
  }),
];

const siteChecks: SiteCheck[] = [
  siteCheck({
    id: 'http-to-https-redirect-works', title: 'Working protocol redirect: HTTP to HTTPS',
    category: 'duplicate-content', severity: 'critical',
    why: 'Without an HTTP to HTTPS redirect the site is reachable on both protocols, creating a complete duplicate of every page.',
    fix: 'Add a site-wide 301 from http:// to https://.',
    test: (site) => !site.httpsRedirectWorks,
  }),
  siteCheck({
    id: 'preferred-domain-redirect', title: 'Site URLs redirect to preferred version of domain name',
    category: 'duplicate-content', severity: 'critical',
    why: 'If both www and non-www resolve without redirecting, every page exists twice and ranking signals are split between the two hostnames.',
    fix: 'Choose one hostname and 301 the other to it.',
    test: (site) => !site.hostRedirectConsistent,
  }),
];

/** Coarse content fingerprint: normalised first 2000 chars of body text. */
export function contentKey(bodyText: string): string {
  return bodyText.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 2000);
}

export const DUPLICATE_CHECKS = [...pageChecks, ...siteChecks];
