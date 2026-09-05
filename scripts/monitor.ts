/**
 * Module 1 entry point — run one monitoring pass over every registered site.
 *
 *   node scripts/monitor.ts                    check all registered sites
 *   node scripts/monitor.ts --add https://x.com [label]
 *   node scripts/monitor.ts --status
 *
 * Exits non-zero when any site is down, so a scheduler that reports failures
 * (GitHub Actions, systemd) surfaces the outage even if email delivery fails.
 */
import { closeDb, listSites } from '../src/db/index.ts';
import { checkAllSites, addMonitoredSite, uptimeSummary, recentIncidents } from '../src/monitor/check.ts';
import { alertChannelsConfigured } from '../src/alerts/send.ts';

const args = process.argv.slice(2);

function log(s = '') { console.log(s); }

async function main() {
  if (args[0] === '--add') {
    const url = args[1];
    if (!url) { console.error('usage: node scripts/monitor.ts --add <url> [label]'); process.exit(1); }
    const site = addMonitoredSite(url, args[2]);
    log(`Monitoring ${site.origin} (site #${site.id})`);
    return 0;
  }

  if (args[0] === '--status') {
    const day = Date.now() - 86_400_000;
    for (const site of listSites()) {
      const s = uptimeSummary(site.id, day);
      if (!s) continue;
      log(`${site.origin}`);
      log(`  24h uptime : ${s.uptimePct.toFixed(2)}%  (${s.checks} checks, ${s.failures} failures)`);
      log(`  avg response: ${s.avgResponseMs} ms`);
      log(`  last check : ${s.lastCheck ? new Date(s.lastCheck.checked_at).toISOString() + '  HTTP ' + s.lastCheck.status : 'never'}`);
      if (s.sslDaysRemaining !== null) log(`  ssl expires: in ${s.sslDaysRemaining} days`);
      if (s.openIncident) log(`  OPEN INCIDENT since ${new Date(s.openIncident.started_at).toISOString()}`);
      log();
    }
    const incidents = recentIncidents(undefined, 5);
    if (incidents.length) {
      log('Recent incidents:');
      for (const i of incidents) {
        const dur = i.resolved_at ? Math.round((i.resolved_at - i.started_at) / 60_000) + 'm' : 'ongoing';
        log(`  ${new Date(i.started_at).toISOString()}  HTTP ${i.last_status}  ${dur}`);
      }
    }
    return 0;
  }

  const sites = listSites();
  if (sites.length === 0) {
    log('No sites registered. Add one:');
    log('  node scripts/monitor.ts --add https://example.com');
    return 0;
  }

  const channels = alertChannelsConfigured();
  log(`Alert channels: ${channels.length ? channels.join(', ') : 'none configured (console only)'}`);
  log(`Checking ${sites.length} site(s)...\n`);

  const results = await checkAllSites();
  let down = 0;

  for (const r of results) {
    const mark = r.ok ? 'UP  ' : 'DOWN';
    const status = r.status === 0 ? 'no response' : String(r.status);
    log(`  [${mark}] ${r.site.origin.padEnd(34)} ${status.padStart(11)}  ${String(r.responseMs).padStart(5)} ms` +
      (r.transition !== 'none' ? '   ' + r.transition.toUpperCase() : '') +
      (r.alerted ? '  (alert sent)' : ''));
    if (r.error) log(`         ${r.error}`);
    if (!r.ok) down++;
  }

  log();
  log(down === 0 ? 'All sites returned 200 OK.' : `${down} site(s) not returning 200 OK.`);
  return down > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error('monitor failed:', (err as Error).message);
  process.exitCode = 2;
} finally {
  closeDb();
}
