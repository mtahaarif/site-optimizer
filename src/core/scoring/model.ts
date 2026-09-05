/**
 * Scoring model.
 *
 * Replaces Sitechecker's published formula, which is demonstrably non-monotonic:
 * because it divides each issue's cost by the site-wide count of issues at that
 * severity, fixing one issue type inflates the price of every other type. Their
 * own worked example loses 1.07 points of Website Score when four critical
 * redirect chains are fixed. See research/scoring-flaw-proof.mjs.
 *
 * Three properties this model guarantees instead:
 *
 *  1. MONOTONIC   Fixing any issue strictly raises the score; introducing any
 *                 issue strictly lowers it. Weights are constants, never derived
 *                 from the crawl's own issue distribution.
 *  2. COMPARABLE  The rubric is fixed and versioned, so scores mean the same
 *                 thing across crawls, across sites, and across time.
 *  3. WEIGHTED    Pages are not equal. A missing title on a page with 50k
 *                 impressions outranks one on an orphaned tag archive.
 */

export type Severity = 'blocker' | 'critical' | 'warning' | 'opportunity' | 'notice';

/**
 * Fixed penalty points per issue, by severity. These are the rubric — they are
 * versioned with RUBRIC_VERSION and must never be computed from crawl data.
 *
 * This is a "Technical health" score: it measures how well-built and crawlable a
 * site is, not where it will rank (ranking needs content quality and off-site
 * authority, which this score deliberately does not claim to capture). The tiers
 * express a must-have → good-to-have gradient so the number is rigid without
 * being alarmist:
 *
 *   blocker      120   Must-have. The page cannot rank at all (5xx, noindex on a
 *                      page meant to be indexed, canonical to a non-200).
 *   critical      25   Must-fix. A real defect that materially hurts the page.
 *   warning        7   Should-fix. Worth doing; not urgent.
 *   opportunity    2   Good-to-have. A polish item with a small upside.
 *   notice       0.5   Cosmetic. Nice to tidy — it now counts a little (rather
 *                      than nothing) so a site can't reach a perfect 100 while
 *                      leaving them, but it can never meaningfully move the score.
 *
 * Cosmetic checks are kept, not deleted — they are just weighted so a hundred of
 * them together still weigh far less than a single must-fix.
 */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  blocker: 120,
  critical: 25,
  warning: 7,
  opportunity: 2,
  notice: 0.5,
};

// 1.1.0: cosmetic (notice) checks moved from weight 0 to 0.5 — a reduced,
// non-zero weight — and the score is presented as "Technical health". Bumped so
// the trend chart refuses to plot across the change rather than showing a jump.
export const RUBRIC_VERSION = '1.1.0';

/** Controls how fast the score decays with accumulated penalty. */
const DECAY = 100;

export interface PageIssue {
  checkId: string;
  severity: Severity;
  /** 0..1 — lets heuristic checks contribute proportionally to their certainty */
  confidence?: number;
}

export interface PageInput {
  url: string;
  issues: PageIssue[];
  /** Search impressions over the reporting window, when GSC is connected. */
  impressions?: number;
  /** GA4 sessions over the reporting window, when GA4 is connected. */
  sessions?: number;
  /** Internal PageRank in 0..1, from the crawled link graph. See pagerank.ts */
  pageRank?: number;
}

export interface SiteLevelIssue {
  checkId: string;
  severity: Severity;
}

export interface ScoredPage {
  url: string;
  score: number;
  penalty: number;
  weight: number;
  /** impressions sitting on a damaged page — the business-facing number */
  impressionsAtRisk: number;
  issues: PageIssue[];
}

export interface SiteScore {
  score: number;
  rubricVersion: string;
  pageCount: number;
  /** unweighted mean, for reference against tools that use one */
  meanPageScore: number;
  weightedPageScore: number;
  siteLevelPenalty: number;
  /** total search impressions landing on pages with defects */
  impressionsAtRisk: number;
  totalImpressions: number;
  pages: ScoredPage[];
}

