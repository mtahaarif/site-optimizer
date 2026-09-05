/**
 * Module 2 entry point — rank tracking.
 *
 *   node scripts/ranks.ts                       track every active keyword
 *   node scripts/ranks.ts --add <url> "<phrase>" [engine] [device] [country] [city]
 *   node scripts/ranks.ts --list
 *   node scripts/ranks.ts --usage
 *
 * Examples:
 *   node scripts/ranks.ts --add https://acme.com "seo audit tool" google mobile US "Austin,Texas,United States"
 *   node scripts/ranks.ts --add https://acme.com "seo audit tool" yandex desktop RU
 */
import { closePool, upsertSite } from '../src/db/index.ts';
import {
  addKeyword, listKeywords, trackAll, keywordsWithRanks, allUsage,
} from '../src/ranks/track.ts';
import { configuredProviders, type Engine, type Device } from '../src/ranks/providers.ts';

const args = process.argv.slice(2);
const log = (s = '') => console.log(s);

const ENGINES: Engine[] = ['google', 'bing', 'yahoo', 'yandex'];
const DEVICES: Device[] = ['desktop', 'mobile'];

const arrow = (pos: number | null, prev: number | null): string => {
  if (pos === null) return prev === null ? '  ' : '↓↓';
  if (prev === null) return 'NEW';
  if (pos < prev) return '▲' + (prev - pos);
  if (pos > prev) return '▼' + (pos - prev);
  return '  =';
};

async function main() {
  if (args[0] === '--usage') {
    const usages = await allUsage();
    if (usages.length === 0) { log('No SERP provider configured.'); return 0; }
    log('Monthly SERP quota:');
    for (const u of usages) {
      log(`  ${u.provider.padEnd(12)} ${String(u.used).padStart(4)} / ${u.limit}  used in ${u.period}   ${u.remaining} remaining`);
    }
    return 0;
  }

  if (args[0] === '--add') {
    const [, url, phrase, engine = 'google', device = 'desktop', country, city] = args;
    if (!url || !phrase) {
      console.error('usage: node scripts/ranks.ts --add <url> "<phrase>" [engine] [device] [country] [city]');
      console.error('  engines: ' + ENGINES.join(', '));
      console.error('  devices: ' + DEVICES.join(', '));
      return 1;
    }
    if (!ENGINES.includes(engine as Engine)) { console.error('Unknown engine: ' + engine); return 1; }
    if (!DEVICES.includes(device as Device)) { console.error('Unknown device: ' + device); return 1; }

    const site = await upsertSite(url);
    const kw = await addKeyword({
      siteId: site.id,
      phrase,
      engine: engine as Engine,
      device: device as Device,
      country: country ?? null,
      city: city ?? null,
      language: process.env['SERP_LANGUAGE'] ?? 'en',
    });
    log(`Tracking "${kw.phrase}" on ${kw.engine}/${kw.device}` +
      (kw.city ? ` in ${kw.city}` : kw.country ? ` in ${kw.country}` : '') +
      ` for ${site.origin}  (keyword #${kw.id})`);
    return 0;
  }

  if (args[0] === '--list') {
    const rows = await keywordsWithRanks();
    if (rows.length === 0) { log('No keywords tracked yet.'); return 0; }
    log('POS  Δ    ENGINE   DEVICE   GEO                  KEYWORD');
    for (const r of rows) {
      const geo = r.city ?? r.country ?? '-';
      log(
        (r.position === null ? ' --' : String(r.position).padStart(3)) + '  ' +
        arrow(r.position, r.previous_position).padEnd(4) + ' ' +
        r.engine.padEnd(8) + ' ' + r.device.padEnd(8) + ' ' +
        geo.slice(0, 20).padEnd(20) + ' ' + r.phrase,
      );
    }
    return 0;
  }

  // ---- default: run the tracker ------------------------------------------
  const providers = configuredProviders();
  if (providers.length === 0) {
    console.error('No SERP provider configured. Set one of:');
    console.error('  SERPAPI_KEY           (100 free searches/month)');
    console.error('  VALUESERP_KEY         (100 free searches/month)');
    console.error('  DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD');
    return 1;
  }

  const keywords = await listKeywords();
  if (keywords.length === 0) {
    log('No active keywords. Add one:');
    log('  node scripts/ranks.ts --add https://example.com "your keyword" google mobile US');
    return 0;
  }

  log(`Providers: ${providers.map((p) => p.name).join(', ')}`);
  for (const u of await allUsage()) log(`  ${u.provider}: ${u.used}/${u.limit} used this month`);
  log(`\nTracking ${keywords.length} keyword(s)...\n`);

  const results = await trackAll();
  let skipped = 0;
  let errors = 0;

  for (const r of results) {
    const geo = r.keyword.city ?? r.keyword.country ?? '-';
    if (r.skipped) {
      skipped++;
      log(`  [SKIP] ${r.keyword.phrase}  — ${r.error}`);
      continue;
    }
    if (r.error) errors++;
    log(
      `  ${(r.position === null ? '--' : String(r.position)).padStart(3)} ` +
      `${arrow(r.position, r.previousPosition).padEnd(4)} ` +
      `${r.keyword.engine.padEnd(7)} ${r.keyword.device.padEnd(7)} ${geo.slice(0, 18).padEnd(18)} ` +
      `${r.keyword.phrase}` + (r.error ? `   ERROR: ${r.error}` : ''),
    );
  }

  log();
  for (const u of await allUsage()) log(`${u.provider}: ${u.used}/${u.limit} used, ${u.remaining} remaining this month`);
  if (skipped) log(`${skipped} keyword(s) skipped — budget exhausted or no provider for that engine.`);
  return errors > 0 ? 1 : 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error('rank tracking failed:', (err as Error).message);
  process.exitCode = 2;
} finally {
  await closePool();
}
