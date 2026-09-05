/**
 * Side-by-side: Sitechecker's published formula vs. this model, on Sitechecker's
 * own worked example — plus a randomised monotonicity fuzz test.
 *
 *   node packages/core/src/scoring/demo.ts
 */
import { scoreSite, pageScore, type PageInput, type PageIssue, type Severity } from './model.ts';
import { computePageRank } from './pagerank.ts';

// ---------------------------------------------------------------------------
// Sitechecker's formula, implemented verbatim from help article 81
// ---------------------------------------------------------------------------
function sitecheckerScore(pages: PageInput[]): number {
  const critCount = new Map<string, number>();
  const warnCount = new Map<string, number>();
  for (const p of pages) {
    for (const i of p.issues) {
      const m = i.severity === 'blocker' || i.severity === 'critical' ? critCount : warnCount;
      if (i.severity === 'notice' || i.severity === 'opportunity') continue;
      m.set(i.checkId, (m.get(i.checkId) ?? 0) + 1);
    }
  }
  const totalCrit = [...critCount.values()].reduce((a, b) => a + b, 0);
  const totalWarn = [...warnCount.values()].reduce((a, b) => a + b, 0);

  const cost = (id: string, sev: Severity): number => {
    if (sev === 'blocker' || sev === 'critical') {
      return totalCrit ? (60 * (critCount.get(id) ?? 0)) / totalCrit : 0;
    }
    if (sev === 'warning') {
      return totalWarn ? (40 * (warnCount.get(id) ?? 0)) / totalWarn : 0;
    }
    return 0;
  };

  const sum = pages.reduce(
    (acc, p) => acc + (100 - p.issues.reduce((s, i) => s + cost(i.checkId, i.severity), 0)),
    0,
  );
  return sum / pages.length;
}

// ---------------------------------------------------------------------------
// Sitechecker's example: 45 pages, 10 criticals, 50 warnings
// ---------------------------------------------------------------------------
function buildSite(withRedirectChains: boolean): PageInput[] {
  const pages: PageInput[] = [];
  const issue = (checkId: string, severity: Severity): PageIssue => ({ checkId, severity });

  for (let i = 0; i < 45; i++) {
    const issues: PageIssue[] = [];
    if (withRedirectChains && i < 4) issues.push(issue('redirect-chains', 'critical'));
    if (i >= 4 && i < 10) issues.push(issue('title-is-missing', 'critical'));
    if (i < 5) issues.push(issue('4xx-client-errors', 'warning'));
    if (i >= 5 && i < 20) issues.push(issue('h1-duplicates', 'warning'));
    if (i >= 15 && i < 45) issues.push(issue('description-duplicates', 'warning'));
    // homepage and top category carry the traffic
    const impressions = i === 0 ? 50_000 : i === 1 ? 12_000 : Math.max(0, 400 - i * 8);
    pages.push({ url: 'https://example.com/p' + i, issues, impressions });
  }
  return pages;
}

const before = buildSite(true);
const after = buildSite(false); // developer fixed all 4 redirect chains

const line = (s: string) => console.log(s);
line('='.repeat(72));
line('  Sitechecker\'s own example: fix 4 critical redirect chains, change nothing else');
line('='.repeat(72));

const scBefore = sitecheckerScore(before);
const scAfter = sitecheckerScore(after);
const ourBefore = scoreSite(before);
const ourAfter = scoreSite(after);

line('');
line('  SITECHECKER FORMULA');
line('    before : ' + scBefore.toFixed(2));
line('    after  : ' + scAfter.toFixed(2));
line('    delta  : ' + (scAfter - scBefore).toFixed(2) +
  (scAfter < scBefore ? '   <-- PENALISED FOR FIXING BUGS' : ''));

line('');
line('  THIS MODEL');
line('    before : ' + ourBefore.score.toFixed(2));
line('    after  : ' + ourAfter.score.toFixed(2));
line('    delta  : +' + (ourAfter.score - ourBefore.score).toFixed(2) + '   <-- rewarded, as it must be');
line('');
line('    impressions at risk  before: ' + Math.round(ourBefore.impressionsAtRisk).toLocaleString() +
  '  after: ' + Math.round(ourAfter.impressionsAtRisk).toLocaleString() +
  '   (of ' + ourBefore.totalImpressions.toLocaleString() + ' total)');
line('    unweighted mean      before: ' + ourBefore.meanPageScore.toFixed(2) +
  '  (weighted: ' + ourBefore.weightedPageScore.toFixed(2) + ')');

