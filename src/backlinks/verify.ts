/**
 * Module 3, part 2 — backlink verification.
 *
 * Fetches each referring page, parses the HTML, and looks for a link pointing
 * at our domain. Records whether it is still there, what the anchor says, and
 * whether it carries rel="nofollow" (or ugc / sponsored, which pass no equity
 * either).
 *
 * Link state is a transition, not a snapshot: a link that was active and is now
 * absent is a *lost* link and worth an alert, while one that was never found is
 * simply unverified.
 */
import * as cheerio from 'cheerio';
import { all, get, run, type Site } from '../db/index.ts';
import { sendAlert } from '../alerts/send.ts';
import type { GscLink } from './gsc.ts';

export type BacklinkStatus = 'active' | 'lost' | 'broken' | 'unverified';
export type RelKind = 'dofollow' | 'nofollow' | 'ugc' | 'sponsored';

export interface Backlink {
  id: number;
  site_id: number;
  source_url: string;
  target_url: string | null;
  first_seen: number;
  last_checked: number | null;
  last_seen_alive: number | null;
  status: BacklinkStatus;
  rel: RelKind | null;
  anchor: string | null;
  discovered_via: string | null;
}

export interface VerifyResult {
  backlink: Backlink;
  httpStatus: number;
  found: boolean;
  rel: RelKind | null;
  anchor: string | null;
  error: string | null;
  /** state change caused by this check */
  transition: 'none' | 'found' | 'lost' | 'broken' | 'became-nofollow' | 'became-dofollow';
}

const UA = 'Mozilla/5.0 (compatible; SiteCheckerBacklinks/1.0)';
const TIMEOUT_MS = 20_000;

// ---------------------------------------------------------------------------

export async function addBacklink(
  siteId: number, sourceUrl: string, targetUrl: string | null, via = 'manual',
): Promise<void> {
  await run(
    `INSERT INTO backlinks (site_id, source_url, target_url, first_seen, status, discovered_via)
     VALUES (?, ?, ?, ?, 'unverified', ?)
     ON CONFLICT(site_id, source_url, target_url) DO NOTHING`,
    siteId, sourceUrl, targetUrl, Date.now(), via,
  );
}

export async function importGscLinks(siteId: number, links: GscLink[]): Promise<number> {
  let added = 0;
  for (const l of links) {
    const before = (await get<{ c: number }>(
      'SELECT COUNT(*) c FROM backlinks WHERE site_id = ? AND source_url = ?', siteId, l.sourceUrl,
    ))?.c ?? 0;
    await addBacklink(siteId, l.sourceUrl, l.targetUrl, 'gsc');
    const after = (await get<{ c: number }>(
      'SELECT COUNT(*) c FROM backlinks WHERE site_id = ? AND source_url = ?', siteId, l.sourceUrl,
    ))?.c ?? 0;
    if (after > before) added++;
  }
  return added;
}

export async function listBacklinks(siteId?: number, status?: BacklinkStatus): Promise<Backlink[]> {
  const clauses: string[] = [];
  if (siteId) clauses.push('site_id = ' + Number(siteId));
  if (status) clauses.push(`status = '${status.replace(/'/g, '')}'`);
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return all<Backlink>(
    `SELECT * FROM backlinks ${where} ORDER BY (status = 'lost') DESC, last_checked ASC NULLS FIRST`,
  );
}

// ---------------------------------------------------------------------------

/** Does this href point at the tracked site? */
function pointsAtSite(href: string, base: string, origin: string): boolean {
  try {
    const target = new URL(href, base);
    const a = target.hostname.replace(/^www\./, '').toLowerCase();
    const b = new URL(origin).hostname.replace(/^www\./, '').toLowerCase();
    return a === b || a.endsWith('.' + b);
  } catch {
    return false;
  }
}

function classifyRel(rel: string): RelKind {
  const parts = rel.toLowerCase().split(/\s+/);
  if (parts.includes('nofollow')) return 'nofollow';
  if (parts.includes('sponsored')) return 'sponsored';
  if (parts.includes('ugc')) return 'ugc';
  return 'dofollow';
}

/**
 * Fetch one referring page and look for our link.
 *
 * A page-level `<meta name="robots" content="nofollow">` makes every link on
 * the page nofollow regardless of its own rel attribute, so it is checked too —
 * missing this reports a link as dofollow when it passes no equity at all.
 */
