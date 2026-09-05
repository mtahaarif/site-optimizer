/**
 * Localization (23) + Search Traffic (11).
 *
 * Hreflang is the hardest category to get right because almost every check is
 * relational: it depends on what the *other* page in the cluster declares.
 */
import { pageCheck, type PageCheck } from './types.ts';
import { normalizeUrl, type PageData } from '../extract.ts';
import type { SiteData } from './types.ts';

/** BCP-47: language[-script][-region], or the reserved x-default. */
const VALID_LANG = /^([a-z]{2,3})(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/;
const isValidLang = (l: string) => l === 'x-default' || VALID_LANG.test(l);

const hasHreflang = (p: PageData) => p.hreflang.length > 0;
const siteUsesHreflang = (site: SiteData) => site.pages.some((p) => p.hreflang.length > 0);

/** Pages that declare an hreflang pointing at this URL. */
const incomingHreflang = (p: PageData, site: SiteData): PageData[] => {
  const key = normalizeUrl(p.finalUrl);
  return site.pages.filter((o) =>
    normalizeUrl(o.finalUrl) !== key && o.hreflang.some((h) => normalizeUrl(h.href) === key));
};

const localizationChecks: PageCheck[] = [
  pageCheck({
    id: 'html-lang-invalid', title: 'HTML lang attribute invalid',
    category: 'localization', severity: 'warning',
    why: 'An invalid language code is ignored, so the page has no declared language for search engines or screen readers.',
    fix: 'Use a valid BCP-47 code such as en, en-GB or zh-Hans-CN.',
    test: (p) => p.htmlLang && !isValidLang(p.htmlLang) ? 'lang="' + p.htmlLang + '"' : false,
  }),
  pageCheck({
    id: 'hreflang-annotation-invalid', title: 'Hreflang annotation invalid',
    category: 'localization', severity: 'critical',
    why: 'Invalid hreflang values are discarded entirely, so the alternate relationship is never established.',
    fix: 'Use valid BCP-47 codes. The most common error is a country code used as a language, such as "uk" for Ukraine instead of "en-GB".',
    appliesTo: hasHreflang,
    test: (p) => {
      const bad = p.hreflang.filter((h) => !isValidLang(h.lang));
      return bad.length ? 'invalid: ' + bad.map((b) => b.lang).join(', ') : false;
    },
  }),
  pageCheck({
    id: 'hreflang-relative-urls', title: 'Has outgoing hreflang annotations using relative URLs',
    category: 'localization', severity: 'critical',
    why: 'Hreflang requires fully qualified absolute URLs. Relative values are ignored.',
    fix: 'Use absolute URLs including protocol and host.',
    appliesTo: hasHreflang,
    test: (p) => {
      const bad = p.hreflang.filter((h) => !/^https?:\/\//i.test(h.rawHref));
      return bad.length ? bad.length + ' relative hreflang URL(s)' : false;
    },
  }),
  pageCheck({
    id: 'self-reference-hreflang-missing', title: 'Self-reference hreflang annotation missing',
    category: 'localization', severity: 'critical',
    why: 'Every page in an hreflang cluster must reference itself. Without it Google may ignore the entire cluster.',
    fix: 'Include a self-referencing hreflang alongside the alternates.',
    appliesTo: hasHreflang,
    test: (p) => {
      const self = normalizeUrl(p.finalUrl);
      return !p.hreflang.some((h) => normalizeUrl(h.href) === self);
    },
  }),
  pageCheck({
    id: 'missing-reciprocal-hreflang', title: 'Missing reciprocal hreflang (no return-tag)',
    category: 'localization', severity: 'critical',
    why: 'Hreflang must be bidirectional. If A points to B but B does not point back, Google discards the relationship entirely.',
    fix: 'Ensure every page in the cluster lists every other page, including itself.',
    appliesTo: hasHreflang,
    test: (p, site) => {
      const self = normalizeUrl(p.finalUrl);
      const missing = p.hreflang.filter((h) => {
        const target = site.byUrl.get(normalizeUrl(h.href));
        if (!target || normalizeUrl(h.href) === self) return false;
        return !target.hreflang.some((th) => normalizeUrl(th.href) === self);
      });
      return missing.length ? missing.length + ' target(s) do not link back' : false;
    },
  }),
  pageCheck({
    id: 'hreflang-to-broken-url', title: 'Has outgoing hreflang annotations to broken URLs',
    category: 'localization', severity: 'critical',
    why: 'An hreflang pointing at a 4xx or 5xx invalidates that alternate and can undermine the whole cluster.',
    fix: 'Point hreflang at live URLs.',
    appliesTo: hasHreflang,
    test: (p, site) => {
      const bad = p.hreflang.filter((h) => {
        const s = site.byUrl.get(normalizeUrl(h.href))?.status;
        return s !== undefined && s >= 400;
      });
      return bad.length ? bad.length + ' broken hreflang target(s)' : false;
    },
  }),
  pageCheck({
    id: 'hreflang-to-redirect', title: 'Has outgoing hreflang annotations to redirecting URLs',
    category: 'localization', severity: 'warning',
    why: 'Hreflang should reference final URLs. A redirect weakens the signal and may break reciprocity, since the destination will not list the original URL.',
    fix: 'Reference the destination URL directly.',
    appliesTo: hasHreflang,
    test: (p, site) => {
      const bad = p.hreflang.filter((h) => {
        const s = site.byUrl.get(normalizeUrl(h.href))?.status;
        return s !== undefined && s >= 300 && s < 400;
      });
      return bad.length ? bad.length + ' redirecting hreflang target(s)' : false;
    },
  }),
  pageCheck({
    id: 'hreflang-to-noindex', title: 'Has outgoing hreflang annotations to noindex URLs',
    category: 'localization', severity: 'critical',
    why: 'Pointing at a page excluded from the index contradicts the purpose of declaring it as an indexable alternate.',
    fix: 'Remove noindex from the alternate, or drop it from the cluster.',
    appliesTo: hasHreflang,
    test: (p, site) => p.hreflang.some((h) => {
      const t = site.byUrl.get(normalizeUrl(h.href));
      return !!t && t.metaRobots.some((r) => r.includes('noindex'));
    }),
  }),
  pageCheck({
    id: 'hreflang-to-disallowed', title: 'Has outgoing hreflang annotations to disallowed URLs',
    category: 'localization', severity: 'critical',
    why: 'Google cannot verify an alternate it is not allowed to crawl, so the relationship is dropped.',
    fix: 'Allow the alternate in robots.txt.',
    appliesTo: hasHreflang,
    test: (p, site) => p.hreflang.some((h) => site.robots.isDisallowed(h.href)),
  }),
  pageCheck({
    id: 'hreflang-non-canonical', title: 'Hreflang to non-canonical',
    category: 'localization', severity: 'critical',
    why: 'Hreflang must point at canonical URLs. Referencing a page that canonicalises elsewhere produces conflicting instructions.',
    fix: 'Point hreflang at the canonical version of each alternate.',
    appliesTo: hasHreflang,
    test: (p, site) => p.hreflang.some((h) => {
      const t = site.byUrl.get(normalizeUrl(h.href));
      return !!t && !!t.canonical && normalizeUrl(t.canonical) !== normalizeUrl(t.finalUrl);
    }),
  }),
  pageCheck({
    id: 'hreflang-html-lang-mismatch', title: 'Mismatched hreflang and HTML lang declarations',
    category: 'localization', severity: 'warning',
    why: 'When the self-referencing hreflang and the html lang attribute disagree, the page sends two different answers about its own language.',
    fix: 'Make the html lang attribute match the self-referencing hreflang.',
    appliesTo: (p) => hasHreflang(p) && !!p.htmlLang,
    test: (p) => {
      const self = p.hreflang.find((h) => normalizeUrl(h.href) === normalizeUrl(p.finalUrl));
      if (!self || self.lang === 'x-default') return false;
      const a = self.lang.toLowerCase().split('-')[0];
      const b = (p.htmlLang ?? '').toLowerCase().split('-')[0];
      return a !== b ? 'hreflang=' + self.lang + ' vs lang=' + p.htmlLang : false;
    },
  }),
  pageCheck({
    id: 'hreflang-defined-html-lang-missing', title: 'Hreflang defined but HTML lang missing',
    category: 'localization', severity: 'warning',
    why: 'A multilingual page without a lang attribute leaves screen readers and translation tools guessing.',
    fix: 'Add the lang attribute to the html element.',
    appliesTo: hasHreflang,
    test: (p) => !p.htmlLang,
  }),
  pageCheck({
    id: 'x-default-missing', title: 'X-default hreflang annotation missing',
    category: 'localization', severity: 'notice',
    why: 'x-default tells Google which page to serve to users whose language matches none of the alternates.',
    fix: 'Add an x-default hreflang pointing at your language selector or primary market page.',
    appliesTo: hasHreflang,
    test: (p) => !p.hreflang.some((h) => h.lang === 'x-default'),
  }),
  pageCheck({
    id: 'hreflang-also-x-default', title: 'Hreflang annotation also x-default',
    category: 'localization', severity: 'notice',
    why: 'A URL declared both as a specific language alternate and as x-default is valid but frequently unintentional.',
    fix: 'Confirm this is deliberate.',
    appliesTo: hasHreflang,
    test: (p) => {
      const xd = p.hreflang.find((h) => h.lang === 'x-default');
      if (!xd) return false;
      return p.hreflang.some((h) => h.lang !== 'x-default' && normalizeUrl(h.href) === normalizeUrl(xd.href));
    },
  }),
  pageCheck({
    id: 'multiple-pages-same-language', title: 'More than one page for same language in hreflang',
    category: 'localization', severity: 'critical',
    why: 'Two different URLs claiming the same language code is ambiguous, and Google resolves it by ignoring the cluster.',
    fix: 'Declare exactly one URL per language-region code.',
    appliesTo: hasHreflang,
    test: (p) => {
      const seen = new Map<string, Set<string>>();
      for (const h of p.hreflang) {
        const set = seen.get(h.lang) ?? new Set();
        set.add(normalizeUrl(h.href));
        seen.set(h.lang, set);
      }
      const dupe = [...seen.entries()].find(([, urls]) => urls.size > 1);
      return dupe ? 'lang "' + dupe[0] + '" maps to ' + dupe[1].size + ' URLs' : false;
    },
  }),
  pageCheck({
    id: 'page-referenced-multiple-languages', title: 'Page referenced for more than one language in hreflang',
    category: 'localization', severity: 'critical',
    why: 'One URL claiming multiple language codes tells Google the same page is authoritative for several languages, which it cannot be.',
    fix: 'Assign one language code per URL.',
    appliesTo: hasHreflang,
    test: (p) => {
      const byUrl = new Map<string, Set<string>>();
      for (const h of p.hreflang) {
        if (h.lang === 'x-default') continue;
        const set = byUrl.get(normalizeUrl(h.href)) ?? new Set();
        set.add(h.lang);
        byUrl.set(normalizeUrl(h.href), set);
      }
      const dupe = [...byUrl.entries()].find(([, langs]) => langs.size > 1);
      return dupe ? [...dupe[1]].join(', ') + ' all point at one URL' : false;
    },
  }),
  pageCheck({
    id: 'invalid-incoming-hreflang', title: 'Invalid incoming hreflang annotations',
    category: 'localization', severity: 'warning',
    why: 'Another page references this URL with a malformed language code, so the incoming relationship is discarded.',
    fix: 'Correct the language code on the referencing page.',
    test: (p, site) => {
      const bad = incomingHreflang(p, site).filter((o) =>
        o.hreflang.some((h) => normalizeUrl(h.href) === normalizeUrl(p.finalUrl) && !isValidLang(h.lang)));
      return bad.length ? bad.length + ' page(s) reference this URL with an invalid code' : false;
    },
  }),
  pageCheck({
    id: 'conflicting-incoming-hreflang', title: 'Has conflicting incoming hreflang annotations',
    category: 'localization', severity: 'critical',
    why: 'Different pages declare this URL as different languages. The conflict makes the cluster unusable.',
    fix: 'Align the language code used for this URL across every page that references it.',
    test: (p, site) => {
      const langs = new Set<string>();
      for (const o of incomingHreflang(p, site)) {
        for (const h of o.hreflang) {
          if (normalizeUrl(h.href) === normalizeUrl(p.finalUrl) && h.lang !== 'x-default') langs.add(h.lang);
        }
      }
      return langs.size > 1 ? 'referenced as: ' + [...langs].join(', ') : false;
    },
  }),
  pageCheck({
    id: 'noindex-has-incoming-hreflang', title: 'Noindex URL has incoming hreflang',
    category: 'localization', severity: 'critical',
    why: 'Other pages declare this URL as an indexable alternate while it is explicitly excluded from the index.',
    fix: 'Remove noindex, or remove the page from the hreflang cluster.',
    test: (p, site) => p.metaRobots.some((r) => r.includes('noindex'))
      && incomingHreflang(p, site).length > 0,
  }),
  pageCheck({
    id: 'canonicalized-has-incoming-hreflang', title: 'Canonicalized URL has incoming hreflang',
    category: 'localization', severity: 'critical',
    why: 'This URL canonicalises elsewhere but is referenced as an hreflang alternate, which contradicts the canonical.',
    fix: 'Reference the canonical URL in the hreflang cluster instead.',
    test: (p, site) => !!p.canonical
      && normalizeUrl(p.canonical) !== normalizeUrl(p.finalUrl)
      && incomingHreflang(p, site).length > 0,
  }),
  pageCheck({
    id: 'disallowed-has-incoming-hreflang', title: 'Disallowed URL has incoming hreflang',
    category: 'localization', severity: 'critical',
    why: 'The URL is referenced as an alternate but blocked in robots.txt, so Google can never verify the relationship.',
    fix: 'Allow the URL in robots.txt.',
    test: (p, site) => p.disallowedByRobots && incomingHreflang(p, site).length > 0,
  }),
  pageCheck({
    id: 'missing-hreflang-annotations', title: 'Missing hreflang annotations',
    category: 'localization', severity: 'notice',
    why: 'This page has no hreflang while other pages on the site do, so it is excluded from language targeting.',
    fix: 'Add hreflang annotations, or confirm the page is intentionally single-language.',
    appliesTo: (p, site) => siteUsesHreflang(site),
    test: (p) => p.hreflang.length === 0,
  }),
  pageCheck({
    id: 'hreflang-group-not-crawled', title: 'Not all pages from hreflang group were crawled',
    category: 'localization', severity: 'notice',
    why: 'Some alternates were not reached in this crawl, so reciprocity could not be verified for them.',
    fix: 'Increase the crawl limit, or confirm the alternates are reachable.',
    appliesTo: hasHreflang,
    test: (p, site) => {
      const missing = p.hreflang.filter((h) => !site.byUrl.has(normalizeUrl(h.href)));
      return missing.length ? missing.length + ' alternate(s) not crawled' : false;
    },
  }),
];

export const LOCALIZATION_CHECKS = localizationChecks;
