/**
 * Google Analytics 4 — Data API (v1beta) client.
 *
 * Shares the service-account JWT implementation with Search Console; only the
 * OAuth scope differs. Same reasoning as there: this is one signed assertion
 * and one POST, and the official SDK is not worth the dependency.
 *
 * GA4 reports *behaviour* where Search Console reports *acquisition*. Both feed
 * page importance, and they disagree often enough to be worth having: a page
 * with heavy internal traffic and no impressions is a different problem from
 * one with impressions and no sessions.
 */
import { all, get, run, tx } from '../../db/index.ts';
import { getAccessToken, parseServiceAccount } from '../gsc/auth.ts';
import { ga4Settings } from '../integrations/store.ts';

const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const ENDPOINT = 'https://analyticsdata.googleapis.com/v1beta/properties';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface Ga4PageMetrics {
  path: string;
  pageviews: number;
  sessions: number;
  users: number;
  conversions: number;
  bounceRate: number;
  avgDurationSec: number;
}

export interface Ga4Data {
  propertyId: string;
  startDate: string;
  endDate: string;
  /** URL path (e.g. "/pricing") -> metrics */
  byPath: Map<string, Ga4PageMetrics>;
  totalSessions: number;
  totalUsers: number;
  totalPageviews: number;
  totalConversions: number;
  fromCache: boolean;
  fetchedAt: number;
  error: string | null;
}

export async function ga4PropertyId(): Promise<string | null> {
  return (await ga4Settings())?.propertyId ?? null;
}

