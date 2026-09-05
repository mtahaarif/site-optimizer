/**
 * Verification for "view issue in code".
 *
 * Covers the three pieces independently and then together: offset -> line
 * resolution, per-check locators against real markup, and the gzip snapshot
 * roundtrip through SQLite including cascade delete.
 *
 *   node scripts/test-code-view.ts
 */
import { getSnippetFromOffset, countLines } from '../src/core/utils/code.ts';
import { locateFinding, hasLocator, locatableCheckIds } from '../src/core/checks/locate.ts';
import { saveSnapshots, loadSnapshot, snapshotStats, deleteReport, saveReport } from '../src/crawler/store.ts';
import { ALL_CHECKS } from '../src/core/checks/registry.ts';
import { closePool, run } from '../src/db/index.ts';
import type { AuditReport } from '../src/crawler/audit.ts';

let failures = 0;
async function main() {
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(50)} ${JSON.stringify(actual)}${ok ? '' : '  expected ' + JSON.stringify(expected)}`);
};

// ---------------------------------------------------------------------------
console.log('\n--- offset -> line resolution ---');
{
  const doc = ['line one', 'line two', 'line three', 'line four', 'line five'].join('\n');
  const offset = doc.indexOf('three') - 5; // start of "line three"

  const s = getSnippetFromOffset(doc, offset, 1);
  check('line number', s.lineNumber, 3);
  check('column', s.column, 1);
  check('total lines', s.totalLines, 5);
  check('startLine with 1 line of context', s.startLine, 2);
  check('highlightIndex', s.highlightIndex, 1);
  check('codeSnippet is the right line', s.codeSnippet, 'line three');
  check('context above and below', s.lines, ['line two', 'line three', 'line four']);

  // clamping at the document edges
  const first = getSnippetFromOffset(doc, 0, 3);
  check('offset 0 -> line 1', first.lineNumber, 1);
  check('startLine clamps to 1', first.startLine, 1);
  const last = getSnippetFromOffset(doc, doc.length, 3);
  check('offset at EOF -> last line', last.lineNumber, 5);
  check('past-EOF offset clamps', getSnippetFromOffset(doc, 99999, 1).lineNumber, 5);

  // a match range within the line
  const ranged = getSnippetFromOffset(doc, doc.indexOf('three'), 0, 5);
  check('highlightRange start', ranged.highlightRange?.start, 5);
  check('highlightRange end', ranged.highlightRange?.end, 10);

  // non-ASCII must not drift: offsets are UTF-16 units throughout
  const uni = 'héllo wörld — em dash\n<title>Tøo Long</title>';
  const ti = uni.indexOf('<title>');
  check('non-ASCII line number', getSnippetFromOffset(uni, ti, 0).lineNumber, 2);
  check('non-ASCII column', getSnippetFromOffset(uni, ti, 0).column, 1);

  check('countLines agrees', countLines(doc), 5);

  // minified single-line document
  const minified = '<!doctype html><html><head><title>x</title></head><body></body></html>';
  const m = getSnippetFromOffset(minified, minified.indexOf('<title>'), 3, 7);
  check('minified stays on line 1', m.lineNumber, 1);
  check('minified range clipped to line', (m.highlightRange?.end ?? 0) <= minified.length, true);
}

// ---------------------------------------------------------------------------
console.log('\n--- check locators against real markup ---');
{
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>A title that is quite considerably longer than sixty characters for testing</title>
<meta name="description" content="short">
<link rel="canonical" href="https://other.example.com/elsewhere">
<meta name="robots" content="noindex">
<meta property="og:image" content="/relative-image.png">
</head>
<body>
<h1>First heading</h1>
<p>Body copy.</p>
<h1>Second heading</h1>
<img src="/photo.jpg">
<a href="#">Click here</a>
<div style="color:red">inline styled</div>
</body>
</html>`;

  const at = (id: string) => {
    const loc = locateFinding(id, html);
    if (!loc) return null;
    return getSnippetFromOffset(html, loc.offset, 0).lineNumber;
  };

  check('title-too-long -> <title> line', at('title-too-long'), 5);
  check('description-too-short -> meta desc line', at('description-too-short'), 6);
  check('canonical-not-equal-url -> canonical line', at('canonical-not-equal-url'), 7);
  check('meta-noindex-pages -> robots line', at('meta-noindex-pages'), 8);
  check('og-image-relative -> og:image line', at('og-image-relative'), 9);
  check('multiple-h1 -> the SECOND h1', at('multiple-h1'), 14);
  check('missing-alt-text -> the <img>', at('missing-alt-text'), 15);
  check('empty-links-hash -> the # link', at('empty-links-hash'), 16);
  check('tags-with-style-attributes -> styled div', at('tags-with-style-attributes'), 17);
  check('html-lang-invalid -> <html> line', at('html-lang-invalid'), 2);

  check('locator labels the match', locateFinding('title-too-long', html)?.label, '<title>');
  check('unknown check id has no locator', locateFinding('not-a-real-check', html), null);
  check('locator absent for site-level check', hasLocator('ssl-certificate-valid'), false);

  // A locator whose pattern is simply not present must return null, not guess.
  check('canonical locator on markup without one',
    locateFinding('canonical-not-equal-url', '<html><head></head><body></body></html>'), null);

  // Every registered locator id must correspond to a real check.
  const ids = new Set(ALL_CHECKS.map((c) => c.id));
  const orphans = locatableCheckIds().filter((id) => !ids.has(id));
  check('no locators for non-existent checks', orphans, []);
  console.log(`  INFO  ${locatableCheckIds().length} of ${ALL_CHECKS.length} checks have a source locator`);
}

