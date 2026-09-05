/**
 * Postgres connection and migration runner (Vercel Postgres / Neon).
 *
 * Every module — crawls, monitoring, ranks, backlinks, GSC/GA4 caches, content
 * grades — reads and writes through the same pool, so one connection string is
 * the entire persistence configuration.
 *
 * `all`/`get`/`run` accept SQLite-style `?` placeholders (in order) so the 300+
 * call sites across the codebase did not need individually renumbered `$1, $2…`
 * params; the conversion happens once, here.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool, type PoolClient } from 'pg';
import { MIGRATIONS } from './schema.ts';

const conn = (): string | undefined =>
  process.env['POSTGRES_URL']
  ?? process.env['DATABASE_URL']
  ?? process.env['POSTGRES_URL_NON_POOLING'];

/**
 * Is a database configured at all?
 *
 * Read at call time, never captured at module load: on Vercel the module can
 * be evaluated while building a static shell, long before the deployment's
 * environment variables are the ones that matter at request time.
 */
export function dbConfigured(): boolean {
  return !!conn()?.trim();
}

export const DB_NOT_CONFIGURED =
  'No database configured. Set POSTGRES_URL (or DATABASE_URL) — the connection '
  + 'string Vercel Postgres gives you when you add the integration.';

/**
 * Hosted Postgres (Neon, Supabase, RDS…) requires TLS; a local one usually has
 * none. Connection strings from Vercel already carry `sslmode=require`, and
 * where they do the driver's own parsing wins — this only fills in the gap for
 * a bare `postgres://user:pass@host/db` pointed at something remote, which
 * would otherwise fail the handshake with a bewildering error.
 */
function sslFor(connectionString: string): { rejectUnauthorized: boolean } | undefined {
  if (/[?&]sslmode=/i.test(connectionString)) return undefined;
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/i.test(connectionString);
  return local ? undefined : { rejectUnauthorized: true };
}

const g = globalThis as unknown as { __sitecheckerPool?: Pool; __sitecheckerMigrated?: Promise<void> };

/**
 * One pool per process, pinned to globalThis so Next.js dev HMR reuses it
 * instead of opening a new connection set on every hot reload. `max` is kept
 * small because each serverless invocation is its own process — Vercel
 * Postgres' pooled connection string (PgBouncer) is what absorbs the fan-out
 * across concurrently-running functions, not this pool.
 */
function pool(): Pool {
  if (g.__sitecheckerPool) return g.__sitecheckerPool;
  const connectionString = conn()?.trim();
  if (!connectionString) throw new Error(DB_NOT_CONFIGURED);

  const ssl = sslFor(connectionString);
  const p = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    // Never let a wedged connection hold a serverless invocation open until
    // the platform kills it — fail fast enough to render a real error page.
    connectionTimeoutMillis: 10_000,
    ...(ssl ? { ssl } : {}),
  });
  // A pool that emits 'error' with no listener takes the process down with it,
  // and an idle backend being closed by the provider is routine, not fatal.
  p.on('error', () => { /* the next query re-connects */ });
  g.__sitecheckerPool = p;
  return p;
}

// ---------------------------------------------------------------------------
// Transactions
//
// A pooled connection may serve a different physical client per query, but
// BEGIN/COMMIT must stay on one. AsyncLocalStorage carries the checked-out
// client through the async call tree so nested all()/get()/run() calls inside
// tx(fn) transparently reuse it instead of the pool.
// ---------------------------------------------------------------------------

const txContext = new AsyncLocalStorage<PoolClient>();

interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }>;
}

function client(): Queryable {
  return txContext.getStore() ?? pool();
}

/** Run a unit of work inside a single transaction on one dedicated connection. */
export async function tx<T>(fn: () => Promise<T> | T): Promise<T> {
  const existing = txContext.getStore();
  if (existing) return fn(); // already inside a transaction — reuse it, no nested BEGIN

  const c = await pool().connect();
  try {
    await c.query('BEGIN');
    const out = await txContext.run(c, fn);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    try { await c.query('ROLLBACK'); } catch { /* connection may already be dead */ }
    throw err;
  } finally {
    c.release();
  }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

let migrated: Promise<void> | null = null;

/** Run every migration that has not yet been applied. Safe to call repeatedly. */
export function ensureMigrated(): Promise<void> {
  if (g.__sitecheckerMigrated) return g.__sitecheckerMigrated;
  if (migrated) return migrated;

  migrated = (async () => {
    const p = pool();
    await p.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER NOT NULL);
      INSERT INTO schema_migrations (version)
        SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM schema_migrations);
    `);
    const { rows } = await p.query('SELECT version FROM schema_migrations LIMIT 1');
    const current = (rows[0] as { version: number } | undefined)?.version ?? 0;

    for (let i = current; i < MIGRATIONS.length; i++) {
      const c = await p.connect();
      try {
        await c.query('BEGIN');
        await c.query(MIGRATIONS[i]!);
        await c.query('UPDATE schema_migrations SET version = $1', [i + 1]);
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${i + 1} failed: ${(err as Error).message}`);
      } finally {
        c.release();
      }
    }
  })();
  g.__sitecheckerMigrated = migrated;
  return migrated;
}

