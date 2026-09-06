/**
 * Connected accounts — Search Console, Google Analytics, PageSpeed Insights.
 *
 * Every one of these used to be an environment variable, which made connecting
 * an account a deploy and switching to a different one a second deploy. They
 * are now rows: connect in the UI, disconnect in the UI, connect a different
 * account in the UI, all effective on the next request.
 *
 * Environment variables are still read, as a fallback, so an existing
 * deployment or a cron script keeps working untouched. A connected row always
 * wins over the environment — connecting in the UI is the more specific and
 * more recent statement of intent, and letting the env silently override it
 * would make the disconnect button a lie.
 *
 * Reads never throw. A missing database, an unreachable one, or a row sealed
 * with a secret that has since changed all resolve to "not connected", because
 * every caller here is asking a question whose worst honest answer is "no" — an
 * audit degrades to "no traffic data" rather than failing outright.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dbConfigured, get, run } from '../../db/index.ts';

export type Provider = 'gsc' | 'ga4' | 'pagespeed';

export const PROVIDERS: readonly Provider[] = ['gsc', 'ga4', 'pagespeed'] as const;

export const PROVIDER_NAME: Record<Provider, string> = {
  gsc: 'Google Search Console',
  ga4: 'Google Analytics',
  pagespeed: 'PageSpeed Insights',
};

export function isProvider(v: unknown): v is Provider {
  return typeof v === 'string' && (PROVIDERS as readonly string[]).includes(v);
}

/** Where a credential came from. An `environment` one has no row to disconnect. */
export type Source = 'connected' | 'environment';

export interface IntegrationRecord {
  provider: Provider;
  /** Secrets. Never send this to the browser. */
  config: Record<string, string>;
  account: string | null;
  label: string | null;
  connectedAt: number;
  verifiedAt: number | null;
  lastError: string | null;
}

/**
 * Ignore stored connections and read only the environment.
 *
 * Two uses. The verification scripts set it so a developer's real connected
 * accounts neither shadow a fixture nor get clobbered by one — the alternative
 * was a test that deletes rows someone actually depends on. And a one-off
 * script gets a way to run against an explicitly named property without that
 * choice leaking into what the UI shows as connected.
 */
export function envOnly(): boolean {
  const v = process.env['INTEGRATIONS_ENV_ONLY']?.trim().toLowerCase();
  return v === '1' || v === 'true';
}

// ---------------------------------------------------------------------------
// Encryption at rest
//
// A service-account private key in a database column is a credential sitting in
// whatever backups, replicas and log exports that database has. Setting
// INTEGRATIONS_SECRET encrypts it; leaving it unset stores plaintext, which is
// the right default for a local Postgres and worth knowing about on a hosted
// one. The UI says which of the two is in effect rather than implying a
// protection it does not have.
// ---------------------------------------------------------------------------

const PREFIX = 'enc:v1:';

const secret = (): string | null => process.env['INTEGRATIONS_SECRET']?.trim() || null;

/** True when values written from now on will be encrypted. */
export function encryptionEnabled(): boolean {
  return secret() !== null;
}

const keyFrom = (s: string): Buffer => createHash('sha256').update(s).digest();

function seal(plain: string): string {
  const s = secret();
  if (!s) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(s), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}

