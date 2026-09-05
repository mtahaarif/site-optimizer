/**
 * Crawl report storage.
 *
 * Reports live in the same Postgres database as monitoring, ranks and
 * backlinks, so score history sits alongside uptime and rankings. The full
 * AuditReport is kept as a JSON blob because it is read whole and never
 * queried field-by-field; the columns beside it exist so trends can be charted
 * without deserialising every report.
 */
import { gzipSync, gunzipSync } from 'node:zlib';
import { all, get, run, upsertSite, type Site } from '../db/index.ts';
import { normalizeUrl } from '../core/extract.ts';
import type { AuditReport } from './audit.ts';
import type { CrawlProgress } from './crawl.ts';

export interface Job {
  id: string;
  startUrl: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: CrawlProgress;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  report: AuditReport | null;
}

/**
 * Job progress lives in Postgres, not in a process-local map: the request that
 * starts a crawl and the request that polls its progress are not guaranteed to
 * land on the same serverless instance, so "in memory" would mean "invisible
 * to the poll" as often as not. `report` is never populated from here — once a
 * job is done, `loadReport` reads the real row from `crawls`.
 */
interface JobRow {
  id: string; start_url: string; status: Job['status']; progress: string;
  error: string | null; created_at: number; finished_at: number | null;
}

const toJob = (r: JobRow): Job => ({
  id: r.id, startUrl: r.start_url, status: r.status,
  progress: JSON.parse(r.progress) as CrawlProgress, error: r.error,
  createdAt: new Date(Number(r.created_at)).toISOString(),
  finishedAt: r.finished_at ? new Date(Number(r.finished_at)).toISOString() : null,
  report: null,
});

export async function createJob(id: string, startUrl: string): Promise<Job> {
  const progress: CrawlProgress = { phase: 'robots', crawled: 0, queued: 0, total: 0, currentUrl: null, message: 'Starting' };
  const now = Date.now();
  await run(
    `INSERT INTO crawl_jobs (id, start_url, status, progress, created_at)
     VALUES (?, ?, 'queued', ?, ?)`,
    id, startUrl, JSON.stringify(progress), now,
  );
  return { id, startUrl, status: 'queued', progress, error: null, createdAt: new Date(now).toISOString(), finishedAt: null, report: null };
}

export async function getJob(id: string): Promise<Job | undefined> {
  const row = await get<JobRow>('SELECT * FROM crawl_jobs WHERE id = ?', id);
  return row ? toJob(row) : undefined;
}

export async function updateProgress(id: string, progress: CrawlProgress): Promise<void> {
  await run(
    `UPDATE crawl_jobs SET status = ?, progress = ? WHERE id = ?`,
    progress.phase === 'done' ? 'done' : 'running', JSON.stringify(progress), id,
  );
}

export async function completeJob(id: string, report: AuditReport): Promise<void> {
  const progress: CrawlProgress = { phase: 'done', crawled: report.counts.crawled, queued: 0, total: report.counts.crawled, currentUrl: null, message: 'Complete' };
  await run(
    `UPDATE crawl_jobs SET status = 'done', progress = ?, finished_at = ? WHERE id = ?`,
    JSON.stringify(progress), Date.now(), id,
  );
  await saveReport(report);
}

export async function failJob(id: string, error: string): Promise<void> {
  await run(
    `UPDATE crawl_jobs SET status = 'error', error = ?, finished_at = ? WHERE id = ?`,
    error, Date.now(), id,
  );
}

// ---------------------------------------------------------------------------
// HTML snapshots — "view issue in code"
// ---------------------------------------------------------------------------

export interface PageSnapshot {
  url: string;
  html: string;
  rendered: boolean;
}

/** Skip anything this large; a single page should never dominate the database. */
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * Persist the raw HTML of every crawled page, gzipped.
 *
 * Compression is what makes this viable at all: HTML is highly repetitive and
 * routinely compresses to 10-20% of its original size, so a 200-page crawl adds
 * a few megabytes rather than tens.
 */
export async function saveSnapshots(crawlId: string, snapshots: PageSnapshot[]): Promise<{
  saved: number; rawBytes: number; gzipBytes: number;
}> {
  let saved = 0, rawBytes = 0, gzipBytes = 0;
  const now = Date.now();

  for (const snap of snapshots) {
    if (!snap.html) continue;
    const raw = Buffer.byteLength(snap.html, 'utf8');
    if (raw > MAX_SNAPSHOT_BYTES) continue;
    try {
      const gz = gzipSync(Buffer.from(snap.html, 'utf8'), { level: 6 });
      await run(
        `INSERT INTO page_snapshots
           (crawl_id, url, url_key, gzipped, raw_bytes, gzip_bytes, rendered, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(crawl_id, url_key) DO NOTHING`,
        crawlId, snap.url, normalizeUrl(snap.url), gz,
        raw, gz.length, snap.rendered ? 1 : 0, now,
      );
      saved++; rawBytes += raw; gzipBytes += gz.length;
    } catch { /* one unstorable page must not fail the crawl */ }
  }
  return { saved, rawBytes, gzipBytes };
}

