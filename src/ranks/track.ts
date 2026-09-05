/**
 * Module 2 — rank tracking runner and quota ledger.
 *
 * Free SERP tiers are 50-100 searches per month. One misconfigured cron
 * schedule can burn a month's quota in an hour, so the budget is enforced here
 * in the database before any paid call is made — not left to the provider to
 * reject.
 */
import { all, get, run, listSites, upsertSite, type Site } from '../db/index.ts';
import { pickProvider, configuredProviders, type Engine, type Device } from './providers.ts';

export interface Keyword {
  id: number;
  site_id: number;
  phrase: string;
  engine: Engine;
  device: Device;
  country: string | null;
  city: string | null;
  language: string | null;
  active: number;
  created_at: number;
}

export interface RankSnapshot {
  id: number;
  keyword_id: number;
  checked_at: number;
  position: number | null;
  url: string | null;
  title: string | null;
  serp_features: string | null;
  results_checked: number | null;
  provider: string;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Quota
// ---------------------------------------------------------------------------

const period = (): string => new Date().toISOString().slice(0, 7); // YYYY-MM

/** Monthly ceiling per provider. Conservative defaults matching free tiers. */
export function monthlyLimit(provider: string): number {
  const override = Number(process.env['SERP_MONTHLY_LIMIT']);
  if (Number.isFinite(override) && override > 0) return override;
  const defaults: Record<string, number> = {
    serpapi: 100, valueserp: 100, dataforseo: 100,
  };
  return defaults[provider] ?? 100;
}

export interface Usage { provider: string; period: string; used: number; limit: number; remaining: number }

export async function usage(provider: string): Promise<Usage> {
  const p = period();
  const row = await get<{ used: number }>(
    'SELECT used FROM api_usage WHERE provider = ? AND period = ?', provider, p,
  );
  const used = row?.used ?? 0;
  const limit = monthlyLimit(provider);
  return { provider, period: p, used, limit, remaining: Math.max(0, limit - used) };
}

export async function allUsage(): Promise<Usage[]> {
  return Promise.all(configuredProviders().map((p) => usage(p.name)));
}

async function consume(provider: string): Promise<void> {
  const p = period();
  await run(
    `INSERT INTO api_usage (provider, period, used, limit_hint) VALUES (?, ?, 1, ?)
     ON CONFLICT(provider, period) DO UPDATE SET used = api_usage.used + 1`,
    provider, p, monthlyLimit(provider),
  );
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export interface AddKeywordInput {
  siteId: number;
  phrase: string;
  engine: Engine;
  device: Device;
  country?: string | null;
  city?: string | null;
  language?: string | null;
}

export async function addKeyword(input: AddKeywordInput): Promise<Keyword> {
  const { siteId, phrase, engine, device } = input;
  const country = input.country ?? null;
  const city = input.city ?? null;
  const language = input.language ?? null;

  await run(
    `INSERT INTO keywords (site_id, phrase, engine, device, country, city, language, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(site_id, phrase, engine, device, country, city)
     DO UPDATE SET active = 1, language = excluded.language`,
    siteId, phrase.trim(), engine, device, country, city, language, Date.now(),
  );

  return (await get<Keyword>(
    `SELECT * FROM keywords WHERE site_id = ? AND phrase = ? AND engine = ? AND device = ?
       AND country IS NOT DISTINCT FROM ? AND city IS NOT DISTINCT FROM ?`,
    siteId, phrase.trim(), engine, device, country, city,
  ))!;
}

export async function listKeywords(siteId?: number, onlyActive = true): Promise<Keyword[]> {
  const where = [onlyActive ? 'active = 1' : null, siteId ? 'site_id = ' + Number(siteId) : null]
    .filter(Boolean).join(' AND ');
  return all<Keyword>(
    `SELECT * FROM keywords ${where ? 'WHERE ' + where : ''} ORDER BY phrase, engine, device`,
  );
}

export async function removeKeyword(id: number): Promise<void> {
  await run('UPDATE keywords SET active = 0 WHERE id = ?', id);
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export interface TrackResult {
  keyword: Keyword;
  position: number | null;
  previousPosition: number | null;
  url: string | null;
  provider: string;
  error: string | null;
  /** true when the call was skipped because the monthly budget is exhausted */
  skipped: boolean;
}

/** Does this result URL belong to the tracked site? */
function matchesSite(resultUrl: string, origin: string): boolean {
  try {
    const a = new URL(resultUrl).hostname.replace(/^www\./, '').toLowerCase();
    const b = new URL(origin).hostname.replace(/^www\./, '').toLowerCase();
    return a === b || a.endsWith('.' + b);
  } catch {
    return false;
  }
}

export async function latestSnapshot(keywordId: number): Promise<RankSnapshot | undefined> {
  return get<RankSnapshot>(
    'SELECT * FROM rank_snapshots WHERE keyword_id = ? ORDER BY checked_at DESC LIMIT 1',
    keywordId,
  );
}

// ---------------------------------------------------------------------------
// On-demand check — a stateless "where do I rank right now" lookup.
//
// Unlike trackKeyword this needs no Site row and no keyword registration, and
// writes no snapshot. It still goes through the same provider layer and the
// same quota ledger, so an ad-hoc check can't bypass the budget.
// ---------------------------------------------------------------------------

export interface RankCheck {
  engine: Engine;
  provider: string;
  position: number | null;
  url: string | null;
  title: string | null;
  resultsChecked: number;
  features: string[];
  error: string | null;
  /** true when no provider/budget was available, so no call was made */
  skipped: boolean;
}

export interface CheckRankInput {
  keyword: string;
  /** any domain — "example.com" or "https://example.com/path" */
  domain: string;
  engines: Engine[];
  device: Device;
  country?: string | null;
  city?: string | null;
  language?: string | null;
  /** 'web' = organic results, 'local' = the Google map pack (Google only) */
  scope?: 'web' | 'local';
}

function normalizeDomain(input: string): string {
  const s = input.trim();
  try {
    return new URL(s.includes('://') ? s : 'https://' + s).origin;
  } catch {
    return 'https://' + s.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
}

export async function checkRank(input: CheckRankInput): Promise<RankCheck[]> {
  const origin = normalizeDomain(input.domain);
  const scope = input.scope ?? 'web';
  // The map pack is Google-only and only SerpApi implements it, so pin it there
  // regardless of the preferred web provider.
  const engines = scope === 'local' ? (['google'] as Engine[]) : input.engines;
  const out: RankCheck[] = [];

  for (const engine of engines) {
    const provider = scope === 'local'
      ? configuredProviders().find((p) => p.name === 'serpapi') ?? null
      : pickProvider(engine);
    if (!provider) {
      out.push({
        engine, provider: 'none', position: null, url: null, title: null,
        resultsChecked: 0, features: [], skipped: true,
        error: scope === 'local'
          ? 'Map results need a SerpApi key.'
          : `No search data source is set up for ${engine}.`,
      });
      continue;
    }

    const budget = await usage(provider.name);
    if (budget.remaining <= 0) {
      out.push({
        engine, provider: provider.name, position: null, url: null, title: null,
        resultsChecked: 0, features: [], skipped: true,
        error: `Monthly budget exhausted for ${provider.name} (${budget.used}/${budget.limit}).`,
      });
      continue;
    }

    const response = await provider.search({
      phrase: input.keyword,
      engine,
      device: input.device,
      country: input.country ?? null,
      city: input.city ?? null,
      language: input.language ?? null,
      scope,
    });
    // A call was made — meter it whether or not it found the domain.
    await consume(provider.name);

    const hit = response.results.find((r) => matchesSite(r.url, origin));
    out.push({
      engine,
      provider: response.provider,
      position: hit?.position ?? null,
      url: hit?.url ?? null,
      title: hit?.title ?? null,
      resultsChecked: response.resultsChecked,
      features: response.features,
      error: response.error,
      skipped: false,
    });
  }

  return out;
}

/**
 * Save an on-demand website check as tracked keywords so their positions build
 * a history over time. Local (map) checks are not persisted yet — they stay
 * on-demand. Returns how many keyword rows were saved.
 */
export async function saveTrackedCheck(input: CheckRankInput, results: RankCheck[]): Promise<number> {
  const site = await upsertSite(input.domain);
  let saved = 0;
  for (const r of results) {
    if (r.skipped) continue;
    const kw = await addKeyword({
      siteId: site.id,
      phrase: input.keyword,
      engine: r.engine,
      device: input.device,
      country: input.country ?? null,
      city: input.city ?? null,
      language: input.language ?? null,
    });
    await run(
      `INSERT INTO rank_snapshots
         (keyword_id, checked_at, position, url, title, serp_features, results_checked, provider, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      kw.id, Date.now(), r.position, r.url, r.title,
      JSON.stringify(r.features), r.resultsChecked, r.provider, r.error,
    );
    saved++;
  }
  return saved;
}

export async function trackKeyword(keyword: Keyword, site: Site): Promise<TrackResult> {
  const provider = pickProvider(keyword.engine);
  const previous = (await latestSnapshot(keyword.id))?.position ?? null;

  if (!provider) {
    return {
      keyword, position: null, previousPosition: previous, url: null,
      provider: 'none', skipped: true,
      error: `No configured SERP provider supports ${keyword.engine}. Set SERPAPI_KEY, VALUESERP_KEY or DATAFORSEO_LOGIN/PASSWORD.`,
    };
  }

  const budget = await usage(provider.name);
  if (budget.remaining <= 0) {
    return {
      keyword, position: null, previousPosition: previous, url: null,
      provider: provider.name, skipped: true,
      error: `Monthly budget exhausted for ${provider.name} (${budget.used}/${budget.limit} used in ${budget.period})`,
    };
  }

  const response = await provider.search({
    phrase: keyword.phrase,
    engine: keyword.engine,
    device: keyword.device,
    country: keyword.country,
    city: keyword.city,
    language: keyword.language,
  });

  // A failed call still consumed quota at most providers, so meter it either way.
  await consume(provider.name);

  const hit = response.results.find((r) => matchesSite(r.url, site.origin));
  const now = Date.now();

  await run(
    `INSERT INTO rank_snapshots
       (keyword_id, checked_at, position, url, title, serp_features, results_checked, provider, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    keyword.id, now, hit?.position ?? null, hit?.url ?? null, hit?.title ?? null,
    JSON.stringify(response.features), response.resultsChecked, response.provider, response.error,
  );

  return {
    keyword,
    position: hit?.position ?? null,
    previousPosition: previous,
    url: hit?.url ?? null,
    provider: response.provider,
    error: response.error,
    skipped: false,
  };
}

/**
 * Track every active keyword, stopping cleanly when the budget runs out rather
 * than failing partway through with half the data written.
 */
export async function trackAll(siteId?: number): Promise<TrackResult[]> {
  const sites = new Map((await listSites()).map((s) => [s.id, s]));
  const keywords = await listKeywords(siteId);
  const out: TrackResult[] = [];

  for (const kw of keywords) {
    const site = sites.get(kw.site_id);
    if (!site) continue;
    const r = await trackKeyword(kw, site);
    out.push(r);
    // Politeness gap between provider calls.
    if (!r.skipped) await new Promise((res) => setTimeout(res, 1200));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface KeywordWithRank extends Keyword {
  origin: string;
  position: number | null;
  previous_position: number | null;
  url: string | null;
  checked_at: number | null;
  provider: string | null;
  error: string | null;
}

/**
 * Current position plus the one before it, per keyword.
 *
 * The correlated subqueries keep this a single round trip; at the scale a
 * tool like this tracks (tens to low hundreds of keywords) that is comfortably
 * fast and far simpler than materialising a movement table.
 */
export async function keywordsWithRanks(siteId?: number): Promise<KeywordWithRank[]> {
  const where = siteId ? 'WHERE k.active = 1 AND k.site_id = ' + Number(siteId) : 'WHERE k.active = 1';
  return all<KeywordWithRank>(`
    SELECT k.*, s.origin,
      latest.position       AS position,
      latest.url            AS url,
      latest.checked_at     AS checked_at,
      latest.provider       AS provider,
      latest.error          AS error,
      prev.position         AS previous_position
    FROM keywords k
    JOIN sites s ON s.id = k.site_id
    LEFT JOIN rank_snapshots latest
      ON latest.id = (SELECT id FROM rank_snapshots WHERE keyword_id = k.id
                      ORDER BY checked_at DESC LIMIT 1)
    LEFT JOIN rank_snapshots prev
      ON prev.id = (SELECT id FROM rank_snapshots WHERE keyword_id = k.id
                    ORDER BY checked_at DESC LIMIT 1 OFFSET 1)
    ${where}
    ORDER BY (latest.position IS NULL), latest.position, k.phrase
  `);
}

export async function rankHistory(keywordId: number, limit = 90): Promise<RankSnapshot[]> {
  return all<RankSnapshot>(
    'SELECT * FROM rank_snapshots WHERE keyword_id = ? ORDER BY checked_at DESC LIMIT ?',
    keywordId, limit,
  );
}
