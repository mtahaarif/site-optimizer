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
    return NextResponse.json(
      {
        ok: false,
        database: { configured: true, reachable: false, error: (err as Error).message },
        hint: 'The connection string is set but the database refused it. Check the value, and that the database still exists.',
      },
      { status: 503 },
    );
  }
}
