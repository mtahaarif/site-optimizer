// Reproduces Sitechecker's published Website Score formula verbatim and tests it
// for monotonicity: does fixing a critical error always improve the score?
//
// Formula (from https://help.sitechecker.pro/article/81-how-is-website-score-calculated):
//   cost(criticalType) = (60 * countOfThatType) / totalCriticals
//   cost(warningType)  = (40 * countOfThatType) / totalWarnings
//   OnePageScore       = 100 - sum(costs of issues on that page)
//   WebsiteScore       = sum(OnePageScore) / pageCount - siteLevelPenalties

function websiteScore({ pages, criticals, warnings, siteLevel = 0 }) {
  const totalCrit = Object.values(criticals).reduce((a, b) => a + b, 0);
  const totalWarn = Object.values(warnings).reduce((a, b) => a + b, 0);

  const critCost = {}, warnCost = {};
  for (const [k, n] of Object.entries(criticals)) critCost[k] = totalCrit ? (60 * n) / totalCrit : 0;
  for (const [k, n] of Object.entries(warnings))  warnCost[k] = totalWarn ? (40 * n) / totalWarn : 0;

  // Total points deducted across the whole site = cost * (number of pages carrying it)
  let deducted = 0;
  for (const [k, n] of Object.entries(criticals)) deducted += critCost[k] * n;
  for (const [k, n] of Object.entries(warnings))  deducted += warnCost[k] * n;

  return { critCost, warnCost, deducted, score: (pages * 100 - deducted) / pages - siteLevel };
}

// --- Sitechecker's own published example -------------------------------------
const before = {
  pages: 45,
  criticals: { 'Redirect chains': 4, 'Title is missing': 6 },
  warnings:  { '4xx client errors': 5, 'H1 duplicates': 15, 'Description duplicates': 30 },
};

// --- Now the developer fixes all 4 redirect chains. Nothing else changes. -----
const after = {
  pages: 45,
  criticals: { 'Title is missing': 6 },
  warnings:  { '4xx client errors': 5, 'H1 duplicates': 15, 'Description duplicates': 30 },
};

const b = websiteScore(before);
const a = websiteScore(after);

console.log('BEFORE  (10 criticals on site)');
console.log('  cost per critical type:', b.critCost);
console.log('  total points deducted :', b.deducted.toFixed(1));
console.log('  Website Score         :', b.score.toFixed(2));

console.log('\nAFTER   (fixed 4 redirect chains -> 6 criticals remain)');
console.log('  cost per critical type:', a.critCost);
console.log('  total points deducted :', a.deducted.toFixed(1));
console.log('  Website Score         :', a.score.toFixed(2));

const delta = a.score - b.score;
console.log('\nDELTA   :', delta.toFixed(2), delta < 0 ? '  <-- SCORE GOT WORSE' : '');
console.log('Monotonic under strict improvement?', delta >= 0 ? 'YES' : 'NO  *** FORMULA IS BROKEN ***');

// --- Invariant: the penalty budget is constant no matter how broken the site is
console.log('\nBudget invariance check (sum of all critical costs should always be 60):');
for (const scenario of [
  { 'a': 1 },
  { 'a': 5, 'b': 5 },
  { 'a': 1000, 'b': 2000, 'c': 9999 },
]) {
  const t = Object.values(scenario).reduce((x, y) => x + y, 0);
  const sum = Object.values(scenario).reduce((acc, n) => acc + (60 * n) / t, 0);
  console.log(`  ${JSON.stringify(scenario).padEnd(34)} totalCriticals=${String(t).padEnd(6)} sum(costs)=${sum.toFixed(1)}`);
}
