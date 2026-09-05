/**
 * Google service-account authentication.
 *
 * Extracted from src/backlinks/gsc.ts so the backlink seeder and the Search
 * Analytics client share one implementation rather than two that can drift.
 *
 * The JWT is signed with node:crypto and exchanged directly. The googleapis
 * package is ~50 MB for what amounts to one signed assertion and one POST, and
 * pulling it in would end the project's zero-dependency posture for no benefit.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export const WEBMASTERS_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

export function loadCredentials(): ServiceAccount | null {
  const inline = process.env['GOOGLE_SERVICE_ACCOUNT_JSON'];
  const file = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  try {
    const raw = inline ?? (file ? readFileSync(file, 'utf8') : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    // Env vars carry \n as two characters; PEM parsing needs real newlines.
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch {
    return null;
  }
}

/** The Search Console property, exactly as the console displays it. */
export function gscSiteUrl(): string | null {
  const v = process.env['GSC_SITE_URL']?.trim();
  return v ? v : null;
}

export function gscConfigured(): boolean {
  return loadCredentials() !== null && gscSiteUrl() !== null;
}

// A token is valid for an hour; re-minting one per request would add a network
// round trip to every call in a batch for no reason.
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(scope = WEBMASTERS_SCOPE): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) return cachedToken.token;

  const creds = loadCredentials();
  if (!creds) throw new Error('No Google service account credentials configured');

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({
    iss: creds.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  });

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(creds.private_key, 'base64url');

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

  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
  return cachedToken.token;
}

/** Drop the cached token. Used by tests and after a credential change. */
export function resetTokenCache(): void {
  cachedToken = null;
}

export async function verifyAccess(): Promise<{ ok: boolean; siteUrl: string | null; error: string | null }> {
  const siteUrl = gscSiteUrl();
  if (!siteUrl) return { ok: false, siteUrl: null, error: 'GSC_SITE_URL not set' };
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