// ---------------------------------------------------------------------------
// Why page weighting matters: same issue, different page
// ---------------------------------------------------------------------------
line('');
line('='.repeat(72));
line('  Page importance: one missing title, moved between pages');
line('='.repeat(72));

const clean: PageInput[] = Array.from({ length: 20 }, (_, i) => ({
  url: 'https://example.com/p' + i,
  issues: [],
  impressions: i === 0 ? 50_000 : 100,
}));

const onMoneyPage = structuredClone(clean);
onMoneyPage[0]!.issues = [{ checkId: 'title-is-missing', severity: 'critical' }];

const onTagPage = structuredClone(clean);
onTagPage[19]!.issues = [{ checkId: 'title-is-missing', severity: 'critical' }];

line('    broken title on the 50k-impression homepage : ' + scoreSite(onMoneyPage).score.toFixed(2));
line('    broken title on a 100-impression tag page   : ' + scoreSite(onTagPage).score.toFixed(2));
line('    Sitechecker scores both identically         : ' +
  sitecheckerScore(onMoneyPage).toFixed(2) + ' / ' + sitecheckerScore(onTagPage).toFixed(2));

// ---------------------------------------------------------------------------
// Fuzz test: removing any issue must never lower the score
// ---------------------------------------------------------------------------
line('');
line('='.repeat(72));
line('  Monotonicity fuzz test (2000 random sites, remove one random issue)');
line('='.repeat(72));

const SEVERITIES: Severity[] = ['blocker', 'critical', 'warning', 'opportunity'];
let scFails = 0;
let ourFails = 0;
const TRIALS = 2000;

// deterministic PRNG so results are reproducible
let seed = 42;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

for (let t = 0; t < TRIALS; t++) {
  const pageCount = 3 + Math.floor(rnd() * 25);
  const site: PageInput[] = Array.from({ length: pageCount }, (_, i) => {
    const issueCount = Math.floor(rnd() * 4);
    const issues: PageIssue[] = Array.from({ length: issueCount }, () => ({
      checkId: 'check-' + Math.floor(rnd() * 6),
      severity: SEVERITIES[Math.floor(rnd() * SEVERITIES.length)]!,
    }));
    return { url: 'https://x.test/' + i, issues, impressions: Math.floor(rnd() * 5000) };
  });

  const withIssues = site.filter((p) => p.issues.length > 0);
  if (withIssues.length === 0) continue;

  // remove exactly one issue from one page — a strict improvement
  const target = withIssues[Math.floor(rnd() * withIssues.length)]!;
  const fixed = site.map((p) =>
    p === target ? { ...p, issues: p.issues.slice(1) } : p,
  );

  if (sitecheckerScore(fixed) < sitecheckerScore(site) - 1e-9) scFails++;
  if (scoreSite(fixed).score < scoreSite(site).score - 1e-9) ourFails++;
}

line('    Sitechecker formula : ' + scFails + ' / ' + TRIALS + ' trials where fixing a bug LOWERED the score');
line('    This model          : ' + ourFails + ' / ' + TRIALS + ' trials');
line('');
line(ourFails === 0
  ? '    PASS - monotonic across all trials'
  : '    FAIL - monotonicity violated');

// ---------------------------------------------------------------------------
// PageRank sanity check
// ---------------------------------------------------------------------------
line('');
line('='.repeat(72));
line('  Internal PageRank + orphan detection');
line('='.repeat(72));
const pr = computePageRank({
  nodes: ['/', '/about', '/blog', '/blog/a', '/blog/b', '/orphan'],
  edges: [
    ['/', '/about'], ['/', '/blog'], ['/about', '/'], ['/blog', '/'],
    ['/blog', '/blog/a'], ['/blog', '/blog/b'], ['/blog/a', '/blog'], ['/blog/b', '/blog'],
  ],
});
for (const [url, r] of [...pr.rank].sort((a, b) => b[1] - a[1])) {
  line('    ' + url.padEnd(12) + ' rank=' + r.toFixed(3) + '  inDegree=' + pr.inDegree.get(url));
}
line('    orphans: ' + JSON.stringify(pr.orphans) + '   (converged in ' + pr.iterations + ' iterations)');
line('');
line('    Note: single-issue page scores -> ' + SEVERITIES.map((s) =>
  s + '=' + pageScore([{ checkId: 'x', severity: s }]).toFixed(1)).join('  '));