/** Throws when the row is encrypted and the secret is missing or has changed. */
function unseal(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const s = secret();
  if (!s) {
    throw new Error('This account was saved encrypted, but INTEGRATIONS_SECRET is not set. '
      + 'Restore the secret, or disconnect and connect the account again.');
  }
  const raw = Buffer.from(stored.slice(PREFIX.length), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(s), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

interface Row {
  provider: string;
  config: string;
  account: string | null;
  label: string | null;
  connected_at: string | number;
  verified_at: string | number | null;
  last_error: string | null;
}

/** BIGINT comes back from pg as a string. */
const num = (v: string | number | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function readIntegration(provider: Provider): Promise<IntegrationRecord | null> {
  if (envOnly() || !dbConfigured()) return null;
  try {
    const row = await get<Row>('SELECT * FROM integrations WHERE provider = ?', provider);
    if (!row) return null;
    return {
      provider,
      config: JSON.parse(unseal(row.config)) as Record<string, string>,
      account: row.account,
      label: row.label,
      connectedAt: num(row.connected_at) ?? 0,
      verifiedAt: num(row.verified_at),
      lastError: row.last_error,
    };
  } catch {
    return null;
  }
}

export async function saveIntegration(
  provider: Provider,
  config: Record<string, string>,
  meta: { account?: string | null; label?: string | null } = {},
): Promise<void> {
  const now = Date.now();
  await run(
    `INSERT INTO integrations (provider, config, account, label, connected_at, verified_at, last_error)
     VALUES (?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT (provider) DO UPDATE SET
       config = excluded.config, account = excluded.account, label = excluded.label,
       connected_at = excluded.connected_at, verified_at = excluded.verified_at,
       last_error = NULL`,
    provider, seal(JSON.stringify(config)), meta.account ?? null, meta.label ?? null, now, now,
  );
}

export async function deleteIntegration(provider: Provider): Promise<void> {
  if (!dbConfigured()) return;
  await run('DELETE FROM integrations WHERE provider = ?', provider);
}

/**
 * Record why a live call failed, so the card can say so without the user having
 * to run an audit to find out.
 *
 * Guarded on the error actually having changed, because the caller is a page
 * that renders on every load and an unguarded UPDATE would be a write per
 * render to say nothing new. Best-effort besides: failing to write the failure
 * is not worth propagating over the failure itself.
 */
export async function noteIntegrationError(provider: Provider, error: string | null): Promise<void> {
  if (!dbConfigured()) return;
  try {
    if (error) {
      await run(
        `UPDATE integrations SET last_error = ?
         WHERE provider = ? AND last_error IS DISTINCT FROM ?`,
        error, provider, error,
      );
    } else {
      // Recovering from a failure is worth re-stamping; a run that was already
      // healthy is not.
      await run(
        `UPDATE integrations SET last_error = NULL, verified_at = ?
         WHERE provider = ? AND last_error IS NOT NULL`,
        Date.now(), provider,
      );
    }
  } catch { /* the next request will try again */ }
}

// ---------------------------------------------------------------------------
// Environment fallback
// ---------------------------------------------------------------------------

/** The service-account JSON from the environment, inline or from a key file. */
function envServiceAccountJson(): string | null {
  const inline = process.env['GOOGLE_SERVICE_ACCOUNT_JSON']?.trim()
    || process.env['GOOGLE_SERVICE_ACCOUNT_KEY']?.trim();
  if (inline) return inline;
  const file = process.env['GOOGLE_APPLICATION_CREDENTIALS']?.trim();
  if (!file) return null;
  try { return readFileSync(file, 'utf8'); } catch { return null; }
}

/** The email inside a service-account JSON, for display. Never throws. */
export function accountEmailOf(json: string): string | null {
  try {
    const parsed = JSON.parse(json) as { client_email?: string };
    return parsed.client_email ?? null;
  } catch { return null; }
}

/** GA4 accepts "properties/123456" and a bare id; everything downstream wants the bare id. */
export function normalizePropertyId(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  const id = s.replace(/^properties\//, '');
  return id || null;
}

// ---------------------------------------------------------------------------
// Resolution — what every caller actually asks for
// ---------------------------------------------------------------------------

export interface GscSettings {
  serviceAccountJson: string;
  siteUrl: string;
  account: string | null;
  source: Source;
}

export interface Ga4Settings {
  serviceAccountJson: string;
  propertyId: string;
  account: string | null;
  source: Source;
}

export interface PagespeedSettings {
  apiKey: string;
  source: Source;
}

export async function gscSettings(): Promise<GscSettings | null> {
  const row = await readIntegration('gsc');
  const json = row?.config['serviceAccountJson'];
  const siteUrl = row?.config['siteUrl']?.trim();
  if (json && siteUrl) {
    return { serviceAccountJson: json, siteUrl, account: row?.account ?? null, source: 'connected' };
  }

  const envJson = envServiceAccountJson();
  const envSite = process.env['GSC_SITE_URL']?.trim();
  if (envJson && envSite) {
    return {
      serviceAccountJson: envJson, siteUrl: envSite,
      account: accountEmailOf(envJson), source: 'environment',
    };
  }
  return null;
}

export async function ga4Settings(): Promise<Ga4Settings | null> {
  const row = await readIntegration('ga4');
  const json = row?.config['serviceAccountJson'];
  const propertyId = normalizePropertyId(row?.config['propertyId']);
  if (json && propertyId) {
    return { serviceAccountJson: json, propertyId, account: row?.account ?? null, source: 'connected' };
  }

  const envJson = envServiceAccountJson();
  const envProperty = normalizePropertyId(process.env['GA4_PROPERTY_ID']);
  if (envJson && envProperty) {
    return {
      serviceAccountJson: envJson, propertyId: envProperty,
      account: accountEmailOf(envJson), source: 'environment',
    };
  }
  return null;
}

export async function pagespeedSettings(): Promise<PagespeedSettings | null> {
  const row = await readIntegration('pagespeed');
  const key = row?.config['apiKey']?.trim();
  if (key) return { apiKey: key, source: 'connected' };

  const envKey = process.env['PAGESPEED_API_KEY']?.trim();
  if (envKey) return { apiKey: envKey, source: 'environment' };
  return null;
}

/**
 * A service account already on file, offered as the starting point for the next
 * connection. Search Console and Analytics are nearly always the same account,
 * and making someone paste the same 2 KB of JSON twice is not a connection
 * flow, it is a chore.
 */
export async function reusableServiceAccount(
  exclude?: Provider,
): Promise<{ json: string; account: string | null; from: Provider } | null> {
  for (const p of ['gsc', 'ga4'] as const) {
    if (p === exclude) continue;
    const row = await readIntegration(p);
    const json = row?.config['serviceAccountJson'];
    if (json) return { json, account: row?.account ?? null, from: p };
  }
  const envJson = envServiceAccountJson();
  return envJson ? { json: envJson, account: accountEmailOf(envJson), from: 'gsc' } : null;
}

// ---------------------------------------------------------------------------
// Status — the shape the UI renders. Deliberately carries no secrets.
// ---------------------------------------------------------------------------

export interface IntegrationStatus {
  provider: Provider;
  name: string;
  connected: boolean;
  source: Source | null;
  /** Which Google account is in use — a service-account email, or a masked key. */
  account: string | null;
  /** Which property or quota it points at. */
  label: string | null;
  verifiedAt: number | null;
  lastError: string | null;
  /** An environment-provided credential has no row to delete. */
  removable: boolean;
  encrypted: boolean;
  /** False when there is nowhere to save a connection to. */
  storable: boolean;
}

const maskKey = (k: string): string =>
  k.length <= 8 ? '••••' : `${k.slice(0, 4)}••••${k.slice(-4)}`;

export async function integrationStatus(provider: Provider): Promise<IntegrationStatus> {
  const base = {
    provider,
    name: PROVIDER_NAME[provider],
    encrypted: encryptionEnabled(),
    storable: dbConfigured() && !envOnly(),
  };
  const row = await readIntegration(provider);
  const shared = {
    verifiedAt: row?.verifiedAt ?? null,
    lastError: row?.lastError ?? null,
  };

  if (provider === 'gsc') {
    const s = await gscSettings();
    return {
      ...base, ...shared,
      connected: s !== null,
      source: s?.source ?? null,
      account: s?.account ?? null,
      label: s?.siteUrl ?? null,
      removable: s?.source === 'connected',
    };
  }

  if (provider === 'ga4') {
    const s = await ga4Settings();
    return {
      ...base, ...shared,
      connected: s !== null,
      source: s?.source ?? null,
      account: s?.account ?? null,
      label: s ? (row?.label ?? `Property ${s.propertyId}`) : null,
      removable: s?.source === 'connected',
    };
  }

  const s = await pagespeedSettings();
  return {
    ...base, ...shared,
    connected: s !== null,
    source: s?.source ?? null,
    account: s ? maskKey(s.apiKey) : null,
    label: s ? '25,000 requests/day' : null,
    removable: s?.source === 'connected',
  };
}

export async function allIntegrationStatuses(): Promise<IntegrationStatus[]> {
  return Promise.all(PROVIDERS.map(integrationStatus));
}