export interface StoredSnapshot {
  url: string;
  html: string;
  rendered: boolean;
  rawBytes: number;
  gzipBytes: number;
}

/** Fetch and decompress one page's HTML. */
export async function loadSnapshot(crawlId: string, url: string): Promise<StoredSnapshot | null> {
  const row = await get<{
    url: string; gzipped: Buffer; raw_bytes: number; gzip_bytes: number; rendered: number;
  }>(
    'SELECT url, gzipped, raw_bytes, gzip_bytes, rendered FROM page_snapshots WHERE crawl_id = ? AND url_key = ?',
    crawlId, normalizeUrl(url),
  );
  if (!row) return null;
  try {
    return {
      url: row.url,
      html: gunzipSync(Buffer.from(row.gzipped)).toString('utf8'),
      rendered: row.rendered === 1,
      rawBytes: row.raw_bytes,
      gzipBytes: row.gzip_bytes,
    };
  } catch {
    return null;
  }
}

export async function snapshotStats(crawlId: string): Promise<{ count: number; rawBytes: number; gzipBytes: number }> {
  const row = await get<{ c: number; raw: number | null; gz: number | null }>(
    'SELECT COUNT(*) c, SUM(raw_bytes) raw, SUM(gzip_bytes) gz FROM page_snapshots WHERE crawl_id = ?',
    crawlId,
  );
  return { count: row?.c ?? 0, rawBytes: row?.raw ?? 0, gzipBytes: row?.gz ?? 0 };
}

export async function hasSnapshot(crawlId: string, url: string): Promise<boolean> {
  return !!(await get<{ id: number }>(
    'SELECT id FROM page_snapshots WHERE crawl_id = ? AND url_key = ?',
    crawlId, normalizeUrl(url),
  ));
}

export async function saveReport(report: AuditReport): Promise<void> {
  const site = await upsertSite(report.origin);
  await run(
    `INSERT INTO crawls
       (id, site_id, created_at, duration_ms, score, rubric_version, pages,
        checks_failed, checks_passed, blockers, criticals, warnings, is_next, report_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       score = excluded.score, report_json = excluded.report_json`,
    report.id, site.id, Date.parse(report.createdAt), report.durationMs,
    report.score, report.rubricVersion, report.counts.htmlPages,
    report.counts.checksFailed, report.counts.checksPassed,
    report.severity.blocker, report.severity.critical, report.severity.warning,
    report.isNext ? 1 : 0, JSON.stringify(report),
  );
}

export async function loadReport(id: string): Promise<AuditReport | null> {
  const row = await get<{ report_json: string }>('SELECT report_json FROM crawls WHERE id = ?', id);
  if (!row) return null;
  return JSON.parse(row.report_json) as AuditReport;
}

export interface ReportIndexEntry {
  id: string;
  origin: string;
  startUrl: string;
  createdAt: string;
  score: number;
  crawled: number;
  checksFailed: number;
  isNext: boolean;
}

export async function listReports(): Promise<ReportIndexEntry[]> {
  const rows = await all<{
    id: string; origin: string; created_at: number; score: number;
    pages: number; checks_failed: number; is_next: number;
  }>(`SELECT c.id, s.origin, c.created_at, c.score, c.pages, c.checks_failed, c.is_next
      FROM crawls c JOIN sites s ON s.id = c.site_id
      ORDER BY c.created_at DESC`);

  return rows.map((r) => ({
    id: r.id,
    origin: r.origin,
    startUrl: r.origin,
    createdAt: new Date(Number(r.created_at)).toISOString(),
    score: r.score,
    crawled: r.pages,
    checksFailed: r.checks_failed,
    isNext: r.is_next === 1,
  }));
}

export interface ScorePoint {
  id: string;
  created_at: number;
  score: number;
  checks_failed: number;
  blockers: number;
  criticals: number;
  warnings: number;
}

