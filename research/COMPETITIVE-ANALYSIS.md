# Sitechecker.pro — Crawl & Teardown

Crawled 2026-08-20. Sources: `robots.txt`, `sitemap_index.xml` (1,053 URLs),
179 `/site-audit-issues/*` how-to-fix guides (downloaded to `research/issues/`),
`help.sitechecker.pro` articles 18/70/81, and the dashboard export supplied by the user.

## 1. What they actually are

A WordPress marketing site (1,053 indexed URLs, 13 locales) in front of a SaaS app
at `/app/main/dashboard`. The SEO surface is deliberate: every single audit check has
its own long-form `/site-audit-issues/<slug>/` landing page. That is 179 pages in the
sitemap, all interlinked from the in-app issue list. **The how-to-fix content is the
customer-acquisition channel**, not a support afterthought.

Product surface beyond Site Audit: Website Monitoring, Rank Tracker, GSC Dashboard,
SEO Dashboard, AI Visibility Tracker (ChatGPT/Gemini/Perplexity), Website Migration
Checker, Bulk URL Checker, White Label, Chrome extension, API.

## 2. Check taxonomy — 15 categories, ~300 checks

From the dashboard export. Counts are `issues fired + checks passed`:

| Category | Checks | Notes |
|---|---:|---|
| indexability | 57 | largest category — canonical, robots, doctype/head/body structure |
| content relevance | 42 | title/desc/H1 presence, length, duplication, alt text |
| links | 36 | anchors, internal/external, nofollow, orphans, link counts |
| internal | 24 | URL hygiene, status codes, broken assets |
| localization | 23 | hreflang reciprocity, x-default, lang attribute |
| security | 18 | HTTPS, mixed content, headers, SSL, CAPTCHA |
| page speed | 16 | Lighthouse-derived + asset weight |
| duplicate content | 15 | title/H1/desc dupes, canonical loops |
| search traffic | 11 | GSC/GA cross-checks (needs integration) |
| mobile friendly | 11 | viewport tag variants — 7 of 11 are viewport permutations |
| redirects | 11 | chains, loops, trailing-slash, case normalization |
| code validation | 10 | doctype, W3C-ish, duplicate ids, PHP errors |
| xml sitemaps | 8 | non-200/noindex/canonicalized URLs in sitemaps |
| social media | 6 | OG + Twitter card completeness |
| **~288 + release-history additions ≈ 300** | | |

Severity tiers: **Critical** > **Warning** > **Opportunity** > **Notice**.
Only Criticals and Warnings affect the score. Notices/Opportunities are cosmetic —
which is why the sample dashboard shows 398 notices and a Website Score of 65.

Checks are split into **page-scope** (evaluated per URL during crawl) and
**site-scope** (evaluated after the full crawl completes: duplicates, orphans,
hreflang reciprocity, sitemap cross-checks, SSL, security headers). This split is
forced by the data dependencies and any clone has to replicate it.

## 3. Their scoring formula — and why it is broken

Published formula (help article 81):

```
cost(criticalType) = (60 * countOfThatType) / totalCriticals
cost(warningType)  = (40 * countOfThatType) / totalWarnings
OnePageScore       = 100 - sum(costs of that page's issues)
WebsiteScore       = sum(OnePageScore)/pageCount - siteLevelPenalties
```

`research/scoring-flaw-proof.mjs` implements it verbatim and demonstrates two defects.

### Defect 1 — the formula is non-monotonic

Using **Sitechecker's own worked example** (45 pages; criticals: 4 redirect chains +
6 missing titles; warnings: 5×4xx, 15×H1 dupe, 30×desc dupe):

```
BEFORE  fixing anything      Website Score = 72.62
AFTER   fixing all 4 redirect chains
                             Website Score = 71.56   <-- WORSE by 1.07
```

Because cost is divided by the *total* critical count, removing one error type
inflates the cost of every remaining type. `Title is missing` jumps from 36 points to
60. Six pages now lose 60 each (360) instead of 36 each (216), which more than
cancels the 96 points recovered from the redirect chains.

**A user who fixes real critical errors is punished for it.** This is not an edge
case; it fires whenever the fixed issue is not the most common one.

### Defect 2 — the penalty budget is scale-invariant

The sum of all critical costs is *always exactly 60*, and all warning costs *always
exactly 40*, regardless of error volume:

```
1 critical error total      -> sum(costs) = 60.0
10 critical errors total    -> sum(costs) = 60.0
12,999 critical errors      -> sum(costs) = 60.0
```

So a site with one broken canonical and a site with 13,000 broken canonicals
distribute an identical penalty pool. Score is therefore **not comparable between
sites, and only weakly comparable between crawls of the same site**.

### Defect 3 — frequency is used as a proxy for severity

A single 5xx on the homepage is "rare", so it costs almost nothing. 30 duplicate meta
descriptions on tag archives are "common", so they cost 24 points each. The formula
inverts business impact.

### Defect 4 — every page is worth the same

`sum(OnePageScore)/pageCount` is an unweighted mean. A missing title on a page with
50k monthly impressions and one on an orphaned tag archive move the number
identically. No SEO actually believes this.

**Conclusion: do not clone this formula.** Section 5 of `docs/SCORING.md` specifies
the replacement — fixed published weights (comparable across sites and time),
monotonic by construction, and weighted by page importance from internal PageRank +
GSC impressions.

## 4. The structural gap we exploit

Sitechecker, Ahrefs, Semrush, Screaming Frog and Sitebulb are all **black-box**
crawlers. They fetch URLs from outside and reason about the rendered HTML. For a
Next.js codebase this leaves the highest-value diagnostics unreachable:

- They see a page is slow. They cannot see it is `export const dynamic = 'force-dynamic'`.
- They see content missing from HTML. They cannot see it is a `'use client'` component
  fetching in `useEffect`.
- They see relative OG URLs. They cannot see the cause is a missing `metadataBase`.
- They see a trailing-slash redirect. They cannot see `trailingSlash` in `next.config`.
- They report post-hoc, after a bad deploy is already live and indexed.

None of them read `next.config`, the `app/` tree, or `.next/` build manifests, because
none of them have repo access. We do. See `docs/NEXTJS-EDGE.md`.

## 5. Things they do that we should copy outright

- **One landing page per check.** 179 pages of how-to-fix content is their organic
  moat. Our check registry should generate these from the same source of truth.
- **Page-scope / site-scope check split.** Correct architecture, forced by data deps.
- **"View issue in code"** — store the raw HTML snapshot and deep-link to the offending
  line. Extremely high perceived value, cheap to build if you persist snapshots.
- **Issue ignore + restore.** Every audit tool needs it or the list becomes noise.
- **Crawl-over-crawl diffing** ("appeared" / "fixed") and alerting on delta, not state.
- **Segments** (URL-pattern page groups). Essential above ~1k URLs.
