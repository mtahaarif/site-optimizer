/**
 * Target locations — the places a site wants to be found in.
 *
 * One list, shared by rank tracking and content optimisation. Rank tracking
 * asks "where do I sit in Austin"; the content optimiser asks "does this page
 * read as though it serves Austin". Those are two halves of the same question,
 * and keeping one list means adding a place once puts it in front of both
 * rather than having the same city typed into two features that then disagree
 * about its spelling.
 */
import { all, get, run } from '../../db/index.ts';
import { normalizeUrl } from '../extract.ts';

export interface Location {
  id: number;
  site_id: number;
  label: string;
  city: string | null;
  region: string | null;
  country: string | null;
  active: number;
  created_at: number;
}

/**
 * Split what someone typed into parts.
 *
 * Deliberately forgiving: "Austin", "Austin, TX", "Austin, Texas, United
 * States" are all things a person reasonably types, and rejecting two of them
 * to enforce a format would be the tool serving itself. The label is kept
 * verbatim — it is what gets shown, and what the SERP provider is given.
 */
export function parseLocation(input: string): {
  label: string; city: string | null; region: string | null; country: string | null;
} {
  const label = input.trim().replace(/\s+/g, ' ');
  const parts = label.split(',').map((p) => p.trim()).filter(Boolean);
  return {
    label,
    city: parts[0] ?? null,
    region: parts[1] ?? null,
    country: parts[2] ?? null,
  };
}

export async function addLocation(siteId: number, input: string): Promise<Location | null> {
  const parsed = parseLocation(input);
  if (!parsed.label) return null;

  await run(
    `INSERT INTO locations (site_id, label, city, region, country, active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(site_id, label) DO UPDATE SET active = 1`,
    siteId, parsed.label, parsed.city, parsed.region, parsed.country, Date.now(),
  );
  return (await get<Location>(
    'SELECT * FROM locations WHERE site_id = ? AND label = ?', siteId, parsed.label,
  )) ?? null;
}

export async function listLocations(siteId: number, onlyActive = true): Promise<Location[]> {
  return all<Location>(
    `SELECT * FROM locations WHERE site_id = ?${onlyActive ? ' AND active = 1' : ''}
     ORDER BY label`,
    siteId,
  );
}

/**
 * Every place saved for any site, de-duplicated.
 *
 * Rank tracking is not scoped to a site — you check a phrase against a domain
 * you type in — so it takes the whole list rather than one site's. The point is
 * only that a city typed on the content page turns up as a suggestion here
 * instead of being typed a second time, slightly differently.
 */
export async function allLocationLabels(): Promise<string[]> {
  const rows = await all<{ label: string }>(
    'SELECT DISTINCT label FROM locations WHERE active = 1 ORDER BY label',
  );
  return rows.map((r) => r.label);
}

export async function removeLocation(siteId: number, id: number): Promise<void> {
  await run('DELETE FROM locations WHERE site_id = ? AND id = ?', siteId, id);
}

// ---------------------------------------------------------------------------
// Per-page, per-location work
// ---------------------------------------------------------------------------

export interface LocationSignals {
  /** the place is named in these places */
  inTitle: boolean;
  inDescription: boolean;
  inH1: boolean;
  inHeadings: boolean;
  inBody: number;          // how many times
  inUrl: boolean;
  /** LocalBusiness / PostalAddress structured data present anywhere on the page */
  hasLocalSchema: boolean;
  /** something that looks like a street address or postcode */
  hasAddress: boolean;
}

export interface LocationContentRow {
  locationId: number;
  url: string;
  coverage: number;
  signals: LocationSignals;
  verdict: string | null;
  recommendations: Array<{ change: string; why: string }>;
  draft: ContentDraft | null;
  model: string | null;
  analysedAt: number | null;
  generatedAt: number | null;
}

/** What the generator produces for one page in one location. */
export interface ContentDraft {
  title: string;
  description: string;
  h1: string;
  intro: string;
  sections: Array<{ heading: string; body: string }>;
  faqs: Array<{ question: string; answer: string }>;
  /** the model's note on what it changed and why */
  rationale: string;
}

interface Row {
  location_id: number; url: string; coverage: number; signals: string;
  verdict: string | null; recommendations: string | null; draft: string | null;
  model: string | null; analysed_at: number | null; generated_at: number | null;
}

const parse = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

const toRow = (r: Row): LocationContentRow => ({
  locationId: r.location_id,
  url: r.url,
  coverage: r.coverage,
  signals: parse<LocationSignals>(r.signals, EMPTY_SIGNALS),
  verdict: r.verdict,
  recommendations: parse<Array<{ change: string; why: string }>>(r.recommendations, []),
  draft: parse<ContentDraft | null>(r.draft, null),
  model: r.model,
  analysedAt: r.analysed_at === null ? null : Number(r.analysed_at),
  generatedAt: r.generated_at === null ? null : Number(r.generated_at),
});

export const EMPTY_SIGNALS: LocationSignals = {
  inTitle: false, inDescription: false, inH1: false, inHeadings: false,
  inBody: 0, inUrl: false, hasLocalSchema: false, hasAddress: false,
};

/** Everything recorded for one site, for the matrix on the content page. */
export async function locationContentForSite(siteId: number): Promise<LocationContentRow[]> {
  const rows = await all<Row>(
    `SELECT location_id, url, coverage, signals, verdict, recommendations, draft,
            model, analysed_at, generated_at
     FROM location_content WHERE site_id = ?`,
    siteId,
  );
  return rows.map(toRow);
}

/** Save the free, deterministic half: where the place is named on the page. */
export async function saveCoverage(opts: {
  siteId: number; locationId: number; url: string; crawlId: string | null;
  coverage: number; signals: LocationSignals;
}): Promise<void> {
  await run(
    `INSERT INTO location_content
       (site_id, location_id, url, url_key, crawl_id, coverage, signals, analysed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(location_id, url_key) DO UPDATE SET
       coverage = excluded.coverage, signals = excluded.signals,
       crawl_id = excluded.crawl_id, analysed_at = excluded.analysed_at`,
    opts.siteId, opts.locationId, opts.url, normalizeUrl(opts.url), opts.crawlId,
    opts.coverage, JSON.stringify(opts.signals), Date.now(),
  );
}

/** Save the model's judgement and, when one was asked for, the draft. */
export async function saveGeneration(opts: {
  siteId: number; locationId: number; url: string;
  verdict: string; recommendations: Array<{ change: string; why: string }>;
  draft: ContentDraft | null; model: string;
}): Promise<void> {
  await run(
    `INSERT INTO location_content
       (site_id, location_id, url, url_key, verdict, recommendations, draft, model, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(location_id, url_key) DO UPDATE SET
       verdict = excluded.verdict, recommendations = excluded.recommendations,
       draft = COALESCE(excluded.draft, location_content.draft),
       model = excluded.model, generated_at = excluded.generated_at`,
    opts.siteId, opts.locationId, opts.url, normalizeUrl(opts.url),
    opts.verdict, JSON.stringify(opts.recommendations),
    opts.draft ? JSON.stringify(opts.draft) : null, opts.model, Date.now(),
  );
}