/** Score history for one site, oldest first, for the trend chart. */
export async function scoreHistory(siteId: number, limit = 60): Promise<ScorePoint[]> {
  const rows = await all<ScorePoint>(
    `SELECT id, created_at, score, checks_failed, blockers, criticals, warnings
     FROM crawls WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
    siteId, limit,
  );
  return rows.reverse();
}

export interface CrawlHistoryPoint {
  id: string;
  created_at: number;
  score: number;
  pages: number;
  checks_failed: number;
  blockers: number;
  criticals: number;
  warnings: number;
}

/** Every crawl for the site that owns `crawlId`, oldest first — for the compare view. */
export async function crawlHistory(crawlId: string, limit = 40): Promise<CrawlHistoryPoint[]> {
  const row = await get<{ site_id: number }>('SELECT site_id FROM crawls WHERE id = ?', crawlId);
  if (!row) return [];
  const rows = await all<CrawlHistoryPoint>(
    `SELECT id, created_at, score, pages, checks_failed, blockers, criticals, warnings
     FROM crawls WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
    row.site_id, limit,
  );
  return rows.reverse();
}

/** The crawl immediately preceding `crawlId` for the same site, if any. */
export async function previousCrawlId(crawlId: string): Promise<string | null> {
  const row = await get<{ site_id: number; created_at: number }>(
    'SELECT site_id, created_at FROM crawls WHERE id = ?', crawlId,
  );
  if (!row) return null;
  const prev = await get<{ id: string }>(
    `SELECT id FROM crawls WHERE site_id = ? AND created_at < ?
     ORDER BY created_at DESC LIMIT 1`,
    row.site_id, row.created_at,
  );
  return prev?.id ?? null;
}

// ---------------------------------------------------------------------------
// Projects — one website is one project, whatever its number of crawls.
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  siteId: number;
  origin: string;
  label: string | null;
  crawlCount: number;
  firstScore: number | null;
  firstAt: number | null;
  latestId: string | null;
  latestScore: number | null;
  latestAt: number | null;
  latestIssues: number | null;
  isNext: boolean;
}

/** Every website as a project, with first/latest crawl so a trend is visible at a glance. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const sites = await all<Site>('SELECT * FROM sites ORDER BY created_at DESC');
  return Promise.all(sites.map(async (s) => {
    const agg = await get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM crawls WHERE site_id = ?', s.id);
    const first = await get<{ score: number; created_at: number }>(
      'SELECT score, created_at FROM crawls WHERE site_id = ? ORDER BY created_at ASC LIMIT 1', s.id);
    const latest = await get<{ id: string; score: number; created_at: number; checks_failed: number; is_next: number }>(
      'SELECT id, score, created_at, checks_failed, is_next FROM crawls WHERE site_id = ? ORDER BY created_at DESC LIMIT 1', s.id);
    return {
      siteId: s.id, origin: s.origin, label: s.label,
      crawlCount: agg?.cnt ?? 0,
      firstScore: first?.score ?? null, firstAt: first?.created_at ?? null,
      latestId: latest?.id ?? null, latestScore: latest?.score ?? null,
      latestAt: latest?.created_at ?? null, latestIssues: latest?.checks_failed ?? null,
      isNext: !!latest?.is_next,
    };
  }));
}

/** Create (or find) a project for a website. Returns the site row. */
export async function createProject(url: string, label?: string): Promise<Site> {
  return upsertSite(url, label);
}

/** Every crawl for one project, oldest first — powers the trend graphs. */
export async function projectCrawls(siteId: number, limit = 100): Promise<CrawlHistoryPoint[]> {
  return all<CrawlHistoryPoint>(
    `SELECT id, created_at, score, pages, checks_failed, blockers, criticals, warnings
     FROM crawls WHERE site_id = ? ORDER BY created_at ASC LIMIT ?`,
    siteId, limit,
  );
}

/** Delete a project and everything under it (crawls, snapshots, keywords, backlinks, monitor). */
export async function deleteProject(siteId: number): Promise<void> {
  const ids = await all<{ id: string }>('SELECT id FROM crawls WHERE site_id = ?', siteId);
  for (const { id } of ids) await run('DELETE FROM crawl_jobs WHERE id = ?', id);
  await run('DELETE FROM page_snapshots WHERE crawl_id IN (SELECT id FROM crawls WHERE site_id = ?)', siteId);
  await run('DELETE FROM sites WHERE id = ?', siteId); // ON DELETE CASCADE clears the rest
}

export async function deleteReport(id: string): Promise<void> {
  await run('DELETE FROM crawl_jobs WHERE id = ?', id);
  await run('DELETE FROM page_snapshots WHERE crawl_id = ?', id);
  await run('DELETE FROM crawls WHERE id = ?', id);
}