// ---------------------------------------------------------------------------
// `?` -> `$1, $2, …` — every call site below keeps writing SQLite-style SQL.
// ---------------------------------------------------------------------------

function toPositional(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

/** True when the statement already asks for a RETURNING clause. */
const hasReturning = (sql: string): boolean => /\breturning\b/i.test(sql);

// ---------------------------------------------------------------------------
// Typed helpers. Every query call ensures migrations have run first, so a
// cold serverless invocation is never queried against an unmigrated schema.
// ---------------------------------------------------------------------------

export async function all<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  await ensureMigrated();
  const res = await client().query(toPositional(sql), params);
  return res.rows as T[];
}

export async function get<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  await ensureMigrated();
  const res = await client().query(toPositional(sql), params);
  return (res.rows[0] as T | undefined) ?? undefined;
}

export interface RunResult { changes: number; lastInsertRowid: number }

/**
 * INSERT/UPDATE/DELETE. When the statement is an INSERT that already carries
 * `RETURNING id`, the new row's id comes back as `lastInsertRowid` — the same
 * shape `node:sqlite`'s `.run()` returned, so callers were not touched.
 */
export async function run(sql: string, ...params: unknown[]): Promise<RunResult> {
  await ensureMigrated();
  const positional = toPositional(sql);
  const res = await client().query(positional, params);
  const row = hasReturning(sql) ? (res.rows[0] as { id?: number } | undefined) : undefined;
  return { changes: res.rowCount ?? 0, lastInsertRowid: row?.id ?? 0 };
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

export async function upsertSite(url: string, label?: string): Promise<Site> {
  const origin = toOrigin(url);
  const existing = await get<Site>('SELECT * FROM sites WHERE origin = ?', origin);
  if (existing) {
    if (label && label !== existing.label) {
      await run('UPDATE sites SET label = ? WHERE id = ?', label, existing.id);
      return { ...existing, label };
    }
    return existing;
  }
  const { lastInsertRowid } = await run(
    'INSERT INTO sites (origin, label, created_at) VALUES (?, ?, ?) RETURNING id',
    origin, label ?? null, Date.now(),
  );
  return { id: lastInsertRowid, origin, label: label ?? null, created_at: Date.now() };
}

export async function listSites(): Promise<Site[]> {
  return all<Site>('SELECT * FROM sites ORDER BY origin');
}

export async function getSite(id: number): Promise<Site | undefined> {
  return get<Site>('SELECT * FROM sites WHERE id = ?', id);
}

export async function findSite(url: string): Promise<Site | undefined> {
  return get<Site>('SELECT * FROM sites WHERE origin = ?', toOrigin(url));
}

/** Approximate storage footprint, shown in the UI so growth is visible. */
export async function dbStats(): Promise<{ path: string; bytes: number; tables: Record<string, number> }> {
  await ensureMigrated();
  const size = await get<{ bytes: string }>('SELECT pg_database_size(current_database()) AS bytes');
  const tables: Record<string, number> = {};
  for (const t of ['sites', 'monitor_checks', 'incidents', 'alerts', 'keywords',
    'rank_snapshots', 'backlinks', 'backlink_checks', 'crawls']) {
    tables[t] = (await get<{ c: number }>(`SELECT COUNT(*)::int c FROM ${t}`))?.c ?? 0;
  }
  return { path: 'Postgres', bytes: Number(size?.bytes ?? 0), tables };
}

/** Closes the pool. Call at the end of one-shot scripts (cron entry points) so the process can exit. */
export async function closePool(): Promise<void> {
  if (g.__sitecheckerPool) {
    await g.__sitecheckerPool.end();
    g.__sitecheckerPool = undefined;
  }
}