// ---------------------------------------------------------------------------
console.log('\n--- snapshot storage roundtrip ---');
{
  const crawlId = 'test-code-view-' + Date.now();
  const big = '<!doctype html><html><body>'
    + '<div class="card"><p>Repeated representative content.</p></div>'.repeat(500)
    + '</body></html>';

  // page_snapshots has a FK to crawls, so a parent row must exist first.
  const stub = {
    id: crawlId, origin: 'https://snapshot.test', createdAt: new Date().toISOString(),
    durationMs: 1, score: 50, rubricVersion: '1.0.0', isNext: false,
    counts: { htmlPages: 1, checksFailed: 0, checksPassed: 0 },
    severity: { blocker: 0, critical: 0, warning: 0 },
  } as unknown as AuditReport;
  await saveReport(stub);

  const res = await saveSnapshots(crawlId, [
    { url: 'https://snapshot.test/', html: big, rendered: false },
    { url: 'https://snapshot.test/about', html: '<html><title>About</title></html>', rendered: true },
  ]);
  check('saved both snapshots', res.saved, 2);
  check('compressed smaller than raw', res.gzipBytes < res.rawBytes, true);
  console.log(`  INFO  ${res.rawBytes} raw -> ${res.gzipBytes} gzipped `
    + `(${(res.gzipBytes / res.rawBytes * 100).toFixed(1)}%)`);

  const back = await loadSnapshot(crawlId, 'https://snapshot.test/');
  check('roundtrip is byte-identical', back?.html === big, true);
  check('rendered flag preserved', (await loadSnapshot(crawlId, 'https://snapshot.test/about'))?.rendered, true);

  // Lookup is by normalized URL, so trailing-slash form must not matter.
  check('lookup ignores trailing slash', !!(await loadSnapshot(crawlId, 'https://snapshot.test')), true);
  check('unknown URL returns null', await loadSnapshot(crawlId, 'https://snapshot.test/nope'), null);

  check('stats count', (await snapshotStats(crawlId)).count, 2);

  // Deleting the crawl must take its snapshots with it.
  await deleteReport(crawlId);
  check('snapshots dropped with the crawl', (await snapshotStats(crawlId)).count, 0);
  check('snapshot unreadable after delete', await loadSnapshot(crawlId, 'https://snapshot.test/'), null);

  await run('DELETE FROM sites WHERE origin = ?', 'https://snapshot.test');
}

console.log(failures === 0 ? '\nAll code-view assertions passed.\n' : `\n${failures} assertion(s) FAILED.\n`);
process.exitCode = failures === 0 ? 0 : 1;
}

try {
  await main();
} finally {
  await closePool();
}
