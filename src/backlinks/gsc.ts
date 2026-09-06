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
 * Authentication is the shared service-account flow in src/core/gsc/auth.ts.
 * This module used to carry its own copy of the JWT exchange; two
 * implementations of the same signed assertion is exactly the drift that
 * extraction was meant to prevent, and only one of them would have learned
 * about credentials being connected in the UI rather than set in the
 * environment.
 */
import { getAccessToken, gscConfigured, verifyAccess } from '../core/gsc/auth.ts';
import { gscSettings } from '../core/integrations/store.ts';

export type { ServiceAccount as GscCredentials } from '../core/gsc/auth.ts';

export { gscConfigured, verifyAccess };

export interface GscLink {
  sourceUrl: string;
  targetUrl: string | null;
}

/**
 * Referring pages that drive impressions, via the Search Analytics API.
 *
 * This is not the Links report — the API does not expose it — but it surfaces
 * the referring URLs Google associates with search performance, which is a
 * useful automated supplement to the manual CSV export.
 */
export async function fetchReferringPages(days = 90): Promise<string[]> {
  const settings = await gscSettings();
  if (!settings) throw new Error('Search Console is not connected.');
  const { siteUrl } = settings;

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
