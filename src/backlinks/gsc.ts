/**
 * Module 3, part 1 — seeding backlinks from Google Search Console.
 *
 * GSC is the only free source of a real backlink list. Two important limits
 * shape this module:
 *
 *  1. The Search Console **API** does not expose the Links report. `searchType`
 *     covers search analytics, sitemaps and URL inspection — not referring
 *     domains. Only the web UI shows links, and only its CSV export gives you
 *     the full list. So the primary path here is that CSV export, and the API
 *     is used for what it *can* give us: verifying property access and pulling
 *     the referring pages that actually drive impressions.
 *  2. GSC caps the export at 1,000 sample links per property.
 *
 * Authentication uses a Google service account with domain-wide access to the
 * property, which avoids an interactive OAuth dance in a cron job.
 */
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface GscCredentials {
  client_email: string;
  private_key: string;
}

export interface GscLink {
  sourceUrl: string;
  targetUrl: string | null;
}

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

function loadCredentials(): GscCredentials | null {
  const inline = process.env['GOOGLE_SERVICE_ACCOUNT_JSON'];
  const file = process.env['GOOGLE_APPLICATION_CREDENTIALS'];
  try {
    const raw = inline ?? (file ? readFileSync(file, 'utf8') : null);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GscCredentials>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return { client_email: parsed.client_email, private_key: parsed.private_key.replace(/\\n/g, '\n') };
  } catch {
    return null;
  }
}

export function gscConfigured(): boolean {
  return loadCredentials() !== null && !!process.env['GSC_SITE_URL'];
}

/**
 * Mint a Google OAuth access token from a service account JWT.
 * Implemented directly so the project keeps its zero-dependency posture — the
 * googleapis package is ~50 MB for what is one signed JWT and one POST.
 */
async function getAccessToken(): Promise<string> {
  const creds = loadCredentials();
  if (!creds) throw new Error('No Google service account credentials configured');

  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

  const header = b64({ alg: 'RS256', typ: 'JWT' });
  const claims = b64({
    iss: creds.client_email,
    scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  });

  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(creds.private_key, 'base64url');
  const jwt = `${header}.${claims}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error('Google token response contained no access_token');
  return data.access_token;
}

/** Confirm the service account can actually read the property. */
export async function verifyAccess(): Promise<{ ok: boolean; siteUrl: string | null; error: string | null }> {
  const siteUrl = process.env['GSC_SITE_URL'];
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

/**
 * Referring pages that drive impressions, via the Search Analytics API.
 *
 * This is not the Links report — the API does not expose it — but it surfaces
 * the referring URLs Google associates with search performance, which is a
 * useful automated supplement to the manual CSV export.
 */
export async function fetchReferringPages(days = 90): Promise<string[]> {
  const siteUrl = process.env['GSC_SITE_URL'];
  if (!siteUrl) throw new Error('GSC_SITE_URL not set');

  const token = await getAccessToken();
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);

  const res = await fetch(
    `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        dimensions: ['page'],
        rowLimit: 1000,
      }),
    },
  );

  if (!res.ok) throw new Error(`Search Analytics query failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const data = await res.json() as { rows?: Array<{ keys?: string[] }> };
  return (data.rows ?? []).map((r) => r.keys?.[0] ?? '').filter(Boolean);
}

/**
 * Parse a Search Console "Top linking pages" CSV export.
 *
 * This is the practical path to a full backlink list: Search Console →
 * Links → Top linking pages → Export. Handles both the raw export and a
 * simple two-column list.
 */
export function parseGscLinksCsv(csv: string): GscLink[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return [];

  const splitRow = (line: string): string[] => {
    const cells: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cells.push(cur); cur = '';
      } else cur += ch;
    }
    cells.push(cur);
    return cells.map((c) => c.trim());
  };

  const header = splitRow(lines[0]!).map((h) => h.toLowerCase());
  const looksLikeHeader = header.some((h) => h.includes('link') || h.includes('url') || h.includes('page'));
  const rows = looksLikeHeader ? lines.slice(1) : lines;

  // GSC exports "Linking page" first and, in the per-target export, the target second.
  const targetIdx = header.findIndex((h) => h.includes('target') || h.includes('linked page'));

  const out: GscLink[] = [];
  for (const line of rows) {
    const cells = splitRow(line);
    const source = cells[0];
    if (!source || !/^https?:\/\//i.test(source)) continue;
    const target = targetIdx > 0 ? cells[targetIdx] : undefined;
    out.push({
      sourceUrl: source,
      targetUrl: target && /^https?:\/\//i.test(target) ? target : null,
    });
  }
  return out;
}
