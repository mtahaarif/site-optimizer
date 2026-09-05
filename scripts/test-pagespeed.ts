/**
 * Extraction test for the PageSpeed client.
 *
 * The PSI response shape is the part most likely to be parsed wrongly, and the
 * keyless quota is too small to iterate against, so this drives a realistic
 * fixture through the real client by swapping globalThis.fetch.
 *
 *   node scripts/test-pagespeed.ts
 */
import { fetchPagespeed } from '../src/core/pagespeed/client.ts';
import { closePool } from '../src/db/index.ts';

const FIXTURE = {
  // Page-level CrUX: this URL has enough real traffic for field data.
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3200, category: 'AVERAGE' },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 18, category: 'AVERAGE' }, // CrUX scales CLS ×100
      FIRST_CONTENTFUL_PAINT_MS: { percentile: 1500, category: 'FAST' },
      INTERACTION_TO_NEXT_PAINT: { percentile: 450, category: 'AVERAGE' },
    },
  },
  originLoadingExperience: {
    metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 9999, category: 'SLOW' } },
  },
  lighthouseResult: {
    categories: { performance: { score: 0.62 } },
    audits: {
      'largest-contentful-paint': { numericValue: 4800 },
      'cumulative-layout-shift': { numericValue: 0.05 },
      'total-blocking-time': { numericValue: 740 },
      'first-contentful-paint': { numericValue: 2900 },
      'speed-index': { numericValue: 6100 },
      'largest-contentful-paint-element': {
        details: { items: [{ items: [{ node: { selector: 'div.hero > img.banner' } }] }] },
      },
      'unused-javascript': { title: 'Reduce unused JavaScript', details: { overallSavingsMs: 1250 } },
      'render-blocking-resources': { title: 'Eliminate render-blocking resources', details: { overallSavingsMs: 430 } },
      'modern-image-formats': { title: 'Serve images in next-gen formats', details: { overallSavingsMs: 60 } },
    },
  },
};

const NO_FIELD_FIXTURE = {
  // No loadingExperience at all: a low-traffic URL. Everything must fall to lab.
  originLoadingExperience: {
    metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2100, category: 'FAST' } },
  },
  lighthouseResult: {
    categories: { performance: { score: 0.94 } },
    audits: {
      'largest-contentful-paint': { numericValue: 1900 },
      'cumulative-layout-shift': { numericValue: 0.04 },
      'total-blocking-time': { numericValue: 90 },
      'first-contentful-paint': { numericValue: 1100 },
      'speed-index': { numericValue: 2400 },
    },
  },
};

const realFetch = globalThis.fetch;
function mockWith(payload: unknown, status = 200) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  ) as typeof fetch;
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(46)} ${JSON.stringify(actual)}${ok ? '' : '  expected ' + JSON.stringify(expected)}`);
}

// Bypass the disk cache by using a unique URL per assertion run.
const uniq = () => 'https://fixture.test/' + Math.random().toString(36).slice(2);

console.log('\nField data present — field must win over lab');
mockWith(FIXTURE);
const a = await fetchPagespeed(uniq(), 'mobile', { skipCache: true });
if (!a.ok) { console.log('  unexpected failure:', a.error.error); failures++; }
else {
  const m = a.data.metrics;
  check('performanceScore (0.62 -> 62)', a.data.performanceScore, 62);
  check('lcp uses field, not lab 4800', m.lcp.valueMs, 3200);
  check('lcp source', m.lcp.source, 'field');
  check('lcp score from CrUX category', m.lcp.score, 'NEEDS_IMPROVEMENT');
  check('cls descaled from 18 -> 0.18', m.cls.value, 0.18);
  check('cls source', m.cls.source, 'field');
  check('inp present from field', m.inp?.valueMs, 450);
  check('tbt is lab-only', m.tbt.source, 'lab');
  check('tbt 740ms -> POOR', m.tbt.score, 'POOR');
  check('speedIndex lab 6100 -> POOR', m.speedIndex.score, 'POOR');
  check('fieldDataAvailable', a.data.fieldDataAvailable, true);
  check('cruxOriginFallback false', a.data.cruxOriginFallback, false);
  check('lcpElement extracted', a.data.lcpElement, 'div.hero > img.banner');
  check('opportunities sorted, <100ms dropped', a.data.opportunities?.map((o) => o.savingsMs), [1250, 430]);
}

console.log('\nNo page-level field data — must fall back to origin, then lab');
mockWith(NO_FIELD_FIXTURE);
const b = await fetchPagespeed(uniq(), 'desktop', { skipCache: true });
if (!b.ok) { console.log('  unexpected failure:', b.error.error); failures++; }
else {
  const m = b.data.metrics;
  check('cruxOriginFallback true', b.data.cruxOriginFallback, true);
  check('lcp from origin field 2100', m.lcp.valueMs, 2100);
  check('cls falls to lab 0.04', m.cls.value, 0.04);
  check('cls source lab', m.cls.source, 'lab');
  check('no inp when field lacks it', m.inp, undefined);
  check('performanceScore 94', b.data.performanceScore, 94);
}

console.log('\nAPI errors must degrade, never throw');
mockWith({ error: { message: 'Quota exceeded', code: 429 } }, 429);
const c = await fetchPagespeed(uniq(), 'mobile', { skipCache: true });
check('returns ok:false', c.ok, false);
if (!c.ok) check('429 hints at the API key', c.error.error.includes('PAGESPEED_API_KEY'), true);

console.log('\nThreshold boundaries (Google official)');
mockWith({
  lighthouseResult: {
    categories: { performance: { score: 1 } },
    audits: {
      'largest-contentful-paint': { numericValue: 2500 },
      'cumulative-layout-shift': { numericValue: 0.1 },
      'total-blocking-time': { numericValue: 200 },
      'first-contentful-paint': { numericValue: 1800 },
      'speed-index': { numericValue: 3400 },
    },
  },
});
const d = await fetchPagespeed(uniq(), 'mobile', { skipCache: true });
if (d.ok) {
  check('lcp exactly 2500 is GOOD', d.data.metrics.lcp.score, 'GOOD');
  check('cls exactly 0.1 is GOOD', d.data.metrics.cls.score, 'GOOD');
  check('tbt exactly 200 is GOOD', d.data.metrics.tbt.score, 'GOOD');
  check('fcp exactly 1800 is GOOD', d.data.metrics.fcp.score, 'GOOD');
}

globalThis.fetch = realFetch;
await closePool();
console.log(failures === 0 ? '\nAll extraction assertions passed.\n' : `\n${failures} assertion(s) FAILED.\n`);
process.exitCode = failures === 0 ? 0 : 1;
