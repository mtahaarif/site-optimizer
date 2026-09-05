/**
 * Module 1 — 24/7 uptime monitoring.
 *
 * Sends a GET to the homepage. Anything other than 200 OK opens an incident and
 * fires an alert; the next 200 closes it and fires a recovery alert.
 *
 * Alerting is keyed to the incident, not the poll. A site down for three hours
 * on a five-minute schedule produces 36 failed checks, one incident and two
 * emails — down and recovered. Alerting per poll is how monitoring tools get
 * muted, at which point they stop working entirely.
 */
import { createHash } from 'node:crypto';
import { all, get, run, upsertSite, listSites, type Site } from '../db/index.ts';
import { sendAlert } from '../alerts/send.ts';

export interface MonitorCheck {
  id: number;
  site_id: number;
  checked_at: number;
  url: string;
  status: number;
  ok: number;
  response_ms: number;
  error: string | null;
  redirect_to: string | null;
  body_hash: string | null;
  ssl_days_remaining: number | null;
}

export interface Incident {
  id: number;
  site_id: number;
  started_at: number;
  resolved_at: number | null;
  first_status: number | null;
  last_status: number | null;
  failure_count: number;
  error: string | null;
}

export interface MonitorResult {
  site: Site;
  status: number;
  ok: boolean;
  responseMs: number;
  error: string | null;
  redirectTo: string | null;
  sslDaysRemaining: number | null;
  /** what changed as a result of this poll */
  transition: 'none' | 'went-down' | 'recovered' | 'still-down';
  alerted: boolean;
}

const UA = 'Mozilla/5.0 (compatible; SiteCheckerMonitor/1.0)';
const TIMEOUT_MS = Number(process.env['MONITOR_TIMEOUT_MS'] ?? 15_000);

/** Warn this many days before the TLS certificate expires. */
const SSL_WARN_DAYS = Number(process.env['SSL_WARN_DAYS'] ?? 14);

// ---------------------------------------------------------------------------

