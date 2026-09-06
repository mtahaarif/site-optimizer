/**
 * Proving a credential works, before it is stored.
 *
 * The old failure mode was silent: you pasted a property URL into .env.local,
 * restarted, ran an audit, and found out ten minutes later that the service
 * account had never been added as a user on the property — or that
 * GSC_SITE_URL said `https://example.com/` where the property was actually
 * `sc-domain:example.com`. Both are invisible until something queries.
 *
 * So nothing is saved until Google has confirmed it, and the property is picked
 * from the list Google returns rather than typed. The exact-string problem
 * cannot happen if the exact string is never typed.
 */
import { getAccessToken, parseServiceAccount, WEBMASTERS_SCOPE } from '../gsc/auth.ts';

export const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** Google's error envelope, which is more useful than the status code alone. */
async function googleError(res: Response, fallback: string): Promise<string> {
  let body = '';
  try { body = await res.text(); } catch { /* nothing more to say */ }
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; status?: string } };
    if (parsed.error?.message) return parsed.error.message;
  } catch { /* not JSON */ }
  return body ? `${fallback}: ${body.slice(0, 200)}` : fallback;
}

/**
 * Mint a token for a pasted key, before anything is stored.
 *
 * A bad key fails here rather than at query time, and the message Google
 * returns for it ("Invalid JWT Signature", "invalid_grant") is more useful than
 * anything this module could invent.
 */
async function tokenFor(serviceAccountJson: string, scope: string): Promise<Outcome<string>> {
  const creds = parseServiceAccount(serviceAccountJson);
  if (!creds) {
    return fail('That does not look like a service-account key. Paste the whole JSON file — '
      + 'it contains "client_email" and "private_key".');
  }
  try {
    return { ok: true, value: await getAccessToken(scope, creds) };
  } catch (err) {
    const msg = (err as Error).message;
    return fail(/invalid_grant|Invalid JWT/i.test(msg)
      ? `Google rejected that key: ${msg}. Keys are rejected when they have been deleted in `
        + 'Google Cloud, or when the JSON was edited after download.'
      : msg);
  }
}

// ---------------------------------------------------------------------------
// Search Console
// ---------------------------------------------------------------------------

export interface GscProperty {
  /** The property string exactly as the API reports it. */
  siteUrl: string;
  permission: string;
}

/**
 * The properties this service account can actually read.
 *
 * An empty list is the single most common setup mistake and it is worth
 * naming precisely: the key is valid, the API is on, and nobody added the
 * service account as a user on the property in Search Console.
 */
export async function listGscProperties(
  serviceAccountJson: string,
): Promise<Outcome<{ account: string; properties: GscProperty[] }>> {
  const token = await tokenFor(serviceAccountJson, WEBMASTERS_SCOPE);
  if (!token.ok) return token;

  const res = await fetch('https://www.googleapis.com/webmasters/v3/sites', {
    headers: { authorization: 'Bearer ' + token.value },
  });

  if (!res.ok) {
    const message = await googleError(res, `HTTP ${res.status}`);
    return fail(/SERVICE_DISABLED|has not been used|is disabled/i.test(message)
      ? 'The Search Console API is not enabled for this Google Cloud project. Enable it, wait a '
        + `minute for it to propagate, then try again. (${message.slice(0, 160)})`
      : message);
  }

  const data = await res.json() as {
    siteEntry?: Array<{ siteUrl?: string; permissionLevel?: string }>;
  };

  const properties = (data.siteEntry ?? [])
    .filter((s): s is { siteUrl: string; permissionLevel?: string } => !!s.siteUrl)
    // siteUnverifiedUser means the account can see the property exists but
    // cannot query it, so offering it would only produce a 403 later.
    .filter((s) => s.permissionLevel !== 'siteUnverifiedUser')
    .map((s) => ({ siteUrl: s.siteUrl, permission: s.permissionLevel ?? 'unknown' }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));

  const account = parseServiceAccount(serviceAccountJson)?.client_email ?? '';
  if (properties.length === 0) {
    return fail(`${account} has no Search Console properties yet. In Search Console open `
      + 'Settings → Users and permissions, add that email as a Full or Restricted user, then '
      + 'try again.');
  }
  return { ok: true, value: { account, properties } };
}

/** Confirm this account can query this exact property. */
export async function verifyGscAccess(
  serviceAccountJson: string,
  siteUrl: string,
): Promise<Outcome<{ account: string; siteUrl: string }>> {
  const token = await tokenFor(serviceAccountJson, WEBMASTERS_SCOPE);
  if (!token.ok) return token;

  const res = await fetch(
    'https://www.googleapis.com/webmasters/v3/sites/' + encodeURIComponent(siteUrl),
    { headers: { authorization: 'Bearer ' + token.value } },
  );
  if (!res.ok) {
    const message = await googleError(res, `HTTP ${res.status}`);
    return fail(res.status === 403 || res.status === 404
      ? `That account cannot read ${siteUrl}. Add it as a user on the property in Search `
        + `Console, and check the address matches the property exactly — a domain property is `
        + `written "sc-domain:example.com", not "https://example.com/". (${message.slice(0, 160)})`
      : message);
  }
  return {
    ok: true,
    value: { account: parseServiceAccount(serviceAccountJson)?.client_email ?? '', siteUrl },
  };
}

// ---------------------------------------------------------------------------
// Google Analytics 4
// ---------------------------------------------------------------------------

