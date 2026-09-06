/**
 * Google service-account authentication.
 *
 * Extracted from src/backlinks/gsc.ts so the backlink seeder and the Search
 * Analytics client share one implementation rather than two that can drift.
 *
 * The JWT is signed with node:crypto and exchanged directly. The googleapis
 * package is ~50 MB for what amounts to one signed assertion and one POST, and
 * pulling it in would end the project's zero-dependency posture for no benefit.
 *
 * Credentials come from the connected-accounts store, which falls back to the
 * environment. Every accessor here is therefore async: the answer to "is Search
 * Console connected" now involves a row lookup, and a synchronous stale copy
 * would mean a disconnect in the UI not taking effect until a restart.
 */
import { createSign } from 'node:crypto';
import { gscSettings } from '../integrations/store.ts';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export const WEBMASTERS_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** Parse a service-account key file. Returns null for anything unusable. */
export function parseServiceAccount(raw: string): ServiceAccount | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    // A key pasted through an env var carries \n as two characters; PEM parsing
    // needs real newlines.
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch {
    return null;
  }
}

/** The service account Search Console is connected with. */
export async function loadCredentials(): Promise<ServiceAccount | null> {
  const settings = await gscSettings();
  return settings ? parseServiceAccount(settings.serviceAccountJson) : null;
}

/** The Search Console property, exactly as the console displays it. */
export async function gscSiteUrl(): Promise<string | null> {
  return (await gscSettings())?.siteUrl ?? null;
}

export async function gscConfigured(): Promise<boolean> {
  return (await loadCredentials()) !== null && (await gscSiteUrl()) !== null;
}

// ---------------------------------------------------------------------------
// Token cache
//
// A token is valid for an hour; re-minting one per request would add a network
// round trip to every call in a batch for no reason. The cache is keyed by
// account *and* scope: one slot was a latent bug, because an audit fetches
// Search Console (webmasters scope) and then Analytics (analytics scope) inside
// the same process, and the second call would be handed the first one's token
// and get a 403 it could not explain. Switching to a different account makes
// the same mistake possible, so both go in the key.
// ---------------------------------------------------------------------------

const tokens = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(
  scope = WEBMASTERS_SCOPE,
  creds?: ServiceAccount | null,
): Promise<string> {
  const account = creds ?? await loadCredentials();
  if (!account) throw new Error('No Google service account credentials configured');

  const cacheKey = `${account.client_email}|${scope}`;
  const cached = tokens.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.token;

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({
    iss: account.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  });

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(account.private_key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claims}.${signature}`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json() as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Google token response contained no access_token');

  const entry = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  tokens.set(cacheKey, entry);
  return entry.token;
}

/** Drop cached tokens. Used by tests and after disconnecting an account. */
export function resetTokenCache(): void {
  tokens.clear();
}

export async function verifyAccess(): Promise<{ ok: boolean; siteUrl: string | null; error: string | null }> {
  const settings = await gscSettings();
  if (!settings) {
    return { ok: false, siteUrl: null, error: 'Search Console is not connected.' };
  }
  const { siteUrl } = settings;
  try {
    const token = await getAccessToken();
    const res = await fetch(
      'https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(siteUrl),
      { headers: { authorization: 'Bearer ' + token } },
    );
    if (!res.ok) {
      return { ok: false, siteUrl, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
    }
    return { ok: true, siteUrl, error: null };
  } catch (err) {
    return { ok: false, siteUrl, error: (err as Error).message };
  }
}
