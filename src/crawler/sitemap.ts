/**
 * XML sitemap discovery and parsing.
 *
 * Follows sitemap indexes one level deep, which covers essentially every real
 * site, and records format errors rather than throwing so the XML Sitemaps
 * check pack has something to report.
 */
import { normalizeUrl } from '../core/extract.ts';
import type { SitemapInfo } from '../core/checks/types.ts';
import { USER_AGENT } from './robots.ts';

const LOC = /<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]]+?)\s*(?:\]\]>)?\s*<\/loc>/gi;

export interface SitemapResult {
  sitemaps: SitemapInfo[];
  /** normalized URL -> sitemap URLs listing it */
  membership: Map<string, string[]>;
}

async function fetchOne(url: string): Promise<{ body: string; status: number; bytes: number }> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, redirect: 'follow' });
    const body = await res.text();
    return { body, status: res.status, bytes: Buffer.byteLength(body, 'utf8') };
  } catch {
    return { body: '', status: 0, bytes: 0 };
  }
}

function parseOne(url: string, body: string, status: number, bytes: number): SitemapInfo {
  let formatError: string | null = null;
  const trimmed = body.trimStart();

  if (status === 0) formatError = 'could not be fetched';
  else if (status >= 400) formatError = 'HTTP ' + status;
  else if (trimmed && !trimmed.startsWith('<')) formatError = 'not XML';
  else if (trimmed.startsWith('<') && !/<(urlset|sitemapindex)\b/i.test(trimmed)) {
    formatError = 'missing <urlset> or <sitemapindex> root';
  }

  const isIndex = /<sitemapindex\b/i.test(body);
  const urls: string[] = [];
  LOC.lastIndex = 0;
  for (let m = LOC.exec(body); m; m = LOC.exec(body)) {
    const loc = m[1]?.trim();
    if (loc) urls.push(loc);
  }

  return { url, status, urls, isIndex, formatError, bytes, entryCount: urls.length };
}

export async function discoverSitemaps(
  origin: string,
  declaredInRobots: string[],
): Promise<SitemapResult> {
  const candidates = new Set<string>(declaredInRobots);
  if (candidates.size === 0) {
    // Standard locations, plus the two Next.js App Router conventions.
    candidates.add(new URL('/sitemap.xml', origin).toString());
    candidates.add(new URL('/sitemap_index.xml', origin).toString());
    candidates.add(new URL('/sitemap-index.xml', origin).toString());
  }

  const sitemaps: SitemapInfo[] = [];
  const seen = new Set<string>();
  const queue = [...candidates];
  let expansions = 0;

  while (queue.length > 0 && sitemaps.length < 60) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);

    const { body, status, bytes } = await fetchOne(url);
    // Probing default locations legitimately 404s; do not report those as errors.
    if (status >= 400 && !declaredInRobots.includes(url)) continue;
    if (status === 0 && !declaredInRobots.includes(url)) continue;

    const info = parseOne(url, body, status, bytes);
    sitemaps.push(info);

    if (info.isIndex && expansions < 50) {
      for (const child of info.urls) {
        if (!seen.has(child)) { queue.push(child); expansions++; }
      }
    }
  }

  const membership = new Map<string, string[]>();
  for (const sm of sitemaps) {
    if (sm.isIndex) continue;
    for (const u of sm.urls) {
      const key = normalizeUrl(u);
      const list = membership.get(key) ?? [];
      if (!list.includes(sm.url)) list.push(sm.url);
      membership.set(key, list);
    }
  }

  return { sitemaps, membership };
}
