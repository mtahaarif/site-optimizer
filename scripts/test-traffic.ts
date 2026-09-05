/**
 * Verification for the Search Console + GA4 integrations.
 *
 * Mocks both Google APIs and drives a real crawl of a local fixture, so the
 * whole path is exercised: token exchange -> API query -> SQLite cache ->
 * SiteData -> checks -> scoring -> report.
 *
 *   node scripts/test-traffic.ts
 */
import { createServer } from 'node:http';
import { runAudit } from '../src/crawler/audit.ts';
import { scoreSite, pageWeight, type PageInput } from '../src/core/scoring/model.ts';
import { normalizePath, pathOfUrl, clearGa4Cache } from '../src/core/ga4/client.ts';
import { clearCache as clearGscCache, cachedRanges } from '../src/core/gsc/client.ts';
import { resetTokenCache } from '../src/core/gsc/auth.ts';
import { closePool, run } from '../src/db/index.ts';
import type { CheckOutcome } from '../src/core/checks/types.ts';

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${JSON.stringify(actual)}${ok ? '' : '  expected ' + JSON.stringify(expected)}`);
};
const outcome = (o: CheckOutcome[], id: string) => o.find((x) => x.id === id);

// ---------------------------------------------------------------------------
// Fixture site: a money page, a broken page, an orphan, a noindexed page.
// ---------------------------------------------------------------------------
const page = (opts: { title?: string; noindex?: boolean; body?: string; links?: string[]; gtag?: boolean }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${opts.title === undefined ? '' : `<title>${opts.title}</title>`}
<meta name="description" content="A fixture page used to exercise the traffic integrations end to end.">
${opts.noindex ? '<meta name="robots" content="noindex">' : ''}
${opts.gtag ? '<script src="https://www.googletagmanager.com/gtag/js?id=G-ABCDEFGHIJ"></script>' : ''}
</head><body><h1>Heading</h1><p>${opts.body ?? 'Body copy for the fixture. '.repeat(30)}</p>
${(opts.links ?? []).map((l) => `<a href="${l}">Link to ${l}</a>`).join(' ')}
</body></html>`;

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0]!;
  if (path === '/robots.txt') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end(`Sitemap: ${BASE}/sitemap.xml
`);
    return;
  }
  if (path === '/sitemap.xml') {
    // /orphan is reachable only from the sitemap — which is exactly how a page
    // ends up with real traffic and zero internal links.
    res.writeHead(200, { 'content-type': 'application/xml' });
    res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
      + [`${BASE}/`, `${BASE}/money`, `${BASE}/orphan`].map((u) => `<url><loc>${u}</loc></url>`).join('')
      + `</urlset>`);
    return;
  }

  if (path === '/gone') {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page({ title: 'Gone' }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  if (path === '/') res.end(page({ title: 'Home', links: ['/money', '/gone', '/hidden'], gtag: true }));
  else if (path === '/money') res.end(page({ title: 'Money Page', gtag: true }));
  else if (path === '/hidden') res.end(page({ title: 'Hidden', noindex: true, gtag: true }));
  // No title, no gtag, not linked from anywhere: the orphan.
  else res.end(page({ links: [] }));
});
await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

// ---------------------------------------------------------------------------
// Mock Google
// ---------------------------------------------------------------------------
const GSC_ROWS = [
  { keys: [`${BASE}/`], clicks: 40, impressions: 3000, ctr: 0.013, position: 6.2 },
  { keys: [`${BASE}/money`], clicks: 900, impressions: 20000, ctr: 0.045, position: 2.1 },
  { keys: [`${BASE}/gone`], clicks: 25, impressions: 800, ctr: 0.031, position: 8.0 },
  { keys: [`${BASE}/hidden`], clicks: 3, impressions: 450, ctr: 0.007, position: 14.0 },
  { keys: [`${BASE}/orphan`], clicks: 12, impressions: 600, ctr: 0.02, position: 9.5 },
];