export async function verifyBacklink(link: Backlink, site: Site): Promise<VerifyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const now = Date.now();

  let httpStatus = 0;
  let found = false;
  let rel: RelKind | null = null;
  let anchor: string | null = null;
  let error: string | null = null;

  try {
    const res = await fetch(link.source_url, {
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    httpStatus = res.status;

    if (res.ok) {
      const html = await res.text();
      const $ = cheerio.load(html);

      const pageNofollow = $('meta[name="robots" i], meta[name="googlebot" i]')
        .toArray()
        .some((el) => ($(el).attr('content') ?? '').toLowerCase().includes('nofollow'));

      for (const el of $('a[href]').toArray()) {
        const href = $(el).attr('href') ?? '';
        if (!pointsAtSite(href, res.url, site.origin)) continue;

        found = true;
        anchor = $(el).text().replace(/\s+/g, ' ').trim()
          || ($(el).find('img').attr('alt') ?? '').trim()
          || null;

        const linkRel = classifyRel($(el).attr('rel') ?? '');
        rel = pageNofollow && linkRel === 'dofollow' ? 'nofollow' : linkRel;

        // A dofollow anywhere on the page is the outcome that matters, so stop
        // at the first one rather than letting a later nofollow overwrite it.
        if (rel === 'dofollow') break;
      }
    }
  } catch (err) {
    error = (err as Error).name === 'AbortError' ? 'timeout' : (err as Error).message;
  } finally {
    clearTimeout(timer);
  }

  // ---- reconcile state ---------------------------------------------------
  const wasActive = link.status === 'active';
  const previousRel = link.rel;

  let status: BacklinkStatus;
  let transition: VerifyResult['transition'] = 'none';

  if (error || httpStatus === 0 || httpStatus >= 500) {
    // Unreachable is not the same as removed; keep the last known state.
    status = link.status === 'active' ? 'active' : 'broken';
    transition = 'broken';
  } else if (httpStatus >= 400) {
    status = 'broken';
    if (wasActive) transition = 'lost';
  } else if (found) {
    status = 'active';
    if (!wasActive) transition = 'found';
    else if (previousRel === 'dofollow' && rel !== 'dofollow') transition = 'became-nofollow';
    else if (previousRel && previousRel !== 'dofollow' && rel === 'dofollow') transition = 'became-dofollow';
  } else {
    status = wasActive || link.status === 'unverified' ? 'lost' : 'lost';
    if (wasActive) transition = 'lost';
  }

  await run(
    `INSERT INTO backlink_checks (backlink_id, checked_at, http_status, found, rel, anchor, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    link.id, now, httpStatus, found ? 1 : 0, rel, anchor, error,
  );

  await run(
    `UPDATE backlinks
        SET status = ?, rel = ?, anchor = COALESCE(?, anchor),
            last_checked = ?, last_seen_alive = CASE WHEN ? = 1 THEN ? ELSE last_seen_alive END
      WHERE id = ?`,
    status, rel, anchor, now, found ? 1 : 0, now, link.id,
  );

  // ---- alert on the transitions that cost you something -------------------
  if (transition === 'lost') {
    await sendAlert({
      kind: 'backlink_lost',
      siteId: site.id,
      subject: `Backlink lost: ${new URL(link.source_url).hostname}`,
      body: [
        `Referring page: ${link.source_url}`,
        `Target:         ${link.target_url ?? site.origin}`,
        `HTTP status:    ${httpStatus || 'no response'}`,
        httpStatus >= 400 ? 'The referring page itself is gone.' : 'The page loads but the link is no longer present.',
        link.anchor ? `Last anchor:    "${link.anchor}"` : null,
        '',
        'Worth an outreach email to the site owner.',
      ].filter(Boolean).join('\n'),
    });
  } else if (transition === 'became-nofollow') {
    await sendAlert({
      kind: 'backlink_lost',
      siteId: site.id,
      subject: `Backlink downgraded to nofollow: ${new URL(link.source_url).hostname}`,
      body: [
        `Referring page: ${link.source_url}`,
        `The link is still present but now carries rel="${rel}", so it no longer passes link equity.`,
        link.anchor ? `Anchor: "${link.anchor}"` : null,
      ].filter(Boolean).join('\n'),
    });
  }

  return {
    backlink: { ...link, status, rel, anchor: anchor ?? link.anchor },
    httpStatus, found, rel, anchor, error, transition,
  };
}

/**
 * Verify a batch, oldest-checked first so a partial run still makes progress
 * across the whole list over successive scheduled invocations.
 */
export async function verifyAll(
  site: Site,
  limit = Number(process.env['BACKLINK_BATCH'] ?? 50),
): Promise<VerifyResult[]> {
  const links = await all<Backlink>(
    `SELECT * FROM backlinks WHERE site_id = ?
     ORDER BY last_checked IS NOT NULL, last_checked ASC LIMIT ?`,
    site.id, limit,
  );

  const out: VerifyResult[] = [];
  for (const link of links) {
    out.push(await verifyBacklink(link, site));
    await new Promise((r) => setTimeout(r, 800)); // be polite to referring hosts
  }
  return out;
}

export interface BacklinkSummary {
  total: number;
  active: number;
  lost: number;
  broken: number;
  unverified: number;
  dofollow: number;
  nofollow: number;
  referringDomains: number;
}

export async function backlinkSummary(siteId: number): Promise<BacklinkSummary> {
  const row = await get<Record<string, number>>(`
    SELECT COUNT(*) total,
      SUM((status = 'active')::int)     active,
      SUM((status = 'lost')::int)       lost,
      SUM((status = 'broken')::int)     broken,
      SUM((status = 'unverified')::int) unverified,
      SUM((rel = 'dofollow' AND status = 'active')::int) dofollow,
      SUM((rel IN ('nofollow','ugc','sponsored') AND status = 'active')::int) nofollow
    FROM backlinks WHERE site_id = ?`, siteId);

  const domains = await all<{ source_url: string }>(
    'SELECT DISTINCT source_url FROM backlinks WHERE site_id = ?', siteId,
  );
  const hosts = new Set<string>();
  for (const d of domains) {
    try { hosts.add(new URL(d.source_url).hostname.replace(/^www\./, '')); } catch { /* skip */ }
  }

  return {
    total: Number(row?.['total'] ?? 0),
    active: Number(row?.['active'] ?? 0),
    lost: Number(row?.['lost'] ?? 0),
    broken: Number(row?.['broken'] ?? 0),
    unverified: Number(row?.['unverified'] ?? 0),
    dofollow: Number(row?.['dofollow'] ?? 0),
    nofollow: Number(row?.['nofollow'] ?? 0),
    referringDomains: hosts.size,
  };
}
