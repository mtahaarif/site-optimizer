/**
 * Module 3 entry point — backlink monitoring.
 *
 *   node scripts/backlinks.ts <url>                    verify a batch for a site
 *   node scripts/backlinks.ts --import-gsc <url>       seed from Search Console
 *   node scripts/backlinks.ts --import-csv <url> <file>  seed from a GSC CSV export
 *   node scripts/backlinks.ts --add <url> <sourceUrl>
 *   node scripts/backlinks.ts --list <url> [status]
 */
import { readFileSync } from 'node:fs';
import { closePool, upsertSite, findSite, listSites } from '../src/db/index.ts';
import {
  verifyAll, importGscLinks, addBacklink, listBacklinks, backlinkSummary,
} from '../src/backlinks/verify.ts';
import { gscConfigured, verifyAccess, fetchReferringPages, parseGscLinksCsv } from '../src/backlinks/gsc.ts';

const args = process.argv.slice(2);
const log = (s = '') => console.log(s);

async function main() {
  // ---- import from Search Console ----------------------------------------
  if (args[0] === '--import-gsc') {
    const url = args[1];
    if (!url) { console.error('usage: node scripts/backlinks.ts --import-gsc <url>'); return 1; }
    if (!gscConfigured()) {
      console.error('Google Search Console is not configured. Set:');
      console.error('  GOOGLE_SERVICE_ACCOUNT_JSON  (or GOOGLE_APPLICATION_CREDENTIALS)');
      console.error('  GSC_SITE_URL                 e.g. https://example.com/ or sc-domain:example.com');
      return 1;
    }
    const access = await verifyAccess();
    if (!access.ok) { console.error('Search Console access failed: ' + access.error); return 1; }
    log(`Connected to ${access.siteUrl}`);

    const site = await upsertSite(url);
    const pages = await fetchReferringPages(90);
    const added = await importGscLinks(site.id, pages.map((p) => ({ sourceUrl: p, targetUrl: null })));
    log(`Imported ${pages.length} page(s) from Search Analytics, ${added} new.`);
    log();
    log('Note: the Search Console API does not expose the Links report. For the full');
    log('backlink list, export Search Console > Links > Top linking pages and run:');
    log(`  node scripts/backlinks.ts --import-csv ${url} <export.csv>`);
    return 0;
  }

  // ---- import from a CSV export ------------------------------------------
  if (args[0] === '--import-csv') {
    const [, url, file] = args;
    if (!url || !file) {
      console.error('usage: node scripts/backlinks.ts --import-csv <url> <csv-file>');
      return 1;
    }
    const site = await upsertSite(url);
    const links = parseGscLinksCsv(readFileSync(file, 'utf8'));
    const added = await importGscLinks(site.id, links);
    log(`Parsed ${links.length} link(s) from ${file}, ${added} new.`);
    return 0;
  }

  if (args[0] === '--add') {
    const [, url, sourceUrl] = args;
    if (!url || !sourceUrl) { console.error('usage: node scripts/backlinks.ts --add <url> <sourceUrl>'); return 1; }
    const site = await upsertSite(url);
    await addBacklink(site.id, sourceUrl, null, 'manual');
    log(`Tracking backlink from ${sourceUrl} to ${site.origin}`);
    return 0;
  }

  if (args[0] === '--list') {
    const url = args[1];
    const site = url ? await findSite(url) : (await listSites())[0];
    if (!site) { console.error('Site not found. Add a backlink first.'); return 1; }
    const status = args[2] as 'active' | 'lost' | 'broken' | 'unverified' | undefined;
    const links = await listBacklinks(site.id, status);
    const s = await backlinkSummary(site.id);

    log(`${site.origin} — ${s.total} backlink(s) from ${s.referringDomains} domain(s)`);
    log(`  active ${s.active}   lost ${s.lost}   broken ${s.broken}   unverified ${s.unverified}`);
    log(`  dofollow ${s.dofollow}   nofollow/ugc/sponsored ${s.nofollow}`);
    log();
    for (const l of links.slice(0, 60)) {
      log(`  [${l.status.padEnd(10)}] ${(l.rel ?? '-').padEnd(9)} ${l.source_url.slice(0, 70)}`);
      if (l.anchor) log(`               anchor: "${l.anchor.slice(0, 60)}"`);
    }
    if (links.length > 60) log(`  ... and ${links.length - 60} more`);
    return 0;
  }

  // ---- default: verify a batch -------------------------------------------
  const url = args[0];
  const site = url ? ((await findSite(url)) ?? (await upsertSite(url))) : (await listSites())[0];
  if (!site) {
    log('No site registered. Seed backlinks first:');
    log('  node scripts/backlinks.ts --import-gsc https://example.com');
    log('  node scripts/backlinks.ts --add https://example.com https://referring-site.com/post');
    return 0;
  }

  const pending = await listBacklinks(site.id);
  if (pending.length === 0) {
    log(`No backlinks tracked for ${site.origin}. Seed some first.`);
    return 0;
  }

  log(`Verifying backlinks for ${site.origin} (${pending.length} tracked)...\n`);
  const results = await verifyAll(site);

  let lost = 0;
  for (const r of results) {
    const mark = r.found ? (r.rel === 'dofollow' ? 'DOFOLLOW' : (r.rel ?? 'FOUND').toUpperCase()) : 'MISSING';
    log(`  [${mark.padEnd(9)}] HTTP ${String(r.httpStatus).padStart(3)}  ${r.backlink.source_url.slice(0, 66)}`);
    if (r.transition !== 'none') log(`               -> ${r.transition.toUpperCase()}`);
    if (r.error) log(`               ${r.error}`);
    if (r.transition === 'lost') lost++;
  }

  const s = await backlinkSummary(site.id);
  log();
  log(`Checked ${results.length} of ${pending.length}.  active ${s.active} | lost ${s.lost} | broken ${s.broken}`);
  log(`dofollow ${s.dofollow} | nofollow ${s.nofollow} | ${s.referringDomains} referring domain(s)`);
  if (lost) log(`\n${lost} link(s) newly lost — alerts sent.`);
  return 0;
}

try {
  process.exitCode = await main();
} catch (err) {
  console.error('backlink check failed:', (err as Error).message);
  process.exitCode = 2;
} finally {
  await closePool();
}