export interface Ga4Property {
  /** Numeric property id, no "properties/" prefix. */
  propertyId: string;
  displayName: string;
  account: string;
}

/**
 * The GA4 properties this service account can read, via the Admin API.
 *
 * Listing needs the Admin API enabled on top of the Data API. That is one more
 * thing to switch on than a manual property id would need, so a failure here is
 * not fatal — the caller falls back to letting the id be typed.
 */
export async function listGa4Properties(
  serviceAccountJson: string,
): Promise<Outcome<{ account: string; properties: Ga4Property[] }>> {
  const token = await tokenFor(serviceAccountJson, ANALYTICS_SCOPE);
  if (!token.ok) return token;

  const res = await fetch(
    'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200',
    { headers: { authorization: 'Bearer ' + token.value } },
  );

  if (!res.ok) {
    const message = await googleError(res, `HTTP ${res.status}`);
    return fail(/SERVICE_DISABLED|has not been used|is disabled/i.test(message)
      ? 'The Google Analytics Admin API is not enabled for this Google Cloud project, so the '
        + 'property list cannot be fetched. Enable it, or enter the property number yourself.'
      : message);
  }

  const data = await res.json() as {
    accountSummaries?: Array<{
      displayName?: string;
      propertySummaries?: Array<{ property?: string; displayName?: string }>;
    }>;
  };

  const properties: Ga4Property[] = [];
  for (const summary of data.accountSummaries ?? []) {
    for (const p of summary.propertySummaries ?? []) {
      const id = p.property?.replace(/^properties\//, '');
      if (!id) continue;
      properties.push({
        propertyId: id,
        displayName: p.displayName ?? `Property ${id}`,
        account: summary.displayName ?? '',
      });
    }
  }
  properties.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const account = parseServiceAccount(serviceAccountJson)?.client_email ?? '';
  if (properties.length === 0) {
    return fail(`${account} has not been given access to any Analytics property. In Analytics `
      + 'open Admin → Property access management and add that email as a Viewer, then try again.');
  }
  return { ok: true, value: { account, properties } };
}

/**
 * Confirm the Data API will answer for this property.
 *
 * `metadata` rather than a report: it costs nothing, returns immediately, and
 * fails in exactly the same ways a real query would.
 */
export async function verifyGa4Access(
  serviceAccountJson: string,
  propertyId: string,
): Promise<Outcome<{ account: string; propertyId: string }>> {
  const token = await tokenFor(serviceAccountJson, ANALYTICS_SCOPE);
  if (!token.ok) return token;

  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}/metadata`,
    { headers: { authorization: 'Bearer ' + token.value } },
  );
  if (!res.ok) {
    const message = await googleError(res, `HTTP ${res.status}`);
    if (/SERVICE_DISABLED|has not been used|is disabled/i.test(message)) {
      return fail('The Google Analytics Data API is not enabled for this Google Cloud project. '
        + 'Enable it, wait a minute, then try again.');
    }
    return fail(res.status === 403 || res.status === 404
      ? `That account cannot read property ${propertyId}. Add it as a Viewer under Admin → `
        + 'Property access management, and check this is the numeric property number rather '
        + `than a measurement id (G-XXXXXXX). (${message.slice(0, 160)})`
      : message);
  }
  return {
    ok: true,
    value: { account: parseServiceAccount(serviceAccountJson)?.client_email ?? '', propertyId },
  };
}

// ---------------------------------------------------------------------------
// PageSpeed Insights
// ---------------------------------------------------------------------------

/**
 * Check a PageSpeed key without spending 30 seconds measuring a page.
 *
 * There is no ping endpoint, and a real run takes long enough that nobody would
 * wait for it during setup. So the request is made deliberately incomplete: no
 * `url`. A working key gets back "url is required" — a 400 that proves the key
 * was accepted and the API is on. A bad key never reaches that validation and
 * comes back as API_KEY_INVALID or PERMISSION_DENIED instead, which is exactly
 * the distinction worth drawing.
 */
export async function verifyPagespeedKey(apiKey: string): Promise<Outcome<{ key: string }>> {
  const key = apiKey.trim();
  if (!key) return fail('Enter the API key.');
  if (/\s/.test(key)) return fail('That key contains spaces — copy it again from Google Cloud.');

  let res: Response;
  try {
    res = await fetch(
      'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?key=' + encodeURIComponent(key),
      { signal: AbortSignal.timeout(15_000) },
    );
  } catch (err) {
    return fail(`Could not reach PageSpeed Insights: ${(err as Error).message}`);
  }

  const message = res.ok ? '' : await googleError(res, `HTTP ${res.status}`);

  if (/API_KEY_INVALID|API key not valid|Invalid API key/i.test(message)) {
    return fail('Google rejected that key. Copy it again from Google Cloud → APIs & Services → '
      + 'Credentials.');
  }
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(message)) {
    return fail('The PageSpeed Insights API is not enabled for this key’s Google Cloud '
      + 'project. Enable it, wait a minute, then try again.');
  }
  if (res.status === 403) {
    return fail(`That key was refused: ${message.slice(0, 200)}. A key restricted by HTTP `
      + 'referrer cannot be used from a server — restrict it by API instead.');
  }

  // Anything else, including the expected "url is required", means the key got
  // past authentication, which is all this is asking.
  return { ok: true, value: { key } };
}
