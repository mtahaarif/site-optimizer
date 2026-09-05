/**
 * How well does one page already serve one location?
 *
 * Entirely deterministic and free — no model call. That matters because it is
 * what makes the matrix on the content page usable at all: a site with 40 pages
 * and 6 locations is 240 cells, and nobody is going to spend 240 API calls to
 * find out which handful need attention. Coverage narrows it to the cells worth
 * paying for; the model is then pointed only at those.
 *
 * What it measures is presence, not quality. A page can name Austin in every
 * heading and still be nothing but the Dallas page with the city swapped —
 * which is exactly the doorway-page pattern Google penalises. Judging *that*
 * needs the model, and the analyser says so rather than implying a high score
 * means the page is good.
 */
import type { LocationSignals } from './store.ts';

export interface PageContent {
  url: string;
  title: string | null;
  description: string | null;
  h1: string | null;
  headings: string[];
  bodyText: string;
  /** raw HTML, used only to look for LocalBusiness / PostalAddress markup */
  html?: string;
}

export interface LocationTerms {
  label: string;
  city: string | null;
  region: string | null;
}

/**
 * Weights, and why these.
 *
 * Title and H1 dominate because they are what a search engine leans on hardest
 * for "is this page about this place", and what a person scanning a result
 * sees. Body mentions saturate deliberately at three — the tenth repetition of
 * a city name is keyword stuffing, not relevance, and a scale that kept
 * rewarding it would be advice to make the page worse.
 */
const WEIGHTS = {
  title: 22,
  h1: 20,
  description: 12,
  headings: 12,
  url: 10,
  body: 12,        // full marks at 3+ natural mentions
  localSchema: 8,
  address: 4,
};

const ADDRESS_RE = /\b\d{1,6}\s+[A-Z][A-Za-z.'-]+\s+(?:st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|way|suite|ste|unit)\b/i;
const POSTCODE_RE = /\b(?:\d{5}(?:-\d{4})?|[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/;

/** Every way a location might legitimately be written on a page. */
function termsFor(loc: LocationTerms): string[] {
  const out = new Set<string>();
  for (const t of [loc.city, loc.region, loc.label]) {
    if (t && t.trim().length > 1) out.add(t.trim().toLowerCase());
  }
  // "Austin, Texas" should also match a page that only says "Austin".
  const first = loc.label.split(',')[0]?.trim().toLowerCase();
  if (first && first.length > 1) out.add(first);
  return [...out];
}

const containsTerm = (haystack: string, terms: string[]): boolean => {
  const l = haystack.toLowerCase();
  return terms.some((t) => l.includes(t));
};

function countTerm(haystack: string, terms: string[]): number {
  const l = haystack.toLowerCase();
  let n = 0;
  for (const t of terms) {
    let i = l.indexOf(t);
    while (i !== -1) { n++; i = l.indexOf(t, i + t.length); }
  }
  return n;
}

export function analyseCoverage(page: PageContent, loc: LocationTerms): {
  coverage: number; signals: LocationSignals;
} {
  const terms = termsFor(loc);
  if (terms.length === 0) {
    return { coverage: 0, signals: { ...EMPTY } };
  }

  const html = page.html ?? '';
  const signals: LocationSignals = {
    inTitle: containsTerm(page.title ?? '', terms),
    inDescription: containsTerm(page.description ?? '', terms),
    inH1: containsTerm(page.h1 ?? '', terms),
    inHeadings: page.headings.some((h) => containsTerm(h, terms)),
    inBody: countTerm(page.bodyText, terms),
    inUrl: containsTerm(safePath(page.url), terms.map((t) => t.replace(/\s+/g, '-'))),
    hasLocalSchema: /"@type"\s*:\s*"(?:LocalBusiness|PostalAddress|[A-Za-z]*(?:Store|Restaurant|Service))"/i.test(html)
      || /itemtype=["'][^"']*(?:LocalBusiness|PostalAddress)/i.test(html),
    hasAddress: ADDRESS_RE.test(page.bodyText) || POSTCODE_RE.test(page.bodyText),
  };

  let score = 0;
  if (signals.inTitle) score += WEIGHTS.title;
  if (signals.inH1) score += WEIGHTS.h1;
  if (signals.inDescription) score += WEIGHTS.description;
  if (signals.inHeadings) score += WEIGHTS.headings;
  if (signals.inUrl) score += WEIGHTS.url;
  score += Math.min(1, signals.inBody / 3) * WEIGHTS.body;
  if (signals.hasLocalSchema) score += WEIGHTS.localSchema;
  if (signals.hasAddress) score += WEIGHTS.address;

  return { coverage: Math.round(Math.min(100, score)), signals };
}

const EMPTY: LocationSignals = {
  inTitle: false, inDescription: false, inH1: false, inHeadings: false,
  inBody: 0, inUrl: false, hasLocalSchema: false, hasAddress: false,
};

function safePath(url: string): string {
  try { return new URL(url).pathname; } catch { return url; }
}

/** The gaps, worst first — this is what the prompt and the model are given. */
export function gapsFrom(signals: LocationSignals, label: string): string[] {
  const gaps: string[] = [];
  if (!signals.inTitle) gaps.push(`the <title> does not mention ${label}`);
  if (!signals.inH1) gaps.push(`the H1 does not mention ${label}`);
  if (!signals.inDescription) gaps.push(`the meta description does not mention ${label}`);
  if (!signals.inHeadings) gaps.push(`no subheading mentions ${label}`);
  if (signals.inBody === 0) gaps.push(`${label} is never named in the body text`);
  else if (signals.inBody < 2) gaps.push(`${label} is named only once in the body`);
  if (!signals.inUrl) gaps.push('the URL contains no location segment');
  if (!signals.hasLocalSchema) gaps.push('there is no LocalBusiness or PostalAddress structured data');
  if (!signals.hasAddress) gaps.push('no address or postcode appears on the page');
  return gaps;
}
