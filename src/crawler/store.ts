/**
 * Crawl report storage.
 *
 * Reports live in the same SQLite file as monitoring, ranks and backlinks, so
 * score history sits alongside uptime and rankings and the whole tool is one
 * portable file. The full AuditReport is kept as a JSON blob because it is read
 * whole and never queried field-by-field; the columns beside it exist so trends
 * can be charted without deserialising every report.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { all, get, run, upsertSite, db, type Site } from '../db/index.ts';
import { normalizeUrl } from '../core/extract.ts';
import type { AuditReport } from './audit.ts';
import type { CrawlProgress } from './crawl.ts';

/** Legacy location: reports written before crawls moved into SQLite. */
const LEGACY_DIR = path.join(process.cwd(), '.data', 'crawls');

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
 * In-flight jobs only. Next.js dev runs one server process, so this is shared
 * across requests; anything finished is in SQLite and survives a restart.
 */
const globalStore = globalThis as unknown as { __sitecheckerJobs?: Map<string, Job> };
const jobs: Map<string, Job> = globalStore.__sitecheckerJobs ??= new Map();

export function createJob(id: string, startUrl: string): Job {
  const job: Job = {
    id,
    startUrl,
    status: 'queued',
    progress: { phase: 'robots', crawled: 0, queued: 0, total: 0, currentUrl: null, message: 'Starting' },
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    report: null,
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function updateProgress(id: string, progress: CrawlProgress): void {
  const job = jobs.get(id);
  if (!job) return;
  job.progress = progress;
  job.status = progress.phase === 'done' ? 'done' : 'running';
}

export async function completeJob(id: string, report: AuditReport): Promise<void> {
  const job = jobs.get(id);
  if (job) {
    job.status = 'done';
    job.report = report;
    job.finishedAt = new Date().toISOString();
    job.progress = { ...job.progress, phase: 'done', message: 'Complete' };
  }
  saveReport(report);
}

export function failJob(id: string, error: string): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = 'error';
  job.error = error;
  job.finishedAt = new Date().toISOString();
  job.progress = { ...job.progress, phase: 'error', message: error };
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
export function saveSnapshots(crawlId: string, snapshots: PageSnapshot[]): {
  saved: number; rawBytes: number; gzipBytes: number;
} {
  let saved = 0, rawBytes = 0, gzipBytes = 0;
  const stmt = db().prepare(
    `INSERT INTO page_snapshots
       (crawl_id, url, url_key, gzipped, raw_bytes, gzip_bytes, rendered, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(crawl_id, url_key) DO NOTHING`,
  );

  const now = Date.now();
  for (const snap of snapshots) {
    if (!snap.html) continue;
    const raw = Buffer.byteLength(snap.html, 'utf8');
    if (raw > MAX_SNAPSHOT_BYTES) continue;
    try {
      const gz = gzipSync(Buffer.from(snap.html, 'utf8'), { level: 6 });
      stmt.run(
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
export function loadSnapshot(crawlId: string, url: string): StoredSnapshot | null {
  const row = get<{
    url: string; gzipped: Uint8Array; raw_bytes: number; gzip_bytes: number; rendered: number;
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

export function snapshotStats(crawlId: string): { count: number; rawBytes: number; gzipBytes: number } {
  const row = get<{ c: number; raw: number | null; gz: number | null }>(
    'SELECT COUNT(*) c, SUM(raw_bytes) raw, SUM(gzip_bytes) gz FROM page_snapshots WHERE crawl_id = ?',
    crawlId,
  );
  return { count: row?.c ?? 0, rawBytes: row?.raw ?? 0, gzipBytes: row?.gz ?? 0 };
}

export function hasSnapshot(crawlId: string, url: string): boolean {
  return !!get<{ id: number }>(
    'SELECT id FROM page_snapshots WHERE crawl_id = ? AND url_key = ?',
    crawlId, normalizeUrl(url),
  );
}

export function saveReport(report: AuditReport): void {
  const site = upsertSite(report.origin);
  run(
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
  const live = jobs.get(id)?.report;
  if (live) return live;

  const row = get<{ report_json: string }>('SELECT report_json FROM crawls WHERE id = ?', id);
  if (row) return JSON.parse(row.report_json) as AuditReport;

  // Fall back to a pre-SQLite report file, and migrate it on read.
  try {
    const raw = await fs.readFile(path.join(LEGACY_DIR, id + '.json'), 'utf8');
    const report = JSON.parse(raw) as AuditReport;
    saveReport(report);
    return report;
  } catch {
    return null;
  }
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
  await migrateLegacyReports();

  const rows = all<{
    id: string; origin: string; created_at: number; score: number;
    pages: number; checks_failed: number; is_next: number;
  }>(`SELECT c.id, s.origin, c.created_at, c.score, c.pages, c.checks_failed, c.is_next
      FROM crawls c JOIN sites s ON s.id = c.site_id
      ORDER BY c.created_at DESC`);

  return rows.map((r) => ({
    id: r.id,
    origin: r.origin,
    startUrl: r.origin,
    createdAt: new Date(r.created_at).toISOString(),
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
export function scoreHistory(siteId: number, limit = 60): ScorePoint[] {
  return all<ScorePoint>(
    `SELECT id, created_at, score, checks_failed, blockers, criticals, warnings
     FROM crawls WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
    siteId, limit,
  ).reverse();
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
export function crawlHistory(crawlId: string, limit = 40): CrawlHistoryPoint[] {
  const row = get<{ site_id: number }>('SELECT site_id FROM crawls WHERE id = ?', crawlId);
  if (!row) return [];
  return all<CrawlHistoryPoint>(
    `SELECT id, created_at, score, pages, checks_failed, blockers, criticals, warnings
     FROM crawls WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`,
    row.site_id, limit,
  ).reverse();
}

/** The crawl immediately preceding `crawlId` for the same site, if any. */
export function previousCrawlId(crawlId: string): string | null {
  const row = get<{ site_id: number; created_at: number }>(
    'SELECT site_id, created_at FROM crawls WHERE id = ?', crawlId,
  );
  if (!row) return null;
  const prev = get<{ id: string }>(
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
export function listProjects(): ProjectSummary[] {
  const sites = all<Site>('SELECT * FROM sites ORDER BY created_at DESC');
  return sites.map((s) => {
    const agg = get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM crawls WHERE site_id = ?', s.id);
    const first = get<{ score: number; created_at: number }>(
      'SELECT score, created_at FROM crawls WHERE site_id = ? ORDER BY created_at ASC LIMIT 1', s.id);
    const latest = get<{ id: string; score: number; created_at: number; checks_failed: number; is_next: number }>(
      'SELECT id, score, created_at, checks_failed, is_next FROM crawls WHERE site_id = ? ORDER BY created_at DESC LIMIT 1', s.id);
    return {
      siteId: s.id, origin: s.origin, label: s.label,
      crawlCount: agg?.cnt ?? 0,
      firstScore: first?.score ?? null, firstAt: first?.created_at ?? null,
      latestId: latest?.id ?? null, latestScore: latest?.score ?? null,
      latestAt: latest?.created_at ?? null, latestIssues: latest?.checks_failed ?? null,
      isNext: !!latest?.is_next,
    };
  });
}

/** Create (or find) a project for a website. Returns the site row. */
export function createProject(url: string, label?: string): Site {
  return upsertSite(url, label);
}

/** Every crawl for one project, oldest first — powers the trend graphs. */
export function projectCrawls(siteId: number, limit = 100): CrawlHistoryPoint[] {
  return all<CrawlHistoryPoint>(
    `SELECT id, created_at, score, pages, checks_failed, blockers, criticals, warnings
     FROM crawls WHERE site_id = ? ORDER BY created_at ASC LIMIT ?`,
    siteId, limit,
  );
}

/** Delete a project and everything under it (crawls, snapshots, keywords, backlinks, monitor). */
export async function deleteProject(siteId: number): Promise<void> {
  const ids = all<{ id: string }>('SELECT id FROM crawls WHERE site_id = ?', siteId);
  for (const { id } of ids) jobs.delete(id);
  run('DELETE FROM page_snapshots WHERE crawl_id IN (SELECT id FROM crawls WHERE site_id = ?)', siteId);
  run('DELETE FROM sites WHERE id = ?', siteId); // ON DELETE CASCADE clears the rest

  // Reports written before crawls moved into SQLite still sit on disk, and
  // migrateLegacyReports() re-imports anything missing from the database on the
  // next load — which would silently resurrect the project we just deleted.
  await Promise.all(ids.map(({ id }) =>
    fs.unlink(path.join(LEGACY_DIR, id + '.json')).catch(() => { /* already gone */ })));
}

export async function deleteReport(id: string): Promise<void> {
  jobs.delete(id);
  // Remove the on-disk copy too, otherwise the legacy import re-adds it.
  await fs.unlink(path.join(LEGACY_DIR, id + '.json')).catch(() => { /* already gone */ });
  // ON DELETE CASCADE covers this, but foreign keys are a PRAGMA that a future
  // connection could open without — deleting explicitly keeps it correct either way.
  run('DELETE FROM page_snapshots WHERE crawl_id = ?', id);
  run('DELETE FROM crawls WHERE id = ?', id);
}

/** One-time import of reports written before crawls moved into SQLite. */
async function migrateLegacyReports(): Promise<void> {
  let files: string[];
  try {
    files = await fs.readdir(LEGACY_DIR);
  } catch {
    return; // no legacy directory
  }

  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (get<{ id: string }>('SELECT id FROM crawls WHERE id = ?', id)) continue;
    try {
      const report = JSON.parse(await fs.readFile(path.join(LEGACY_DIR, f), 'utf8')) as AuditReport;
      saveReport(report);
    } catch { /* skip unreadable file */ }
  }
}
