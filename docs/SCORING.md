# Website Score

Implemented in `packages/core/src/scoring/model.ts`. Rubric version `1.0.0`.

## Why not just copy Sitechecker

Their published formula divides each issue's cost by the site-wide count of issues at
that severity:

```
cost(criticalType) = (60 * countOfThatType) / totalCriticals
cost(warningType)  = (40 * countOfThatType) / totalWarnings
```

Run `node research/scoring-flaw-proof.mjs`. Three things fall out.

**It is non-monotonic.** Because every cost is relative to the total, removing one
issue type inflates the price of all the others. On Sitechecker's *own* worked example
(45 pages, 4 redirect chains + 6 missing titles, 50 warnings), fixing all four
critical redirect chains and changing nothing else moves the score **72.62 → 71.56**.
`Title is missing` jumps from 36 points to 60, so six pages now lose 60 each instead
of 36 — more than cancelling the 96 points recovered.

This is not a corner case. `node packages/core/src/scoring/demo.ts` fuzzes 2,000
random sites, removing one random issue from each: their formula lowers the score in
**348 of 2,000 trials (17%)**.

**The penalty budget is scale-invariant.** Critical costs always sum to exactly 60 and
warnings to exactly 40, whether the site has 1 defect or 12,999. Scores are therefore
not comparable between sites, and only weakly comparable between crawls.

**Frequency stands in for severity.** One 5xx on the homepage is "rare" and costs
almost nothing; 30 duplicate meta descriptions on tag archives are "common" and cost
24 points each. And `sum(OnePageScore)/pageCount` is an unweighted mean, so a broken
title on a 50k-impression page counts exactly as much as one on an orphaned tag page.

## The model

### Per-page

```
penalty(page) = Σ  SEVERITY_WEIGHT[issue.severity] × issue.confidence
score(page)   = 100 × exp( −penalty / 100 )
```

Weights are **constants**, never derived from crawl data — that is the whole fix:

| Severity | Weight | Single-issue page score |
|---|---:|---:|
| `blocker` | 120 | 30.1 |
| `critical` | 25 | 77.9 |
| `warning` | 7 | 93.2 |
| `opportunity` | 2 | 98.0 |
| `notice` | 0 | 100.0 |

`blocker` is a tier Sitechecker does not have: defects that make a page ineligible to
rank at all (5xx, noindex on a page meant to be indexed, canonical to a non-200, a
Suspense boundary that shipped a skeleton to Googlebot). Burying these among ordinary
criticals is what lets a fundamentally broken page score in the 60s.

Exponential decay rather than `100 − penalty` because it cannot go negative and has
natural diminishing returns — the 20th duplicate description matters less than the
first without ever becoming free — while remaining strictly decreasing, so
monotonicity holds.

`confidence` lets heuristic checks contribute proportionally. `next.render.unexpectedly-dynamic`
reports 0.7 because header evidence is strong but not proof; a check confirmed by a
real render pass reports 1.0.

### Per-site

```
weight(page) = 1 + 3 × normalisedPageRank + 6 × normalisedImpressions
score(site)  = Σ(score(p) × weight(p)) / Σ weight(p)  −  siteLevelPenalty
```

Every page keeps a floor weight of 1 so a site cannot inflate its score by
concentrating quality in one heavily-linked page, while a top page can weigh ~10× an
orphan. PageRank comes from the crawled internal link graph
(`scoring/pagerank.ts`, damping 0.85, dangling mass redistributed); impressions come
from Search Console when connected. With neither signal the model degrades gracefully
to the unweighted mean, which is what Sitechecker always computes.

The effect, measured:

| Scenario | This model | Sitechecker |
|---|---:|---:|
| Missing title on the 50k-impression homepage | 94.10 | 97.00 |
| Same missing title on a 100-impression tag page | 99.15 | 97.00 |

### Guarantees

1. **Monotonic** — fixing any issue strictly raises the score. 0 violations in 2,000
   fuzz trials, and it holds by construction since weights never depend on the crawl.
2. **Comparable** — fixed, versioned rubric. A score means the same thing across
   crawls, sites and time. Changing any weight requires a `RUBRIC_VERSION` bump, and
   the UI must never plot two rubric versions on one trend line.
3. **Weighted** — page importance is a first-class input.

## Impressions at risk

Alongside the 0–100 score, the model reports:

```
impressionsAtRisk = Σ impressions(p) × (1 − score(p)/100)
```

"18,277 of your 71,288 monthly impressions sit on pages with defects." A score of 65
does not survive contact with a stakeholder; that sentence does. No competitor
reports it, and it costs nothing once GSC is connected.
