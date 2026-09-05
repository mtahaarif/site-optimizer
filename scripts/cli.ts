/**
 * Headless audit runner, for testing the engine without the dashboard.
 *   node scripts/cli.ts https://example.com [maxPages]
 */
import { runAudit } from '../src/crawler/audit.ts';
import { checkStats } from '../src/core/checks/registry.ts';

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const positional = argv.filter((a) => !a.startsWith('--'));

const url = positional[0];
const maxPages = Number(positional[1] ?? 25);
const renderJs = flags.has('--render-js') || flags.has('--js');
const noPsi = flags.has('--no-psi');

if (!url) {
  console.error('usage: node scripts/cli.ts <url> [maxPages] [--render-js] [--no-psi]');
  console.error('  --render-js, --js   render each page in headless Chromium before extraction');
  console.error('                      (required for client-side SPAs; much slower)');
  console.error('  --no-psi            skip PageSpeed Insights');
  process.exit(1);
}

const stats = checkStats();
console.log('Registry: ' + stats.total + ' checks across ' + Object.keys(stats.byCategory).length + ' categories');
console.log(Object.entries(stats.byCategory).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`  ${k.padEnd(20)} ${v}`).join('\n'));
console.log('\nSeverity mix:', JSON.stringify(stats.bySeverity));
console.log('\nCrawling ' + url + ' (max ' + maxPages + ' pages)' + (renderJs ? '  [JavaScript rendering ON]' : '') + '...\n');

const report = await runAudit({
  startUrl: url,
  maxPages,
  renderJs,
  ...(noPsi ? { maxPagespeedPages: 0 } : {}),
}, (p) => {
  process.stdout.write('\r  [' + p.phase.padEnd(10) + '] ' + p.message.padEnd(60));
});
process.stdout.write('\n\n');

const c = report.counts;
console.log('='.repeat(72));
console.log('  ' + report.origin + '   SCORE ' + report.score + '/100   (rubric v' + report.rubricVersion + ')');
console.log('='.repeat(72));
console.log('  crawled=' + c.crawled + '  html=' + c.htmlPages + '  assets=' + c.assets +
  '  indexable=' + c.indexable + '  orphans=' + c.orphans);
console.log('  checks: ' + c.checksFailed + ' failed, ' + c.checksPassed + ' passed, ' +
  c.checksSkipped + ' skipped  (of ' + c.checksTotal + ')');
console.log('  severity:', JSON.stringify(report.severity));
if (report.nextSummary) {
  console.log('  next.js: router=' + report.nextSummary.router +
    '  strategies=' + JSON.stringify(report.nextSummary.strategies));
}
console.log('  duration: ' + (report.durationMs / 1000).toFixed(1) + 's');
if (report.render.enabled) {
  console.log('  rendered: ' + report.render.renderedPages + ' page(s) in headless Chromium'
    + (report.render.failures.length ? ', ' + report.render.failures.length + ' fell back to raw HTML' : '')
    + (report.render.consoleErrors ? ', ' + report.render.consoleErrors + ' JS console error(s)' : ''));
  for (const f of report.render.failures.slice(0, 3)) console.log('      ! ' + f.url + ' - ' + f.error);
} else if (report.render.spaShellsDetected > 0) {
  console.log('  NOTE: ' + report.render.spaShellsDetected +
    ' page(s) look client-rendered. Re-run with --render-js to audit the hydrated DOM.');
}

console.log('\n--- FAILED CHECKS BY CATEGORY ---');
for (const cat of report.categories) {
  if (cat.failed.length === 0) continue;
  console.log('\n' + cat.label.toUpperCase() + '  (' + cat.failed.length + ' issues, ' +
    cat.passed.length + ' passed, ' + Math.round(cat.affectedPageShare * 100) + '% of pages affected)');
  for (const f of cat.failed.slice(0, 8)) {
    console.log('   [' + f.severity.padEnd(11) + '] ' + f.title + ' : ' + f.affectedCount + ' page(s)');
    if (f.affected[0]?.detail) console.log('        e.g. ' + f.affected[0].detail);
  }
}

console.log('\n--- WORST PAGES ---');
for (const p of report.pages.slice(0, 5)) {
  console.log('  ' + p.score.toFixed(1).padStart(5) + '  ' + p.issueCount + ' issues  ' + p.url);
}