async function probe(url: string): Promise<{
  status: number; responseMs: number; error: string | null;
  redirectTo: string | null; bodyHash: string | null;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const t0 = Date.now();

  try {
    // redirect: 'manual' so a homepage that 301s is reported as a 301, not
    // silently followed to a 200 somewhere else.
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
    });
    const responseMs = Date.now() - t0;
    const redirectTo = res.headers.get('location');

    let bodyHash: string | null = null;
    if (res.status === 200) {
      const body = await res.text();
      bodyHash = createHash('sha256').update(body).digest('hex').slice(0, 16);
    }
    return { status: res.status, responseMs, error: null, redirectTo, bodyHash };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return {
      status: 0,
      responseMs: Date.now() - t0,
      error: aborted ? `timeout after ${TIMEOUT_MS}ms` : (err as Error).message,
      redirectTo: null,
      bodyHash: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function tlsDaysRemaining(origin: string): Promise<number | null> {
  if (!origin.startsWith('https://')) return null;
  try {
    const { connect } = await import('node:tls');
    const host = new URL(origin).hostname;
    return await new Promise<number | null>((resolve) => {
      const socket = connect({ host, port: 443, servername: host, timeout: 8000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert?.valid_to) return resolve(null);
        resolve(Math.round((Date.parse(cert.valid_to) - Date.now()) / 86_400_000));
      });
      socket.on('error', () => resolve(null));
      socket.on('timeout', () => { socket.destroy(); resolve(null); });
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------

export function openIncident(siteId: number): Incident | undefined {
  return get<Incident>(
    'SELECT * FROM incidents WHERE site_id = ? AND resolved_at IS NULL ORDER BY started_at DESC LIMIT 1',
    siteId,
  );
}

const fmt = (ms: number): string => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return m + ' minute' + (m === 1 ? '' : 's');
  const h = Math.floor(m / 60);
  return h + 'h ' + (m % 60) + 'm';
};

/**
 * Poll one site and reconcile incident state.
 */
export async function checkSite(site: Site): Promise<MonitorResult> {
  const url = site.origin + '/';
  const r = await probe(url);
  const ok = r.status === 200;
  const now = Date.now();
  const sslDays = await tlsDaysRemaining(site.origin);

  run(
    `INSERT INTO monitor_checks
       (site_id, checked_at, url, status, ok, response_ms, error, redirect_to, body_hash, ssl_days_remaining)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    site.id, now, url, r.status, ok ? 1 : 0, r.responseMs,
    r.error, r.redirectTo, r.bodyHash, sslDays,
  );

  const existing = openIncident(site.id);
  let transition: MonitorResult['transition'] = 'none';
  let alerted = false;

  if (!ok && !existing) {
    // First failure: open an incident and alert once.
    transition = 'went-down';
    const { lastInsertRowid } = run(
      `INSERT INTO incidents (site_id, started_at, first_status, last_status, failure_count, error)
       VALUES (?, ?, ?, ?, 1, ?)`,
      site.id, now, r.status, r.status, r.error,
    );
    await sendAlert({
      kind: 'down',
      siteId: site.id,
      incidentId: lastInsertRowid,
      subject: `DOWN: ${site.origin} returned ${r.status || 'no response'}`,
      body: [
        `URL:        ${url}`,
        `Status:     ${r.status === 0 ? 'no response' : r.status}`,
        r.error ? `Error:      ${r.error}` : null,
        r.redirectTo ? `Redirects:  ${r.redirectTo}` : null,
        `Response:   ${r.responseMs} ms`,
        `Detected:   ${new Date(now).toISOString()}`,
      ].filter(Boolean).join('\n'),
    });
    alerted = true;
  } else if (!ok && existing) {
    // Already known to be down. Update the incident, stay quiet.
    transition = 'still-down';
    run(
      'UPDATE incidents SET failure_count = failure_count + 1, last_status = ?, error = ? WHERE id = ?',
      r.status, r.error, existing.id,
    );
  } else if (ok && existing) {
    transition = 'recovered';
    run('UPDATE incidents SET resolved_at = ? WHERE id = ?', now, existing.id);
    await sendAlert({
      kind: 'recovered',
      siteId: site.id,
      incidentId: existing.id,
      subject: `RECOVERED: ${site.origin} is back to 200 OK`,
      body: [
        `URL:        ${url}`,
        `Down for:   ${fmt(now - existing.started_at)}`,
        `Failures:   ${existing.failure_count + 1} consecutive checks`,
        `Last error: ${existing.error ?? 'HTTP ' + existing.last_status}`,
        `Recovered:  ${new Date(now).toISOString()}`,
      ].join('\n'),
    });
    alerted = true;
  }

  // Certificate expiry is a separate concern from uptime: the site is up right
  // up until the moment it is catastrophically not.
  if (sslDays !== null && sslDays <= SSL_WARN_DAYS && sslDays >= 0) {
    const alreadyWarned = get<{ c: number }>(
      `SELECT COUNT(*) c FROM alerts
       WHERE site_id = ? AND kind = 'ssl_expiring' AND sent_at > ?`,
      site.id, now - 86_400_000,
    );
    if ((alreadyWarned?.c ?? 0) === 0) {
      await sendAlert({
        kind: 'ssl_expiring',
        siteId: site.id,
        subject: `SSL expiring in ${sslDays} days: ${site.origin}`,
        body: `The TLS certificate for ${site.origin} expires in ${sslDays} day(s).\n`
          + 'If auto-renewal is configured, verify it is actually running.',
      });
      alerted = true;
    }
  }

  return {
    site,
    status: r.status,
    ok,
    responseMs: r.responseMs,
    error: r.error,
    redirectTo: r.redirectTo,
    sslDaysRemaining: sslDays,
    transition,
    alerted,
  };
}

/** Poll every registered site. This is what the cron entry point calls. */
export async function checkAllSites(): Promise<MonitorResult[]> {
  const sites = listSites();
  const out: MonitorResult[] = [];
  for (const site of sites) out.push(await checkSite(site));
  return out;
}

export function addMonitoredSite(url: string, label?: string): Site {
  return upsertSite(url, label);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export interface UptimeSummary {
  site: Site;
  checks: number;
  failures: number;
  uptimePct: number;
  avgResponseMs: number;
  lastCheck: MonitorCheck | null;
  openIncident: Incident | null;
  sslDaysRemaining: number | null;
}

export function uptimeSummary(siteId: number, sinceMs: number): UptimeSummary | null {
  const site = get<Site>('SELECT * FROM sites WHERE id = ?', siteId);
  if (!site) return null;

  const agg = get<{ checks: number; failures: number; avg: number | null }>(
    `SELECT COUNT(*) checks,
            SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) failures,
            AVG(response_ms) avg
     FROM monitor_checks WHERE site_id = ? AND checked_at >= ?`,
    siteId, sinceMs,
  );

  const last = get<MonitorCheck>(
    'SELECT * FROM monitor_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT 1', siteId,
  );

  const checks = agg?.checks ?? 0;
  const failures = agg?.failures ?? 0;

  return {
    site,
    checks,
    failures,
    uptimePct: checks > 0 ? ((checks - failures) / checks) * 100 : 100,
    avgResponseMs: Math.round(agg?.avg ?? 0),
    lastCheck: last ?? null,
    openIncident: openIncident(siteId) ?? null,
    sslDaysRemaining: last?.ssl_days_remaining ?? null,
  };
}

export function recentChecks(siteId: number, limit = 100): MonitorCheck[] {
  return all<MonitorCheck>(
    'SELECT * FROM monitor_checks WHERE site_id = ? ORDER BY checked_at DESC LIMIT ?',
    siteId, limit,
  );
}

export function recentIncidents(siteId?: number, limit = 25): Incident[] {
  return siteId
    ? all<Incident>('SELECT * FROM incidents WHERE site_id = ? ORDER BY started_at DESC LIMIT ?', siteId, limit)
    : all<Incident>('SELECT * FROM incidents ORDER BY started_at DESC LIMIT ?', limit);
}
