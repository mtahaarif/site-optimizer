/**
 * End-to-end test of the Core Web Vitals checks.
 *
 * Drives a real crawl of a local fixture server with PSI mocked, so the whole
 * path is exercised: crawl -> analyse -> PSI phase -> check registry -> report.
 *
 *   node scripts/test-cwv-checks.ts
 */
import { createServer } from 'node:http';
import { runAudit } from '../src/crawler/audit.ts';
import type { CheckOutcome } from '../src/core/checks/types.ts';

// ---- a tiny two-page site to crawl ---------------------------------------
const HTML = (title: string, links: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${title}</title><meta name="description" content="A fixture page for testing Core Web Vitals check wiring end to end.">
<link rel="canonical" href="http://127.0.0.1:8791/"><meta name="viewport" content="width=device-width, initial-scale=1">
</head><body><h1>${title}</h1><p>${'Fixture content. '.repeat(60)}</p>${links}</body></html>`;

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/robots.txt') { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(url === '/'
    ? HTML('Fixture Home Page For Testing', '<a href="/about">About this fixture site</a>')
    : HTML('About This Fixture Page', '<a href="/">Home page of the fixture</a>'));
});
await new Promise<void>((r) => server.listen(8791, '127.0.0.1', r));

// ---- mock PSI ------------------------------------------------------------
function psiPayload(opts: {
  score: number; lcp: number; cls: number; tbt: number; inp?: number;
}) {
  return {
    ...(opts.inp !== undefined
      ? {
          loadingExperience: {
            metrics: {
              LARGEST_CONTENTFUL_PAINT_MS: { percentile: opts.lcp, category: 'SLOW' },
              CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: Math.round(opts.cls * 100), category: 'SLOW' },
              INTERACTION_TO_NEXT_PAINT: { percentile: opts.inp, category: 'SLOW' },
            },
          },
        }
      : {}),
    lighthouseResult: {
      categories: { performance: { score: opts.score / 100 } },
      audits: {
        'largest-contentful-paint': { numericValue: opts.lcp },
        'cumulative-layout-shift': { numericValue: opts.cls },
        'total-blocking-time': { numericValue: opts.tbt },
        'first-contentful-paint': { numericValue: 1200 },
        'speed-index': { numericValue: 3000 },
        'largest-contentful-paint-element': {
          details: { items: [{ items: [{ node: { selector: 'main > img.hero' } }] }] },
        },
        'unused-javascript': { title: 'Reduce unused JavaScript', details: { overallSavingsMs: 900 } },
      },
    },
  };
}

const realFetch = globalThis.fetch;
let scenario: unknown = null;
let psiCalls = 0;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (href.includes('pagespeedonline')) {
    psiCalls++;
    if (scenario === 'error') {
      return new Response(JSON.stringify({ error: { message: 'Quota exceeded', code: 429 } }),
        { status: 429, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(scenario), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(input, init);
}) as typeof fetch;

// Several scenarios hit the same URL, so the 24h cache must be bypassed.
process.env['PAGESPEED_NO_CACHE'] = '1';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${JSON.stringify(actual)}${ok ? '' : '  expected ' + JSON.stringify(expected)}`);
};

const outcomeOf = (outcomes: CheckOutcome[], id: string) => outcomes.find((o) => o.id === id);

async function run(label: string, payload: unknown, maxPagespeedPages = 3) {
  scenario = payload;
  psiCalls = 0;
  console.log('\n' + label);
  const report = await runAudit({
    startUrl: 'http://127.0.0.1:8791/',
    maxPages: 5,
    checkAssets: false,
    maxPagespeedPages,
  });
  return report;
}

// --- 1. failing vitals -----------------------------------------------------
{
  const r = await run('Poor vitals — every CWV check must fire',
    psiPayload({ score: 41, lcp: 5200, cls: 0.34, tbt: 810, inp: 640 }));

  check('pagespeed.attempted', r.pagespeed.attempted, true);
  check('measurements captured', r.pagespeed.results.length, 3);
  check('PSI called once per target', psiCalls, 3);

  const lcp = outcomeOf(r.outcomes, 'performance.cwv.lcp');
  check('lcp failed', lcp?.status, 'failed');
  check('lcp detail has the value', lcp?.affected[0]?.detail?.includes('5.20s'), true);
  check('lcp detail names the element', lcp?.affected[0]?.detail?.includes('main > img.hero'), true);

  const cls = outcomeOf(r.outcomes, 'performance.cwv.cls');
  check('cls failed', cls?.status, 'failed');
  check('cls detail has the value', cls?.affected[0]?.detail?.includes('0.340'), true);

  const inp = outcomeOf(r.outcomes, 'performance.cwv.inp-tbt');
  check('inp/tbt failed', inp?.status, 'failed');
  check('prefers real INP over TBT', inp?.affected[0]?.detail?.startsWith('INP 640ms'), true);

  const lh = outcomeOf(r.outcomes, 'performance.lighthouse.score');
  check('lighthouse score failed', lh?.status, 'failed');
  check('names the largest opportunity', lh?.affected[0]?.detail?.includes('unused JavaScript'), true);

  check('page table carries mobile CWV', r.pages.find((p) => p.cwv)?.cwv?.lcpMs, 5200);
}

// --- 2. passing vitals -----------------------------------------------------
{
  const r = await run('Good vitals — every CWV check must pass',
    psiPayload({ score: 96, lcp: 1800, cls: 0.02, tbt: 90 }));

  for (const id of ['performance.cwv.lcp', 'performance.cwv.cls',
    'performance.cwv.inp-tbt', 'performance.lighthouse.score',
    'homepage-mobile-pagespeed', 'homepage-desktop-pagespeed', 'pagespeed-data-available']) {
    check(id, outcomeOf(r.outcomes, id)?.status, 'passed');
  }
  check('no INP field data -> TBT proxy used', outcomeOf(r.outcomes, 'performance.cwv.inp-tbt')?.status, 'passed');
}

// --- 3. API failure --------------------------------------------------------
{
  const r = await run('PSI quota exhausted — must surface, not silently pass', 'error');

  check('no results', r.pagespeed.results.length, 0);
  check('errors recorded', r.pagespeed.errors.length > 0, true);
  const avail = outcomeOf(r.outcomes, 'pagespeed-data-available');
  check('availability check FAILED', avail?.status, 'failed');
  check('exact error preserved', avail?.affected[0]?.detail?.includes('Quota exceeded'), true);
  check('lcp check does not false-pass as a finding', outcomeOf(r.outcomes, 'performance.cwv.lcp')?.status, 'passed');
}

// --- 4. disabled -----------------------------------------------------------
{
  const r = await run('maxPagespeedPages = 0 — PSI must not run at all',
    psiPayload({ score: 10, lcp: 9000, cls: 0.9, tbt: 2000 }), 0);

  check('attempted false', r.pagespeed.attempted, false);
  check('zero PSI calls', psiCalls, 0);
  check('availability check reports it', outcomeOf(r.outcomes, 'pagespeed-data-available')?.affected[0]?.detail,
    'PageSpeed Insights was not run (maxPagespeedPages = 0)');
}

globalThis.fetch = realFetch;
server.close();
console.log(failures === 0 ? '\nAll CWV pipeline assertions passed.\n' : `\n${failures} assertion(s) FAILED.\n`);
process.exitCode = failures === 0 ? 0 : 1;