const GA4_ROWS = [
  // path, pageviews, sessions, users, conversions, bounceRate, avgDuration
  ['/', 1200, 900, 800, 5, 0.42, 65],
  ['/money', 9000, 7000, 6000, 220, 0.31, 190],
  ['/orphan', 400, 310, 290, 0, 0.55, 80],
  // Deliberately duplicated with a trailing slash: GA4 does this, and the
  // client must sum the rows rather than let one overwrite the other.
  ['/orphan/', 100, 90, 85, 0, 0.55, 80],
  ['/gone', 300, 250, 240, 0, 0.88, 12],
];

let gscCalls = 0;
let ga4Calls = 0;
let tokenCalls = 0;
const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  if (href.includes('oauth2.googleapis.com/token')) {
    tokenCalls++;
    return new Response(JSON.stringify({ access_token: 'fake-token', expires_in: 3600 }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (href.includes('searchAnalytics/query')) {
    gscCalls++;
    return new Response(JSON.stringify({ rows: GSC_ROWS }),
      { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (href.includes('analyticsdata.googleapis.com')) {
    ga4Calls++;
    return new Response(JSON.stringify({
      rows: GA4_ROWS.map((r) => ({
        dimensionValues: [{ value: r[0] }],
        metricValues: r.slice(1).map((v) => ({ value: String(v) })),
      })),
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
}) as typeof fetch;

// A syntactically valid throwaway key so the JWT signer has something to sign.
const { generateKeyPairSync } = await import('node:crypto');
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env['GOOGLE_SERVICE_ACCOUNT_JSON'] = JSON.stringify({
  client_email: 'fixture@test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
});
process.env['GSC_SITE_URL'] = BASE + '/';
process.env['GA4_PROPERTY_ID'] = '999888777';

await clearGscCache();
await clearGa4Cache();
resetTokenCache();

// ---------------------------------------------------------------------------
console.log('\n--- path normalisation ---');
check('trailing slash collapsed', normalizePath('/orphan/'), '/orphan');
check('query string stripped', normalizePath('/a?b=1'), '/a');
check('root preserved', normalizePath('/'), '/');
check('full URL reduced to path', pathOfUrl('https://x.test/Money?q=1'), '/money');
check('missing leading slash added', normalizePath('about'), '/about');

// ---------------------------------------------------------------------------
console.log('\n--- audit with both sources connected ---');
const report = await runAudit({
  startUrl: BASE + '/', maxPages: 8, checkAssets: false, maxPagespeedPages: 0,
});

check('GSC connected', report.traffic.gsc?.connected, true);
check('GSC totals', report.traffic.gsc?.totalImpressions, 24850);
check('GA4 connected', report.traffic.ga4?.connected, true);
check('GA4 sessions summed across dup paths',
  report.traffic.ga4?.totalSessions, 900 + 7000 + 310 + 90 + 250);

const money = report.pages.find((p) => p.url.endsWith('/money'));
check('money page impressions on the row', money?.impressions, 20000);
check('money page clicks', money?.clicks, 900);
check('money page sessions', money?.sessions, 7000);
check('money page conversions', money?.conversions, 220);

const home = report.pages.find((p) => new URL(p.url).pathname === '/');
check('home impressions', home?.impressions, 3000);

// ---------------------------------------------------------------------------
console.log('\n--- the 9 search-traffic checks are un-gated ---');
const gated = report.outcomes.filter(
  (o) => o.category === 'search-traffic' && o.skipReason?.includes('Requires a connected'),
);
check('none skipped for missing GSC', gated.length, 0);

check('4xx-with-clicks FIRED', outcome(report.outcomes, '4xx-with-clicks')?.status, 'failed');
check('  detail names clicks', outcome(report.outcomes, '4xx-with-clicks')?.affected[0]?.detail?.includes('25 click'), true);
check('non-indexable-with-impressions FIRED',
  outcome(report.outcomes, 'non-indexable-with-impressions')?.status, 'failed');
check('page-has-clicks FIRED', outcome(report.outcomes, 'page-has-clicks')?.status, 'failed');
check('connect-gsc-ga now PASSES', outcome(report.outcomes, 'connect-gsc-ga')?.status, 'passed');
check('ga4-not-connected now PASSES', outcome(report.outcomes, 'ga4-not-connected')?.status, 'passed');
check('gsc-fetch-failed passes', outcome(report.outcomes, 'gsc-fetch-failed')?.status, 'passed');

console.log('\n--- GA4 cross-validation checks ---');
const noTag = outcome(report.outcomes, 'traffic.ga4.tracking-tag-detected');
check('tracking-tag-detected FIRED on /orphan', noTag?.status, 'failed');
check('  and not on tagged pages', noTag?.affectedCount, 1);

const orphanTraffic = outcome(report.outcomes, 'traffic.ga4.orphaned-with-traffic');
check('orphaned-with-traffic FIRED', orphanTraffic?.status, 'failed');
check('  names the sessions', orphanTraffic?.affected[0]?.detail?.includes('400'), true);

const converting = outcome(report.outcomes, 'traffic.ga4.converting-page-with-defects');
check('converting-page check evaluated', converting?.status !== 'skipped', true);

// ---------------------------------------------------------------------------
console.log('\n--- caching ---');
const callsAfterFirst = { gsc: gscCalls, ga4: ga4Calls };
await runAudit({ startUrl: BASE + '/', maxPages: 8, checkAssets: false, maxPagespeedPages: 0 });
check('GSC served from cache on re-audit', gscCalls, callsAfterFirst.gsc);
check('GA4 served from cache on re-audit', ga4Calls, callsAfterFirst.ga4);
check('cache row recorded', (await cachedRanges()).length >= 1, true);

// ---------------------------------------------------------------------------
console.log('\n--- scoring: traffic must change page weight ---');
{
  const issues = [{ checkId: 'h1-is-missing', severity: 'critical' as const }];
  const pages: PageInput[] = [
    { url: 'https://x.test/money', issues, impressions: 20000, sessions: 7000, pageRank: 0.5 },
    { url: 'https://x.test/dead', issues: [], impressions: 0, sessions: 0, pageRank: 0.01 },
  ];
  const wMoney = pageWeight(pages[0]!, 20000, 7000);
  const wDead = pageWeight(pages[1]!, 20000, 7000);
  check('weight formula 1+3r+4i+4s', Number(wMoney.toFixed(2)), 1 + 3 * 0.5 + 4 + 4);
  check('dead page weight ~1', Number(wDead.toFixed(2)), 1.03);
  check('money page weighs more', wMoney > wDead * 9, true);

  // The same defect on a high-traffic page must hurt more than on a dead one.
  const onMoney = scoreSite([
    { url: 'https://x.test/money', issues, impressions: 20000, sessions: 7000, pageRank: 0.5 },
    { url: 'https://x.test/dead', issues: [], impressions: 0, sessions: 0, pageRank: 0.01 },
  ]).score;
  const onDead = scoreSite([
    { url: 'https://x.test/money', issues: [], impressions: 20000, sessions: 7000, pageRank: 0.5 },
    { url: 'https://x.test/dead', issues, impressions: 0, sessions: 0, pageRank: 0.01 },
  ]).score;
  console.log(`  INFO  same missing-H1: on money page -> ${onMoney.toFixed(1)}, on dead page -> ${onDead.toFixed(1)}`);
  check('defect on money page scores worse', onMoney < onDead, true);
  check('  and materially so', onDead - onMoney > 10, true);
}

// ---------------------------------------------------------------------------
console.log('\n--- graceful degradation ---');
{
  delete process.env['GSC_SITE_URL'];
  delete process.env['GA4_PROPERTY_ID'];
  const bare = await runAudit({ startUrl: BASE + '/', maxPages: 3, checkAssets: false, maxPagespeedPages: 0 });
  check('no traffic block', bare.traffic.gsc, null);
  check('no ga4 block', bare.traffic.ga4, null);
  check('search-traffic checks skip cleanly',
    outcome(bare.outcomes, '4xx-with-clicks')?.status, 'skipped');
  check('connect-gsc-ga FIRES again', outcome(bare.outcomes, 'connect-gsc-ga')?.status, 'failed');
  check('audit still completes', bare.counts.checksTotal > 300, true);
}

globalThis.fetch = realFetch;
server.close();
await run("DELETE FROM sites WHERE origin LIKE '%127.0.0.1:8799%'");
await clearGscCache();
await clearGa4Cache();
await closePool();

console.log(failures === 0 ? '\nAll traffic-integration assertions passed.\n' : `\n${failures} assertion(s) FAILED.\n`);
process.exitCode = failures === 0 ? 0 : 1;
