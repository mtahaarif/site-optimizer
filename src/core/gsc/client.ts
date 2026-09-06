/**
 * Google Search Console — Search Analytics client.
 *
 * Pulls per-URL clicks, impressions, CTR and average position for a date range,
 * and caches the result in SQLite so repeated dashboard loads and re-audits of
 * the same window cost nothing.
 *
 * Caching is not merely an optimisation here. Search Console enforces a quota
 * of 1,200 queries per minute and 200 per day per property on the Search
 * Analytics endpoint, and a crawl of a large site would otherwise re-query the
 * same finalised window on every run.
 */
import { all, get, run, tx } from '../../db/index.ts';
import { normalizeUrl } from '../extract.ts';
import { getAccessToken } from './auth.ts';
import { gscSettings } from '../integrations/store.ts';

const ENDPOINT = 'https://www.googleapis.com/webmasters/v3/sites';
const ROW_LIMIT = 25_000;

export interface PageMetrics {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscData {
  property: string;
  startDate: string;
  endDate: string;
  /** normalized URL -> metrics */
  byUrl: Map<string, PageMetrics>;
  totalClicks: number;
  totalImpressions: number;
  rowCount: number;
  fromCache: boolean;
  fetchedAt: number;
  error: string | null;
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Search Console finalises data with a two-to-three day lag, so a window ending
 * today is always incomplete. Defaulting the end date back three days means the
 * numbers are stable and the cache entry never needs invalidating.
 */
export function defaultRange(days = 28): { startDate: string; endDate: string } {
  const end = new Date(Date.now() - 3 * 86_400_000);
  const start = new Date(end.getTime() - days * 86_400_000);
  return { startDate: iso(start), endDate: iso(end) };
}

/** A range whose end is within the lag window can still change. */
function isRangeFinal(endDate: string): boolean {
  return Date.parse(endDate) < Date.now() - 3 * 86_400_000;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface FetchRow {
  id: number; fetched_at: number; row_count: number; clicks: number; impressions: number;
}

async function readCache(property: string, startDate: string, endDate: string): Promise<GscData | null> {
  const row = await get<FetchRow>(
    'SELECT id, fetched_at, row_count, clicks, impressions FROM gsc_fetches WHERE property = ? AND start_date = ? AND end_date = ?',
    property, startDate, endDate,
  );
  if (!row) return null;

  // A finalised window never changes, so it is cached indefinitely. A window
  // that still overlaps the lag period expires.
  if (!isRangeFinal(endDate) && Date.now() - row.fetched_at > CACHE_TTL_MS) return null;

  const metrics = await all<{ url: string; url_key: string; clicks: number; impressions: number; ctr: number; position: number }>(
    'SELECT url, url_key, clicks, impressions, ctr, position FROM gsc_page_metrics WHERE fetch_id = ?',
    row.id,
  );

  const byUrl = new Map<string, PageMetrics>();
  for (const m of metrics) {
    byUrl.set(m.url_key, {
      url: m.url, clicks: m.clicks, impressions: m.impressions, ctr: m.ctr, position: m.position,
    });
  }

  return {
    property, startDate, endDate, byUrl,
    totalClicks: row.clicks,
    totalImpressions: row.impressions,
    rowCount: row.row_count,
    fromCache: true,
    fetchedAt: row.fetched_at,
    error: null,
  };
}

async function writeCache(data: GscData): Promise<void> {
  await tx(async () => {
    await run('DELETE FROM gsc_fetches WHERE property = ? AND start_date = ? AND end_date = ?',
      data.property, data.startDate, data.endDate);

    const { lastInsertRowid } = await run(
      `INSERT INTO gsc_fetches (property, start_date, end_date, fetched_at, row_count, clicks, impressions)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      data.property, data.startDate, data.endDate, data.fetchedAt,
      data.rowCount, data.totalClicks, data.totalImpressions,
    );

    for (const [key, m] of data.byUrl) {
      await run(
        `INSERT INTO gsc_page_metrics (fetch_id, url, url_key, clicks, impressions, ctr, position)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        lastInsertRowid, m.url, key, m.clicks, m.impressions, m.ctr, m.position,
      );
    }
  });
}

// ---------------------------------------------------------------------------

interface SearchAnalyticsRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

/**
 * Fetch per-page metrics for a date range.
 *
 * Never throws: a missing credential, a revoked property or a quota error comes
 * back as `error` with an empty map, so an audit degrades to "no traffic data"
 * rather than failing outright.
 */
export async function fetchPageMetrics(opts: {
  startDate?: string;
  endDate?: string;
  property?: string;
  skipCache?: boolean;
} = {}): Promise<GscData> {
  const settings = await gscSettings();
  const property = opts.property ?? settings?.siteUrl ?? '';
  const range = defaultRange();
  const startDate = opts.startDate ?? range.startDate;
  const endDate = opts.endDate ?? range.endDate;

  const empty = (error: string | null): GscData => ({
    property, startDate, endDate, byUrl: new Map(),
    totalClicks: 0, totalImpressions: 0, rowCount: 0,
    fromCache: false, fetchedAt: Date.now(), error,
  });

  if (!settings) {
    return empty('Search Console is not connected. Connect it on the Insights page.');
  }

  if (!opts.skipCache) {
    const cached = await readCache(property, startDate, endDate);
    if (cached) return cached;
  }

  try {
    const token = await getAccessToken();
    const byUrl = new Map<string, PageMetrics>();
    let totalClicks = 0;
    let totalImpressions = 0;
    let startRow = 0;

    // The API caps a response at 25,000 rows; large sites need paging.
    for (;;) {
      const res = await fetch(
        `${ENDPOINT}/${encodeURIComponent(property)}/searchAnalytics/query`,
        {
          method: 'POST',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
          body: JSON.stringify({
            startDate, endDate,
            dimensions: ['page'],
            rowLimit: ROW_LIMIT,
            startRow,
            dataState: 'final',
          }),
        },
      );

      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        return empty(
          res.status === 403
            ? `Search Console denied access to ${property}. Confirm the service account is added as a user on the property. ${body}`
            : `Search Analytics query failed: HTTP ${res.status} ${body}`,
        );
      }

      const data = await res.json() as { rows?: SearchAnalyticsRow[] };
      const rows = data.rows ?? [];

      for (const r of rows) {
        const url = r.keys?.[0];
        if (!url) continue;
        const clicks = Math.round(r.clicks ?? 0);
        const impressions = Math.round(r.impressions ?? 0);
        byUrl.set(normalizeUrl(url), {
          url,
          clicks,
          impressions,
          ctr: r.ctr ?? 0,
          position: r.position ?? 0,
        });
        totalClicks += clicks;
        totalImpressions += impressions;
      }

      if (rows.length < ROW_LIMIT) break;
      startRow += rows.length;
      if (startRow >= 100_000) break; // sanity ceiling
    }

    const result: GscData = {
      property, startDate, endDate, byUrl,
      totalClicks, totalImpressions,
      rowCount: byUrl.size,
      fromCache: false,
      fetchedAt: Date.now(),
      error: null,
    };

    try { await writeCache(result); } catch { /* caching is best-effort */ }
    return result;
  } catch (err) {
    return empty((err as Error).message);
  }
}

/** Cache contents, for the dashboard and the CLI to report on. */
export interface QueryMetrics {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface QueryReport {
  property: string;
  startDate: string;
  endDate: string;
  rows: QueryMetrics[];
  error: string | null;
}

/**
 * Top search terms people actually used to reach the site.
 *
 * Deliberately uncached and small: this powers one screen, asks for a couple of
 * dozen rows, and is the number a site owner most wants to see fresh. The
 * per-page metrics keep their SQLite cache because the audit reads them for
 * every crawled URL.
 */
export async function fetchQueryMetrics(opts: {
  startDate?: string;
  endDate?: string;
  property?: string;
  limit?: number;
} = {}): Promise<QueryReport> {
  const settings = await gscSettings();
  const property = opts.property ?? settings?.siteUrl ?? '';
  const range = defaultRange();
  const startDate = opts.startDate ?? range.startDate;
  const endDate = opts.endDate ?? range.endDate;
  const base = { property, startDate, endDate, rows: [] as QueryMetrics[] };

  if (!settings) return { ...base, error: 'Search Console is not connected.' };

  try {
    const token = await getAccessToken();
    const res = await fetch(
      `${ENDPOINT}/${encodeURIComponent(property)}/searchAnalytics/query`,
      {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({
          startDate, endDate,
          dimensions: ['query'],
          rowLimit: opts.limit ?? 25,
          dataState: 'final',
        }),
      },
    );
    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      return { ...base, error: res.status === 403
        ? `Search Console denied access to ${property}. Add the service account as a user on the property.`
        : `Could not load search terms (HTTP ${res.status}). ${body}` };
    }
    const data = await res.json() as { rows?: SearchAnalyticsRow[] };
    const rows: QueryMetrics[] = (data.rows ?? []).map((r) => ({
      query: r.keys?.[0] ?? '',
      clicks: Math.round(r.clicks ?? 0),
      impressions: Math.round(r.impressions ?? 0),
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    })).filter((r) => r.query);
    return { ...base, rows, error: null };
  } catch (err) {
    return { ...base, error: (err as Error).message };
  }
}

export async function cachedRanges(): Promise<Array<{
  property: string; startDate: string; endDate: string;
  rowCount: number; clicks: number; impressions: number; fetchedAt: number;
}>> {
  return all(
    `SELECT property, start_date AS "startDate", end_date AS "endDate",
            row_count AS "rowCount", clicks, impressions, fetched_at AS "fetchedAt"
     FROM gsc_fetches ORDER BY fetched_at DESC`,
  );
}

export async function clearCache(): Promise<number> {
  const before = (await get<{ c: number }>('SELECT COUNT(*) c FROM gsc_fetches'))?.c ?? 0;
  await run('DELETE FROM gsc_fetches');
  return before;
}
