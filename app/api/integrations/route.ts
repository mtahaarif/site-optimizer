import { NextResponse } from 'next/server';
import { dbConfigured, DB_NOT_CONFIGURED } from '@/src/db/index.ts';
import { resetTokenCache } from '@/src/core/gsc/auth.ts';
import {
  allIntegrationStatuses, deleteIntegration, integrationStatus, isProvider,
  normalizePropertyId, readIntegration, reusableServiceAccount, saveIntegration,
  type Provider,
} from '@/src/core/integrations/store.ts';
import {
  verifyGa4Access, verifyGscAccess, verifyPagespeedKey,
} from '@/src/core/integrations/verify.ts';

/**
 * Connecting and disconnecting the accounts this tool reads from.
 *
 * Two rules hold across every handler here:
 *
 *  1. Nothing is stored until Google has confirmed it works. A credential that
 *     is saved and *then* discovered to be wrong turns setup into a debugging
 *     session, and the errors Google returns at connect time are far better
 *     than the ones an audit surfaces an hour later.
 *  2. No response ever contains a secret. The status shape carries the service
 *     account's email and the property it points at, which is what "which
 *     account is this?" actually means, and nothing that could be replayed.
 *
 * Note that this app ships no authentication of its own, so on a public
 * deployment these routes are as reachable as every other one. Put the
 * deployment behind access protection before pointing it at a client's
 * property — that is the boundary, not this file.
 */

/**
 * GET — the state of all three connections.
 *
 * Works without a database: environment-provided credentials still resolve,
 * they just report `storable: false` because there is nowhere to save a change.
 */
export async function GET() {
  return NextResponse.json({ integrations: await allIntegrationStatuses() });
}

interface Body {
  provider?: unknown;
  serviceAccountJson?: unknown;
  siteUrl?: unknown;
  propertyId?: unknown;
  propertyLabel?: unknown;
  apiKey?: unknown;
  /**
   * Which key to connect with. Explicit rather than inferred from whether a
   * paste is present, because the three cases genuinely differ: connecting a
   * new account, adopting the one the other Google integration already uses,
   * and re-picking a property while keeping the account this one is on.
   */
  accountSource?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** POST — verify a credential and, only then, store it. */
export async function POST(req: Request) {
  let body: Body;
  try { body = await req.json() as Body; }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const provider = body.provider;
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown integration.' }, { status: 400 });
  }
  if (!dbConfigured()) {
    return NextResponse.json({ error: DB_NOT_CONFIGURED }, { status: 503 });
  }

  try {
    const result = provider === 'pagespeed'
      ? await connectPagespeed(body)
      : await connectGoogle(provider, body);

    if ('error' in result) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    // A cached token belongs to the account that minted it. Switching accounts
    // without clearing it would keep querying as the old one until it expired.
    resetTokenCache();
    return NextResponse.json({ integration: await integrationStatus(provider) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Resolve the key to connect with.
 *
 * `reuse` is what makes "same service account as Search Console" one click
 * rather than a second 2 KB paste; `existing` is what makes re-picking a
 * property not require finding the JSON file again.
 */
export type AccountSource = 'pasted' | 'reuse' | 'existing';

async function serviceAccountFor(provider: Provider, body: Body): Promise<string | null> {
  const pasted = str(body.serviceAccountJson);
  const source: AccountSource = body.accountSource === 'reuse' ? 'reuse'
    : body.accountSource === 'existing' ? 'existing'
      : pasted ? 'pasted' : 'existing';

  if (source === 'pasted') return pasted || null;

  if (source === 'reuse') {
    const other = await reusableServiceAccount(provider);
    if (other) return other.json;
  }
  const own = await readIntegration(provider);
  return own?.config['serviceAccountJson'] ?? null;
}

async function connectGoogle(
  provider: 'gsc' | 'ga4', body: Body,
): Promise<{ ok: true } | { error: string }> {
  const json = await serviceAccountFor(provider, body);
  if (!json) return { error: 'Paste the service-account JSON key file.' };

  if (provider === 'gsc') {
    const siteUrl = str(body.siteUrl);
    if (!siteUrl) return { error: 'Choose which Search Console property to connect.' };

    const check = await verifyGscAccess(json, siteUrl);
    if (!check.ok) return { error: check.error };

    await saveIntegration('gsc',
      { serviceAccountJson: json, siteUrl },
      { account: check.value.account, label: siteUrl });
    return { ok: true };
  }

  const propertyId = normalizePropertyId(str(body.propertyId));
  if (!propertyId) return { error: 'Choose which Analytics property to connect.' };
  if (/^G-/i.test(propertyId)) {
    return { error: 'That is a measurement id. The Data API needs the numeric property number, '
      + 'shown in Analytics under Admin → Property details.' };
  }

  const check = await verifyGa4Access(json, propertyId);
  if (!check.ok) return { error: check.error };

  await saveIntegration('ga4',
    { serviceAccountJson: json, propertyId },
    { account: check.value.account, label: str(body.propertyLabel) || `Property ${propertyId}` });
  return { ok: true };
}

async function connectPagespeed(body: Body): Promise<{ ok: true } | { error: string }> {
  const check = await verifyPagespeedKey(str(body.apiKey));
  if (!check.ok) return { error: check.error };
  await saveIntegration('pagespeed', { apiKey: check.value.key }, { label: 'API key' });
  return { ok: true };
}

/** DELETE ?provider=gsc — disconnect. */
export async function DELETE(req: Request) {
  const provider = new URL(req.url).searchParams.get('provider');
  if (!isProvider(provider)) {
    return NextResponse.json({ error: 'Unknown integration.' }, { status: 400 });
  }

  await deleteIntegration(provider);
  resetTokenCache();

  const status = await integrationStatus(provider);
  return NextResponse.json({
    integration: status,
    // Disconnecting a row can uncover an environment variable underneath it,
    // which would otherwise look like the disconnect silently failed.
    note: status.connected
      ? `Disconnected. ${status.name} is still configured by an environment variable on this `
        + 'deployment, so it stays connected until that variable is removed.'
      : null,
  });
}