/**
 * Penalty for one page: a plain weighted sum. No normalisation against other
 * pages or other issue types, which is precisely what keeps it monotonic.
 */
export function pagePenalty(issues: PageIssue[]): number {
  let total = 0;
  for (const i of issues) {
    total += SEVERITY_WEIGHT[i.severity] * (i.confidence ?? 1);
  }
  return total;
}

/**
 * Exponential decay maps unbounded penalty into (0, 100].
 *
 * Chosen over `100 - penalty` because it cannot go negative and it has natural
 * diminishing returns: the 20th duplicate meta description matters less than the
 * first, while never becoming free. Strictly decreasing in `penalty`, so
 * monotonicity is preserved.
 */
export function pageScore(issues: PageIssue[]): number {
  return 100 * Math.exp(-pagePenalty(issues) / DECAY);
}

/**
 * Page importance.
 *
 *   weight = 1 + 3·pageRank + 4·normalisedImpressions + 4·normalisedSessions
 *
 * Every page carries a floor of 1, so a site cannot inflate its score by
 * concentrating quality in one heavily-linked page; a top page can weigh
 * roughly 12x an orphan.
 *
 * Impressions and sessions are separate terms rather than one "traffic" term
 * because they measure different things and disagree usefully: a page with
 * sessions but no impressions is reached some other way (internal links, email,
 * direct), while impressions with no sessions means it is seen and not clicked.
 * Each independently makes a page worth protecting.
 *
 * Both are normalised against the site maximum, so the weighting is relative to
 * the site's own distribution and a low-traffic site is not scored as if every
 * page were unimportant.
 */
export function pageWeight(p: PageInput, maxImpressions: number, maxSessions = 0): number {
  const rank = p.pageRank ?? 0;
  const imp = maxImpressions > 0 ? (p.impressions ?? 0) / maxImpressions : 0;
  const ses = maxSessions > 0 ? (p.sessions ?? 0) / maxSessions : 0;
  return 1 + 3 * rank + 4 * imp + 4 * ses;
}

export function scoreSite(pages: PageInput[], siteIssues: SiteLevelIssue[] = []): SiteScore {
  const maxImpressions = pages.reduce((m, p) => Math.max(m, p.impressions ?? 0), 0);
  const maxSessions = pages.reduce((m, p) => Math.max(m, p.sessions ?? 0), 0);

  const scored: ScoredPage[] = pages.map((p) => {
    const penalty = pagePenalty(p.issues);
    const score = 100 * Math.exp(-penalty / DECAY);
    const impressions = p.impressions ?? 0;
    return {
      url: p.url,
      score,
      penalty,
      weight: pageWeight(p, maxImpressions, maxSessions),
      impressionsAtRisk: impressions * (1 - score / 100),
      issues: p.issues,
    };
  });

  const totalWeight = scored.reduce((s, p) => s + p.weight, 0);
  const weightedPageScore = totalWeight > 0
    ? scored.reduce((s, p) => s + p.score * p.weight, 0) / totalWeight
    : 100;
  const meanPageScore = scored.length
    ? scored.reduce((s, p) => s + p.score, 0) / scored.length
    : 100;

  // Site-level defects are absolute, not averaged: a missing robots.txt is one
  // fact about the site, not a property of any page.
  const siteLevelPenalty = siteIssues.reduce(
    (s, i) => s + SEVERITY_WEIGHT[i.severity] / 8,
    0,
  );

  return {
    score: Math.max(0, weightedPageScore - siteLevelPenalty),
    rubricVersion: RUBRIC_VERSION,
    pageCount: scored.length,
    meanPageScore,
    weightedPageScore,
    siteLevelPenalty,
    impressionsAtRisk: scored.reduce((s, p) => s + p.impressionsAtRisk, 0),
    totalImpressions: pages.reduce((s, p) => s + (p.impressions ?? 0), 0),
    pages: scored,
  };
}
