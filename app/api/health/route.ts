import { NextResponse } from 'next/server';
import { dbConfigured, ensureMigrated, get } from '@/src/db/index.ts';

/**
 * What can this deployment actually reach?
 *
 * Exists because the alternative, when something is misconfigured in
 * production, is reading a redacted 500 with a digest and guessing. This
 * answers the only three questions worth asking — is a database configured,
 * can we connect to it, and did the schema get created — without exposing the
 * connection string or anything else sensitive.
 */
export async function GET() {
  const configured = dbConfigured();
  if (!configured) {
    return NextResponse.json(
      {
        ok: false,
        database: { configured: false, reachable: false },
        hint: 'Set POSTGRES_URL. On Vercel: Storage → Create Database → Postgres, then redeploy.',
      },
      { status: 503 },
    );
  }

  try {
    await ensureMigrated();
    const row = await get<{ version: number }>('SELECT version FROM schema_migrations LIMIT 1');
    const sites = await get<{ c: number }>('SELECT COUNT(*)::int c FROM sites');
    return NextResponse.json({
      ok: true,
      database: {
        configured: true,
        reachable: true,
        schemaVersion: row?.version ?? 0,
        sites: sites?.c ?? 0,
      },
    });
  } catch (err) {
    // The message can name a host, but never credentials — pg keeps those out
    // of its connection errors.
    const message = (err as Error).message;
    return NextResponse.json(
      {
        ok: false,
        database: { configured: true, reachable: false, error: message },
        hint: hintFor(message),
      },
      { status: 503 },
    );
  }
}

/**
 * Turn the driver's message into the thing to actually go and change.
 *
 * "too many connections" in particular is not a bad connection string, and
 * telling someone to check the value sends them to the wrong place: it means
 * the app is pointed at a direct endpoint instead of the pooled one, or that
 * something is fanning out more invocations than the database allows.
 */
function hintFor(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('too many connections')) {
    return 'The database is refusing new connections, not rejecting your credentials. '
      + 'Use the pooled connection string (its host contains "-pooler") as POSTGRES_URL — '
      + 'a direct endpoint allows only a handful of connections, and every serverless '
      + 'invocation opens its own.';
  }
  if (m.includes('password') || m.includes('authentication')) {
    return 'The credentials in POSTGRES_URL were rejected. Re-copy it from the database provider.';
  }
  if (m.includes('enotfound') || m.includes('econnrefused') || m.includes('timeout')) {
    return 'The host in POSTGRES_URL could not be reached. Check the database still exists and is not suspended.';
  }
  return 'The connection string is set but the database refused it. Check the value, and that the database still exists.';
}