export async function ga4Configured(): Promise<boolean> {
  return (await ga4Settings()) !== null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function defaultRange(days = 28): { startDate: string; endDate: string } {
  const end = new Date(Date.now() - 86_400_000); // yesterday: today is partial
  const start = new Date(end.getTime() - days * 86_400_000);
  return { startDate: iso(start), endDate: iso(end) };
}

/**
 * Normalise a GA4 pagePath to something comparable with a crawled URL.
 * GA4 reports paths with query strings attached and inconsistent trailing
 * slashes, neither of which the crawl frontier preserves.
 */
export function normalizePath(pathOrUrl: string): string {
  let p = pathOrUrl;
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch { /* fall through and treat as a path */ }
  p = p.split('?')[0]!.split('#')[0]!;
  if (!p.startsWith('/')) p = '/' + p;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p.toLowerCase();
}

/** Extract the comparable path from a full crawled URL. */
export function pathOfUrl(url: string): string {
  try { return normalizePath(new URL(url).pathname); } catch { return normalizePath(url); }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

async function readCache(propertyId: string, startDate: string, endDate: string): Promise<Ga4Data | null> {
  const rows = await all<{
    url_path: string; pageviews: number; sessions: number; users: number;
    conversions: number; bounce_rate: number; avg_duration_sec: number; fetched_at: number;
  }>(
    `SELECT url_path, pageviews, sessions, users, conversions, bounce_rate,
            avg_duration_sec, fetched_at
     FROM ga4_metrics WHERE site_id = ? AND start_date = ? AND end_date = ?`,
    propertyId, startDate, endDate,
  );
  if (rows.length === 0) return null;

  const fetchedAt = rows[0]!.fetched_at;
  if (Date.now() - fetchedAt > CACHE_TTL_MS) return null;

  const byPath = new Map<string, Ga4PageMetrics>();
  let totalSessions = 0, totalUsers = 0, totalPageviews = 0, totalConversions = 0;

  for (const r of rows) {
    byPath.set(r.url_path, {
      path: r.url_path,
      pageviews: r.pageviews,
      sessions: r.sessions,
      users: r.users,
      conversions: r.conversions,
      bounceRate: r.bounce_rate,
      avgDurationSec: r.avg_duration_sec,
    });
    totalSessions += r.sessions;
    totalUsers += r.users;
    totalPageviews += r.pageviews;
    totalConversions += r.conversions;
  }

  return {
    propertyId, startDate, endDate, byPath,
    totalSessions, totalUsers, totalPageviews, totalConversions,
    fromCache: true, fetchedAt, error: null,
  };
}

async function writeCache(data: Ga4Data): Promise<void> {
  await tx(async () => {
    await run('DELETE FROM ga4_metrics WHERE site_id = ? AND start_date = ? AND end_date = ?',
      data.propertyId, data.startDate, data.endDate);
    for (const m of data.byPath.values()) {
      await run(
        `INSERT INTO ga4_metrics
           (site_id, url_path, start_date, end_date, pageviews, sessions, users,
            conversions, bounce_rate, avg_duration_sec, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        data.propertyId, m.path, data.startDate, data.endDate,
        m.pageviews, m.sessions, m.users, m.conversions,
        m.bounceRate, m.avgDurationSec, data.fetchedAt,
      );
    }
  });
}

// ---------------------------------------------------------------------------

interface RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?: Array<{ value?: string }>;
  }>;
  rowCount?: number;
  error?: { message?: string; status?: string };
}

const METRICS = [
  'screenPageViews', 'sessions', 'totalUsers',
  'conversions', 'bounceRate', 'averageSessionDuration',
] as const;

/**
 * Fetch per-path engagement metrics.
 *
 * Never throws — a missing property, a revoked service account or a quota error
 * comes back as `error` with an empty map, so an audit degrades to "no
 * analytics data" rather than failing.
 */
export async function fetchGa4Metrics(opts: {
  startDate?: string;
  endDate?: string;
  propertyId?: string;
  skipCache?: boolean;
} = {}): Promise<Ga4Data> {
  const settings = await ga4Settings();
  const propertyId = opts.propertyId ?? settings?.propertyId ?? '';
  const range = defaultRange();
  const startDate = opts.startDate ?? range.startDate;
  const endDate = opts.endDate ?? range.endDate;

  const empty = (error: string | null): Ga4Data => ({
    propertyId, startDate, endDate, byPath: new Map(),
    totalSessions: 0, totalUsers: 0, totalPageviews: 0, totalConversions: 0,
    fromCache: false, fetchedAt: Date.now(), error,
  });

  if (!settings) {
    return empty('Google Analytics is not connected. Connect it on the Insights page.');
  }

  if (!opts.skipCache) {
    const cached = await readCache(propertyId, startDate, endDate);
    if (cached) return cached;
  }

  try {
    // Analytics can be connected with a different service account than Search
    // Console, so the token is minted from this integration's own credentials
    // rather than whatever the GSC default resolves to.
    const token = await getAccessToken(
      ANALYTICS_SCOPE, parseServiceAccount(settings.serviceAccountJson),
    );
    const byPath = new Map<string, Ga4PageMetrics>();
    let offset = 0;
    const limit = 10_000;

    for (;;) {
      const res = await fetch(`${ENDPOINT}/${propertyId}:runReport`, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({
          dateRanges: [{ startDate, endDate }],
          dimensions: [{ name: 'pagePath' }],
          metrics: METRICS.map((name) => ({ name })),
          limit,
          offset,
          keepEmptyRows: false,
        }),
      });

      if (!res.ok) {
        const body = (await res.text()).slice(0, 300);
        return empty(
          res.status === 403
            ? `GA4 denied access to property ${propertyId}. Add the service account email as a Viewer on the property. ${body}`
            : `GA4 runReport failed: HTTP ${res.status} ${body}`,
        );
      }

      const data = await res.json() as RunReportResponse;
      if (data.error) return empty(data.error.message ?? 'GA4 returned an error');

      const rows = data.rows ?? [];
      for (const r of rows) {
        const path = r.dimensionValues?.[0]?.value;
        if (!path) continue;
        const v = (i: number) => Number(r.metricValues?.[i]?.value ?? 0) || 0;
        const key = normalizePath(path);

        // GA4 reports "/a" and "/a/" as distinct rows; normalising collapses
        // them, so metrics for the same page must be summed rather than
        // overwritten or the second row silently discards the first.
        const existing = byPath.get(key);
        const next: Ga4PageMetrics = {
          path: key,
          pageviews: v(0) + (existing?.pageviews ?? 0),
          sessions: v(1) + (existing?.sessions ?? 0),
          users: v(2) + (existing?.users ?? 0),
          conversions: v(3) + (existing?.conversions ?? 0),
          // Rates are averaged by session weight, not summed.
          bounceRate: existing
            ? (existing.bounceRate * existing.sessions + v(4) * v(1)) / Math.max(1, existing.sessions + v(1))
            : v(4),
          avgDurationSec: existing
            ? (existing.avgDurationSec * existing.sessions + v(5) * v(1)) / Math.max(1, existing.sessions + v(1))
            : v(5),
        };
        byPath.set(key, next);
      }

      if (rows.length < limit) break;
      offset += rows.length;
      if (offset >= 100_000) break;
    }

    let totalSessions = 0, totalUsers = 0, totalPageviews = 0, totalConversions = 0;
    for (const m of byPath.values()) {
      totalSessions += m.sessions;
      totalUsers += m.users;
      totalPageviews += m.pageviews;
      totalConversions += m.conversions;
    }

    const result: Ga4Data = {
      propertyId, startDate, endDate, byPath,
      totalSessions, totalUsers, totalPageviews, totalConversions,
      fromCache: false, fetchedAt: Date.now(), error: null,
    };

    try { await writeCache(result); } catch { /* caching is best-effort */ }
    return result;
  } catch (err) {
    return empty((err as Error).message);
  }
}

export async function ga4CacheStats(): Promise<Array<{
  propertyId: string; startDate: string; endDate: string; paths: number; fetchedAt: number;
}>> {
  return all(
    `SELECT site_id AS "propertyId", start_date AS "startDate", end_date AS "endDate",
            COUNT(*) AS paths, MAX(fetched_at) AS "fetchedAt"
     FROM ga4_metrics GROUP BY site_id, start_date, end_date ORDER BY "fetchedAt" DESC`,
  );
}

export async function clearGa4Cache(): Promise<number> {
  const before = (await get<{ c: number }>('SELECT COUNT(*) c FROM ga4_metrics'))?.c ?? 0;
  await run('DELETE FROM ga4_metrics');
  return before;
}
