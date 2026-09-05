/**
 * SQLite connection and migration runner.
 *
 * `node:sqlite` ships with Node, so this is the entire database dependency:
 * no build step, no daemon, no connection string. The file lives at
 * .data/sitechecker.db and is the single source of truth for every module.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './schema.ts';

export type DB = DatabaseSync;

export const DB_PATH = process.env['SITECHECKER_DB']
  ?? path.join(process.cwd(), '.data', 'sitechecker.db');

const g = globalThis as unknown as { __sitecheckerDb?: DatabaseSync };

/**
 * Open (once) and migrate the database.
 *
 * The handle is pinned to globalThis so Next.js dev HMR reuses one connection
 * instead of opening a new file handle on every hot reload.
 */
export function db(): DatabaseSync {
  if (g.__sitecheckerDb) return g.__sitecheckerDb;

  mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const conn = new DatabaseSync(DB_PATH);

  // WAL lets the dashboard read while a cron job writes — the two processes
  // touch the same file and would otherwise block each other.
  conn.exec('PRAGMA journal_mode = WAL');
  conn.exec('PRAGMA foreign_keys = ON');
  conn.exec('PRAGMA busy_timeout = 5000');

  migrate(conn);
  g.__sitecheckerDb = conn;
  return conn;
}

function migrate(conn: DatabaseSync): void {
  const row = conn.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  const current = row?.user_version ?? 0;

  for (let i = current; i < MIGRATIONS.length; i++) {
    conn.exec('BEGIN');
    try {
      conn.exec(MIGRATIONS[i]!);
      conn.exec(`PRAGMA user_version = ${i + 1}`);
      conn.exec('COMMIT');
    } catch (err) {
      conn.exec('ROLLBACK');
      throw new Error(`Migration ${i + 1} failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Fold the write-ahead log back into the main database file and close.
 *
 * The checkpoint is not optional housekeeping. In WAL mode recent writes live
 * in `sitechecker.db-wal` until a checkpoint moves them into `sitechecker.db`,
 * so a scheduled job that exits without checkpointing leaves its results out of
 * the main file — and the GitHub Actions workflow, which commits only the `.db`,
 * would silently persist nothing. TRUNCATE also removes the sidecar files, so a
 * cleanly exited process leaves exactly one file on disk.
 */
export function closeDb(): void {
  if (!g.__sitecheckerDb) return;
  try { g.__sitecheckerDb.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* nothing to fold */ }
  try { g.__sitecheckerDb.close(); } catch { /* already closed */ }
  g.__sitecheckerDb = undefined;
}

/** Force a checkpoint without closing — used before reading the file externally. */
export function checkpoint(): void {
  try { db().exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Small typed helpers. node:sqlite returns null-prototype objects, so results
// are spread into plain objects before crossing into React.
// ---------------------------------------------------------------------------

export function all<T>(sql: string, ...params: unknown[]): T[] {
  const rows = db().prepare(sql).all(...params as never[]) as unknown[];
  return rows.map((r) => ({ ...(r as object) })) as T[];
}

export function get<T>(sql: string, ...params: unknown[]): T | undefined {
  const row = db().prepare(sql).get(...params as never[]);
  return row ? ({ ...(row as object) } as T) : undefined;
}

export function run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number } {
  const r = db().prepare(sql).run(...params as never[]);
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
}

/** Wrap a unit of work in a transaction. */
export function tx<T>(fn: () => T): T {
  const conn = db();
  conn.exec('BEGIN');
  try {
    const out = fn();
    conn.exec('COMMIT');
    return out;
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sites — every module hangs off a site row
// ---------------------------------------------------------------------------

export interface Site {
  id: number;
  origin: string;
  label: string | null;
  created_at: number;
}

/** Normalise any URL to its origin, which is the site identity everywhere. */
export function toOrigin(url: string): string {
  const u = new URL(url.includes('://') ? url : 'https://' + url);
  return u.origin;
}

export function upsertSite(url: string, label?: string): Site {
  const origin = toOrigin(url);
  const existing = get<Site>('SELECT * FROM sites WHERE origin = ?', origin);
  if (existing) {
    if (label && label !== existing.label) {
      run('UPDATE sites SET label = ? WHERE id = ?', label, existing.id);
      return { ...existing, label };
    }
    return existing;
  }
  const { lastInsertRowid } = run(
    'INSERT INTO sites (origin, label, created_at) VALUES (?, ?, ?)',
    origin, label ?? null, Date.now(),
  );
  return { id: lastInsertRowid, origin, label: label ?? null, created_at: Date.now() };
}

export function listSites(): Site[] {
  return all<Site>('SELECT * FROM sites ORDER BY origin');
}

export function getSite(id: number): Site | undefined {
  return get<Site>('SELECT * FROM sites WHERE id = ?', id);
}

export function findSite(url: string): Site | undefined {
  return get<Site>('SELECT * FROM sites WHERE origin = ?', toOrigin(url));
}

/** Rough on-disk size, shown in the UI so growth is visible. */
export function dbStats(): { path: string; bytes: number; tables: Record<string, number> } {
  // PRAGMA results come back keyed by the pragma name, not a positional alias.
  const pageCount = get<Record<string, number>>('PRAGMA page_count')?.['page_count'] ?? 0;
  const pageSize = get<Record<string, number>>('PRAGMA page_size')?.['page_size'] ?? 0;
  const tables: Record<string, number> = {};
  for (const t of ['sites', 'monitor_checks', 'incidents', 'alerts', 'keywords',
    'rank_snapshots', 'backlinks', 'backlink_checks', 'crawls']) {
    tables[t] = get<{ c: number }>(`SELECT COUNT(*) c FROM ${t}`)?.c ?? 0;
  }
  return { path: DB_PATH, bytes: pageCount * pageSize, tables };
}
