# SiteChecker

A search-visibility platform for Next.js sites, deployed on Vercel with
Postgres as its only infrastructure dependency. Seven modules over one
database:

1. **Site audit** — crawls any website and runs **332 checks** across 15
   categories, reporting every check pass *or* fail against a strict, published
   scoring rubric.
2. **Content quality grading** — an LLM editor reads each page's real text and
   scores depth, originality, trust and intent match. The one signal search
   engines actually rank on that markup cannot reveal.
3. **AI visibility / AEO** — whether ChatGPT, Claude, Perplexity and Google's AI
   answers can *reach*, *read* and *want to quote* your pages, proven per URL.
4. **Search & traffic insights** — Search Console and GA4, per page and per
   query, folded back into the audit as page importance.
5. **24/7 uptime monitoring** with incident tracking and free email alerts.
6. **Rank tracking** across Google, Bing, Yahoo and Yandex, by device and city,
   including the Google local map pack.
7. **Backlink monitoring** — still live? still dofollow? — with lost-link alerts.

Built as a replacement for [sitechecker.pro](https://sitechecker.pro) and, more
recently, measured against [MyAIO](https://app.myaio.com) — with full parity on
Sitechecker's reporting model, a scoring formula that fixes a proven defect in
theirs, an answer-engine layer neither competitor ships, and a Next.js check pack
no general-purpose crawler can produce.

**Minimal infrastructure.** No custom backend, no VPS, no queue, no cache
server, no native modules to compile. Storage is a single Postgres database —
provisioned in one click as Vercel Postgres (Neon) or pointed at any other
Postgres host. Scheduling is OS cron or GitHub Actions, both free.

---

## Table of contents

- [Quick start](#quick-start)
- [What it does](#what-it-does)
- [The dashboard](#the-dashboard)
- [Architecture](#architecture)
- [The check registry — all 332](#the-check-registry--all-332)
- [Do these checks actually move rankings?](#do-these-checks-actually-move-rankings)
- [Scoring](#scoring)
- [Content quality grading](#content-quality-grading)
- [AI visibility and answer-engine readiness](#ai-visibility-and-answer-engine-readiness)
- [Projects and trends](#projects-and-trends)
- [The Next.js pack](#the-nextjs-pack)
- [The crawler](#the-crawler)
- [Traffic: Search Console and GA4](#traffic-search-console-and-ga4)
- [View issue in code](#view-issue-in-code)
- [JavaScript rendering](#javascript-rendering)
- [Core Web Vitals](#core-web-vitals)
- [Storage — Postgres](#storage--postgres)
- [Deploying to Vercel](#deploying-to-vercel)
- [Uptime monitoring and alerts](#uptime-monitoring-and-alerts)
- [Rank tracking](#rank-tracking)
- [Backlink tracking](#backlink-tracking)
- [Scheduling](#scheduling)
- [Comparison to sitechecker.pro](#comparison-to-sitecheckerpro)
- [Comparison to MyAIO](#comparison-to-myaio)
- [What is still missing](#what-is-still-missing)
- [Known limitations](#known-limitations)
- [Project layout](#project-layout)
- [Development](#development)

---

## Quick start

```bash
npm install
cp .env.example .env.local   # set POSTGRES_URL — see Storage below
npm run dev                  # http://localhost:3000
```

The database migrates itself: the first request that touches it creates every
table. There is no separate migration command to remember.

Enter a URL, press **Run audit**. The crawl runs in-process and the page polls
for progress. When it finishes you get the score, every failing check with its
affected pages, every passing check, a page explorer and a link graph.

Headless, without the dashboard:

```bash
node scripts/cli.ts https://example.com 50     # url, max pages
```

The scheduled modules are scripts rather than dashboard actions — they write to
Postgres and the dashboard reads it, so results from a cron run or a GitHub
Actions run appear on the dashboard immediately:

```bash
# uptime
node scripts/monitor.ts --add https://example.com
node scripts/monitor.ts

# ranks (engine, device, country, city)
node scripts/ranks.ts --add https://example.com "seo audit tool" google mobile US "Austin,Texas,United States"
node scripts/ranks.ts

# backlinks
node scripts/backlinks.ts --import-csv https://example.com links.csv
node scripts/backlinks.ts https://example.com
```

Content grading needs exactly one model key — whichever you have:

```bash
GEMINI_API_KEY=...      # best free-tier headroom for page-sized prompts
GROQ_API_KEY=...        # fastest per call; free tier is token-throttled
ANTHROPIC_API_KEY=...   # strongest judgement; paid only
# LLM_PROVIDER=gemini|groq|anthropic   to force one
```

Diagnostics and proofs:

```bash
node src/core/nextjs/demo.ts https://your-site.com   # raw Next.js fingerprint
node src/core/scoring/demo.ts                        # scoring model + fuzz test
node research/scoring-flaw-proof.mjs                 # the Sitechecker formula defect
```

Requires **Node 22+** — the CLI scripts rely on native TypeScript stripping, so
`.ts` files run directly with no build step. Verified on Node 24.15.

---

## What it does

1. **Fetches `robots.txt`** and parses it with Google's matching semantics —
   longest matching pattern wins, `Allow` beats `Disallow` on ties, `*` and `$`
   wildcards supported.
2. **Discovers XML sitemaps** from robots.txt or the three conventional paths,
   follows sitemap indexes one level deep, records format errors.
3. **Crawls** breadth-first with bounded concurrency, following redirects
   manually so the full chain is recorded per URL.
4. **Fetches every page resource** (CSS, JS, images) to measure size and detect
   broken references.
5. **Analyses the whole crawl**: internal link graph, PageRank, orphan detection,
   duplicate title/H1/description/content indexes, TLS certificate, security
   headers, HTTP→HTTPS and www redirect behaviour, soft-404 probe.
6. **Runs all 332 checks** — each one against every page in its scope.
7. **Scores** every page and the site, weighted by internal PageRank and, when
   connected, by real Search Console impressions and GA4 sessions.
8. **Persists** the report to Postgres (summary columns plus the full JSON blob),
   with gzipped HTML snapshots for the code viewer.

Then, on demand and separately from the crawl:

9. **Grades content quality** per page with a model, stored per (crawl, page) so
   re-opening a report never re-spends.
10. **Evaluates answer-engine readiness** — live robots parse for 10 AI crawlers,
    server-vs-rendered text per page, llms.txt detection and generation.

A 12-page crawl of nextjs.org with resource fetching completes in about 6
seconds and retrieves 99 URLs in total (12 pages + 87 resources).

---

## The dashboard

Persistent vertical navigation, eight destinations.

### Dashboard (`/`)
Bento overview: run an audit, recent projects and their latest scores, registry
composition, and the configuration state of every integration.

### Projects (`/projects`, `/project/[id]`)
One website = one project, however many audits it has. Score and issue **trend
graphs with hover readouts**, change since the first audit, and the latest report
embedded in full. Add and delete projects.

### Crawl report (`/crawl/[id]`)
While running, a live phase tracker: robots → sitemaps → crawling → resources →
analysis → checks. When done, four tabs:

**Overview** — score dial, the four-pillar health rollup with a deterministic
narration, severity counts, crawl stats, Core Web Vitals, traffic card, Next.js
rendering strategy breakdown, "affected pages by category", and the crawl inputs
actually used.

**Issues** — every one of the 332, grouped by category exactly like Sitechecker.
Failing checks list affected page counts and expand to show the rationale, the
fix, the full affected-URL table, the traffic sitting on each affected page, and
a **View in code** button where a source position is resolvable. Passing and
skipped checks collapse behind a toggle so you can confirm what was verified.
Filterable by severity and searchable.

**Explorer** — every crawled page with status, title, word count, size, TTFB,
importance segment, rendering strategy, issue count and score.

**Graph** — force-directed internal link visualisation, node size = PageRank,
orphans ringed.

Plus `/crawl/[id]/compare` for crawl-over-crawl diffing and `/crawl/[id]/manage`
for generate-and-copy robots.txt and sitemap.

### Insights (`/insights`)
Search Console and GA4 connection cards with plain-English setup, top search
terms, top pages in search, most-visited pages, bounce and time on page.

### AI visibility (`/ai-visibility`)
Answer-engine readiness score over four pillars, the 10 AI crawlers and whether
each is allowed, per-page proof of what an answer engine sees without JavaScript,
quotable-page analysis, and llms.txt detection plus generation.

### Content (`/content`)
Per-page content grading: overall score plus depth, relevance, readability,
originality, trust and structure, with the model's verdict, strengths and up to
five specific fixes. Site averages per dimension show what a site is
systematically bad at.

### Ranks (`/ranks`)
Live position for a keyword + domain across Google, Bing, Yahoo and Yandex, plus
**local map-pack mode**. Every tracked keyword with movement since the previous
check, engine, device, location and ranking URL — plus the monthly API budget
with a usage bar per provider.

### Backlinks (`/backlinks`)
Active / lost / broken / unverified counts, dofollow vs nofollow split,
referring domain count, and the full link table with anchors.

### Schedule (`/schedule`)
Configuration status for every integration, database size and row counts, and
copy-paste cron / Task Scheduler / GitHub Actions setup generated with your real
paths.

---

## Architecture

Single Next.js app. The crawler runs inside a route handler in the Node runtime,
detached from the request so long crawls survive; the client polls for progress.

```
POST /api/crawl                 →  starts a job, returns { id } immediately
GET  /api/crawl/[id]            →  { status, progress, report }
DELETE /api/crawl/[id]          →  removes a stored report
GET  /api/crawl/[id]/snapshot   →  stored HTML around a finding
GET/POST /api/projects          →  project list / create
POST /api/content-grade         →  grade one page, persist the verdict
POST /api/rank                  →  one-off position check (web or local pack)
POST /api/rank/track            →  refresh tracked keywords
```

Job progress lives in Postgres (`crawl_jobs`), not in process memory: the
request that starts a crawl and the request that polls its progress are not
guaranteed to land on the same serverless instance, so anything held only in a
`Map` would be invisible to the poll as often as not. The crawl itself keeps
running past the point the response is sent via Next's `after()`, which is
what actually keeps a Vercel function alive for that work — an un-awaited
promise alone is not a guarantee of that on a serverless runtime. Finished
reports land in `crawls` and survive indefinitely.

```
                    ┌──────────────────────────┐
   URL ─────────▶   │  src/crawler/crawl.ts    │
                    │  frontier · robots ·     │
                    │  sitemaps · redirects    │
                    └────────────┬─────────────┘
                                 │ PageData[]
                    ┌────────────▼─────────────┐
                    │  src/core/extract.ts     │
                    │  one parse pass per page │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │  post-crawl analysis     │
                    │  PageRank · duplicates · │
                    │  TLS · security headers  │
                    └────────────┬─────────────┘
                                 │ SiteData
                    ┌────────────▼─────────────┐
                    │  checks/registry.ts      │
                    │  332 checks × scope      │
                    └────────────┬─────────────┘
                                 │ CheckOutcome[]
                    ┌────────────▼─────────────┐
                    │  scoring/model.ts        │
                    │  page + site score       │
                    └────────────┬─────────────┘
                                 │ AuditReport
                              dashboard
                                 │
              ┌──────────────────┴──────────────────┐
              ▼                                     ▼
    core/content/grade.ts                  core/aeo/analyze.ts
    LLM page-quality verdict               crawler access · JS gap ·
    stored per (crawl, page)               llms.txt · quotability
```

Content grading and AEO analysis deliberately sit **downstream** of the audit
rather than inside it. Grading costs money per call and AEO needs live fetches of
`robots.txt` and `llms.txt`; neither belongs on the hot path of a crawl.

**Why one parse pass.** `extract.ts` turns a response into a fully populated
`PageData` record — links with rel/anchor/position, images with dimensions,
headings with nesting, forms, tables, duplicate ids, DOM depth and width, all
meta and structural tag counts. Every check reads only from that record. This is
what keeps 332 check definitions down to a handful of lines each and parsing cost
to O(pages) rather than O(pages × checks).

**Why page scope and site scope are separate.** Duplicate detection, orphan
detection, hreflang reciprocity and PageRank are undefined until the frontier is
empty. `scope` is a discriminated field on the check type, not a convention, so
the runner can enforce the ordering.

---

## The check registry — all 332

| Category | Checks | What it covers |
|---|---:|---|
| Indexability | 59 | canonical (19 checks), robots directives, document structure, blocked resources |
| Content Relevance | 43 | title/description/H1 presence, length, case; word count; alt text; freshness |
| Links | 34 | internal/external counts, anchors, rel attributes, broken targets, 4 orphan classes |
| Internal | 25 | status codes, URL hygiene, query parameters, broken resources, GTM |
| Localization | 23 | hreflang validity, reciprocity, x-default, conflicting annotations |
| Page Speed | 22 | Core Web Vitals from PSI, payload sizes, DOM metrics, image formats, cache policy |
| Search Traffic | 22 | GSC + GA4 cross-checks: traffic-weighted defects, tracking validation |
| Security | 18 | mixed content, insecure forms, TLS, CSP/frame/nosniff headers |
| Duplicate Content | 17 | title/H1/description/body duplicates, canonical loops, technical duplicates |
| **Next.js** | **15** | **rendering strategy, RSC payload, next/image, next/font, metadataBase** |
| Redirects | 12 | chains, loops, self-redirects, trailing slash, case normalisation, meta refresh |
| XML Sitemaps | 12 | non-200/noindex/canonicalised/disallowed URLs in sitemaps, format, size |
| Mobile Friendly | 11 | seven distinct viewport failure modes, image maps, legacy plugins |
| Code Validation | 11 | doctype, heading hierarchy, duplicate ids, tables, inline styles, JS console errors |
| Social Media | 8 | Open Graph and Twitter card completeness and correctness |
| **Total** | **332** | |

**By severity:** 21 blocker · 103 critical · 102 warning · 12 opportunity · 94 notice
**By scope:** 295 page-scope · 37 site-scope
**Gated:** 15 require Next.js · 11 require Search Console

### Check anatomy

Every check is a declarative object. The registry is the single source of truth
for the runner, the scoring input, and the documentation pages.

```ts
pageCheck({
  id: 'canonical-points-homepage',
  title: 'Canonical points to homepage',
  category: 'duplicate-content',
  severity: 'critical',
  why: 'A common template bug: every page canonicalises to the homepage, so the '
     + 'entire site collapses to one indexable URL.',
  fix: 'Make canonicals self-referencing per page. Check for a hardcoded site '
     + 'URL in a shared layout.',
  // optional: restrict the denominator. Default is HTML pages returning 200.
  appliesTo: (p) => p.isHtml && p.status === 200,
  // false/null = pass. true = fail. string = fail, with detail shown in the UI.
  test: (p, site) => {
    if (!p.canonical) return false;
    const isHome = normalizeUrl(p.finalUrl) === normalizeUrl(site.homepageUrl);
    return !isHome && normalizeUrl(p.canonical) === normalizeUrl(site.homepageUrl);
  },
})
```

Returning a **string** rather than `true` is how per-page detail reaches the UI
("192 internal links", "226 KB = 62% of the response"). Duplicate check ids throw
at module load rather than silently shadowing in the report.

### Pass, fail, skip

The runner evaluates **every** check against **every** page in its scope, so the
report can state what was verified, not only what broke:

- **failed** — at least one page in scope triggered it
- **passed** — evaluated against ≥1 page, none triggered it
- **skipped** — nothing in scope (no hreflang on the site), or a precondition is
  missing (Search Console not connected, not a Next.js site), or the user has
  ignored it for this project, or the check threw

A throwing check is recorded as skipped with its error rather than aborting the
audit. One bad regex must not cost you an entire report.

---

## Do these checks actually move rankings?

This is the uncomfortable question and it deserves a straight answer, because
"332 checks" is a marketing number until you say what each one is worth. Google
publishes no weightings, so the tiering below is analysis, not documentation.
Every check in the registry was classified; the counts are exact.

| Tier | What it covers | Count | Effect on ranking |
|---|---|---:|---|
| **A · Ranking-relevant or diagnostic** | Title/H1 presence, content substance, HTTPS, mobile viewport, Core Web Vitals and payload weight, internal link equity and the four orphan classes, plus the 22 GSC/GA4 checks that read real position and traffic. | **85** | Direct signal, or ground truth about live performance. |
| **B · Crawl and index prerequisites** | Canonical, robots directives, noindex, status codes, redirect chains and loops, sitemap hygiene, broken resources, document structure, Next.js render correctness. | **131** | **Gate, not boost.** Fixing them removes a blocker; it does not lift you above a rival who never had the problem. |
| **C · SERP appearance and CTR** | Title and description *length*, Open Graph, Twitter cards, structured-data format detection. | **19** | Clicks, not rank. Meta description has not been a ranking factor for years. |
| **D · Situational** | Localisation and hreflang. | **23** | Decisive for multi-region sites, irrelevant for single-locale ones. |
| **E · Cosmetic / hygiene** | Lowercase first letters, "no list markdown", "server hides its version", `H1 = Title`, `>10 external links`, underscores in URLs, table captions, inline style attributes. | **74** | No measurable effect. Weighted 0.5 so a hundred of them cannot distort the number. |

Narrower still: of the 85 in tier A, roughly **30** map to something Google has
publicly confirmed as a ranking input — HTTPS, mobile-friendliness, the page
experience / Core Web Vitals set, and having indexable, substantive content with
a title and a main heading. The other ~55 are correlates and diagnostics. That is
the honest ceiling of what any crawler can tell you.

**Three consequences this project acts on:**

1. **The headline number is called "Technical health", not an SEO score.** It
   measures how well a site is built and how cleanly it can be crawled and
   indexed. A perfect 100 predicts nothing about position.
2. **Cosmetic checks are kept but weighted at 0.5.** They are deleted from
   nobody's report — you asked for parity — but a single must-fix outweighs fifty
   of them. See [Scoring](#scoring).
3. **The two factors that actually decide rankings are measured separately.**
   Content quality now has [its own module](#content-quality-grading) with a real
   model reading real text. Off-site authority still does not — see
   [What is still missing](#what-is-still-missing).

---

## Scoring

Full detail in [`docs/SCORING.md`](docs/SCORING.md). Rubric version **`1.1.0`**.

### Why not copy Sitechecker's formula

Sitechecker publishes theirs. It divides each issue's cost by the site-wide count
of issues at that severity:

```
cost(criticalType) = (60 × countOfThatType) / totalCriticals
cost(warningType)  = (40 × countOfThatType) / totalWarnings
```

That denominator makes the formula **non-monotonic**. Run
`node research/scoring-flaw-proof.mjs`: using **Sitechecker's own worked example**
(45 pages, 4 redirect chains + 6 missing titles), fixing all four critical
redirect chains and changing nothing else moves the score **72.62 → 71.56**.
`Title is missing` inflates from 36 points to 60, so six pages now lose 60 each
instead of 36 — more than cancelling the 96 points recovered.

`node src/core/scoring/demo.ts` fuzzes 2,000 random sites, removing one random
issue from each. Their formula lowers the score in **348 of 2,000 trials (17%)**.
Ours: **0**.

Two further consequences of the same denominator: critical costs always sum to
exactly 60 whether the site has 1 defect or 12,999 (so scores aren't comparable
between sites), and frequency substitutes for severity (one homepage 5xx is
"rare" and nearly free; 30 duplicate descriptions on tag archives cost 24 points
each).

### The model

```
penalty(page) = Σ SEVERITY_WEIGHT[severity] × confidence
score(page)   = 100 × exp( −penalty / 100 )
weight(page)  = 1 + 3·pageRank + 4·normalisedImpressions + 4·normalisedSessions
score(site)   = Σ(score × weight) / Σ weight − siteLevelPenalty
```

Weights are **published constants**, never derived from crawl data — that is the
whole fix:

| Severity | Weight | Page score with one such issue | Reserved for |
|---|---:|---:|---|
| `blocker` | 120 | 30.1 | must-have — the page cannot rank at all: 5xx, noindex on a page meant to be indexed, canonical to a non-200, skeleton served to Googlebot |
| `critical` | 25 | 77.9 | must-fix — a real defect that materially hurts the page |
| `warning` | 7 | 93.2 | should-fix — worth doing, not urgent |
| `opportunity` | 2 | 98.0 | good-to-have — polish with a small upside |
| `notice` | 0.5 | 99.5 | cosmetic — counts a little, so a site cannot reach a perfect 100 while leaving them, but can never meaningfully move the number |

`blocker` is a tier Sitechecker does not have. Burying "Googlebot indexed your
loading skeleton" among ordinary criticals is how a fundamentally broken page
still scores in the 60s.

Cosmetic checks moved from weight 0 to 0.5 in rubric **1.1.0**, and the score was
relabelled **Technical health**. The version was bumped so the trend chart
refuses to plot across the change rather than drawing a phantom jump.

Exponential decay rather than `100 − penalty` because it cannot go negative and
gives natural diminishing returns — the 20th duplicate description matters less
than the first without ever becoming free — while staying strictly decreasing, so
monotonicity holds by construction.

### Page importance

Pages are not equal. Weight comes from internal PageRank over the crawled link
graph (damping 0.85, dangling mass redistributed), plus Search Console
impressions and GA4 sessions as **separate** terms when connected — a page with
sessions but no impressions is reached some other way; impressions with no
sessions means it is seen and not clicked. Both normalise against the site
maximum, so a low-traffic site is not scored as if every page were unimportant.
Every page keeps a floor weight of 1, so a site cannot inflate its score by
concentrating quality in one heavily-linked page; a top page can weigh ~12× an
orphan.

Measured — the identical missing-H1 defect, moved between pages:

| Where the defect is | Site score |
|---|---:|
| On the money page (20k impressions, 7k sessions) | **79.9** |
| On a dead page (0 impressions, 0 sessions) | **98.0** |

An 18-point spread from the same defect. That is the whole point of the model.

### The four pillars

Alongside the single number, the report rolls the same outcomes into Content /
Authority / Technicals / UX — the dimensions a non-specialist owner reads —
severity-weighted rather than counted, with a deterministic one-line narration
that needs no model key. Where Search Console is connected, the Authority pillar
says so; where it is not, it says exactly what is missing rather than showing a
confident 100.

### Guarantees

1. **Monotonic** — fixing any issue strictly raises the score. 0 violations in
   2,000 fuzz trials, and it holds by construction.
2. **Comparable** — fixed, versioned rubric. Changing any weight requires a
   `RUBRIC_VERSION` bump, and the report records which version produced it.
3. **Weighted** — page importance is a first-class input.

### Why scores look low

The rubric is strict, deliberately. A real crawl of nextjs.org scores in the
20s — it has a genuine blocker (unresolved Suspense boundaries on 10 of 12
pages), 226 KB of RSC payload per page, and dozens of notice-level findings.
Sitechecker and MyAIO both score the same class of site far higher because
notices never move their numbers and neither has a blocker tier. All the numbers
are internally consistent; ours is harsher on purpose.

We also dogfood it: auditing this app's own dashboard took it from **15.7 → 36.6**
after fixing four self-inflicted SEO bugs, and surfaced a genuine crawler defect
(pages keyed by requested URL but stored by final URL, so every redirect or
trailing-slash alias was stored twice and reported as a duplicate *of itself*).
That bug was inflating duplicate-content findings on every site audited.

---

## Content quality grading

Every other check in this project measures whether a page is *built* well. This
one measures whether it is *worth reading* — the thing search engines' helpful
content systems actually rank on, and the one signal markup cannot reveal.

A model reads the page's real body text (chrome stripped, capped at 18k
characters) and returns a strict JSON verdict via structured outputs:

| Dimension | What it asks |
|---|---|
| `intent` | In one phrase, what question is this page trying to answer? |
| `depth` | Does it actually answer it, with specifics, or is it filler? |
| `relevance` | Does the content match the intent the title and headings promise? |
| `readability` | Clear sentences, sensible structure, scannable? |
| `originality` | Information gain — does it say anything a competitor page would not? |
| `trust` | Evidence of first-hand expertise: specifics, data, named people, citations |
| `structure` | Headings, lists and direct answers a search engine can lift |
| `overall` | Weighted toward depth and originality |

Plus a one-sentence plain-English verdict, up to 3 genuine strengths, and up to 5
**specific** prioritised fixes ("name the section or the missing fact" — the
prompt explicitly forbids "add more keywords").

The judge is told most of the web is mediocre and should land in the 40s and 50s,
that 80+ is reserved for content that is genuinely hard to replace, and that
length is never rewarded on its own.

**Three providers, one code path.** Gemini and Groq both speak the OpenAI
chat-completions shape and share an implementation; Anthropic uses its own SDK
with structured outputs. Whichever key is present is used, in that preference
order, overridable with `LLM_PROVIDER`. Nothing throws — a grading failure is a
readable message on screen, not a 500. Model ids are aliases that resolve to the
current generation, because pinned ids get retired and would break grading
silently.

**Grades are stored per (crawl, page).** A model call costs money; re-opening a
report must never re-spend. JSON mode guarantees valid JSON but not the right
shape, so every response is validated against a Zod schema before it is used.

**What it does *not* yet do:** feed the site score. Content quality is the
single biggest ranking factor and it currently lives on its own page and inside
the AI-readiness score, not inside Technical health. Folding it in is a
deliberate pending decision — see [What is still missing](#what-is-still-missing).

---

## AI visibility and answer-engine readiness

The half of "AI visibility" that is a technical *fact* rather than a
measurement: whether answer engines are allowed in, whether the content exists
without JavaScript, whether there is an llms.txt, and whether pages are shaped so
a model can lift an answer.

### The crawlers that decide whether you can be cited

robots.txt is parsed with Google's precedence rules — a group naming the agent
beats the `*` group outright, longest matching pattern wins within a group, and
`Allow` breaks ties — then evaluated per user-agent:

| Agent | What blocking it costs you | Critical |
|---|---|---|
| `OAI-SearchBot` | Being shown and cited inside ChatGPT | ✅ |
| `GPTBot` | OpenAI reading your pages at all | ✅ |
| `ChatGPT-User` | ChatGPT opening your page when a user asks | ✅ |
| `ClaudeBot` | Anthropic reading and citing your pages | ✅ |
| `PerplexityBot` | Appearing as a Perplexity source | ✅ |
| `Google-Extended` | Being used in Google's AI answers / AI Overviews | ✅ |
| `Applebot-Extended` | Apple Intelligence using your content | |
| `meta-externalagent` | Meta's assistant using your content | |
| `CCBot` | The open dataset many models train on | |
| `Amazonbot` | Amazon's assistant reading your pages | |

### The readiness score

Four pillars, weighted by how decisively each blocks a citation, and scored only
over what has actually been measured — an ungraded site is not punished for a
pillar that was never run:

| Pillar | Max | Measures |
|---|---:|---|
| **Reachable** | 30 | Share of the six critical answer engines robots.txt allows |
| **Readable** | 25 | Share of pages whose content exists in the *server* response |
| **Understandable** | 15 | llms.txt present (7) + share of pages well-formed enough to answer from (8) |
| **Worth quoting** | 30 | Average content-quality grade across graded pages |

The **Readable** pillar is the one no generic SEO tool produces. The crawler
already records the body text present in the server response separately from the
post-render word count, so a page that only assembles itself in the browser is
provably invisible to an answer engine — and the finding names the worst URL with
the exact share of its words that survive: *"only 12% of its words are in the
page an AI receives."*

### llms.txt

Detected if present, and **generated** from the crawl if not: the site name and
summary come from the homepage title and description, and the page list is the
top 25 by internal PageRank — the file writes itself because the crawl already
ranks every page by importance. Copy or download from the dashboard.

For contrast: MyAIO's own robots screen currently reads *"New: LLMs.txt — Coming
Soon"*, and no AI-visibility module appears anywhere in its dashboard.

---

## Projects and trends

One website is one project, however many audits it has. `/projects` lists them
with the latest score; `/project/[id]` shows score and issue-count trend graphs
with hover readouts, the change since the very first audit, and the latest report
embedded in full.

Trend charts refuse to plot across a `RUBRIC_VERSION` boundary. A rubric change
alters what the number means, and drawing a continuous line through it would show
a jump the site never experienced.

`/crawl/[id]/compare` diffs two crawls of the same site directly.

---

## The Next.js pack

15 checks that no general-purpose crawler can produce, because they require
understanding what Next.js emits. Full detail in
[`docs/NEXTJS-EDGE.md`](docs/NEXTJS-EDGE.md).

The fingerprint (`src/core/nextjs/detect.ts`) recovers, from headers and raw
HTML alone:

| Signal | What it establishes |
|---|---|
| `__NEXT_DATA__.gssp` / `.gsp` | SSR vs SSG — definitive, straight from the payload |
| `x-nextjs-cache: HIT/STALE` | ISR, served from the Next data cache |
| `x-vercel-cache` | prerendered and edge-cached |
| `cache-control: s-maxage=N` | ISR revalidate window |
| `self.__next_f.push` | App Router, and flight payload size |
| `<template id="B:n">` without `$RC` | Suspense boundary that never resolved |
| `data-nimg` | next/image managed, or a raw `<img>` that slipped through |
| `__className_*` hashes | next/font self-hosting vs a blocking Google Fonts link |
| `?dpl=` / `x-nextjs-deployment-id` | build identity, for deploy-triggered recrawls |

### The subtlety that matters

React opens a pending Suspense boundary as `<!--$?-->` plus
`<template id="B:n">`, then later flushes content and calls `$RC("B:n","S:n")` to
swap it in. **Testing for the pending marker alone flags every streamed page as
broken.** Only a boundary with no matching `$RC` is a real finding — the
difference between "this page streams" (fine) and "Googlebot indexed your loading
skeleton" (blocker).

Verified live: nextjs.org has 3 genuinely unresolved boundaries; vercel.com and
ui.shadcn.com resolve all of theirs.

A related subtlety in the structural checks: React's streaming completion flushes
a **second `</body></html>` pair** after a client-render bailout. Counting raw
occurrences reports every streamed Next.js page as critically malformed. The
duplicate-closing-tag checks discount a repeat when only scripts and whitespace
sit between the two occurrences.

### What the pack catches

`next.render.unresolved-suspense` (blocker) · `next.render.client-only-content`
(blocker) · `next.render.unexpectedly-dynamic` (critical) ·
`next.render.strategy-summary` (critical) · `next.image.raw-img-tag` ·
`next.image.lcp-not-prioritised` · `next.image.fill-without-sizes` ·
`next.image.unoptimized` · `next.font.external-blocking` ·
`next.payload.rsc-bloat` · `next.payload.props-bloat` · `next.script.blocking` ·
`next.metadata.relative-og-image` · `next.build.drift-during-crawl` ·
`next.router.mixed`

The point throughout: a generic crawler reports **"text to code ratio < 10%"**.
This reports **"226 KB of RSC flight payload is 62% of your HTML because you
forward whole CMS objects across the server/client boundary."** Same symptom,
named cause, actionable fix.

The render-strategy data is also what makes the AEO JavaScript analysis possible
in the first place — knowing a route renders per request with no per-request
content is the same fact that predicts an answer engine seeing nothing.

---

## The crawler

| Behaviour | Implementation |
|---|---|
| Frontier | breadth-first, `maxPages` and `maxDepth` bounded, seeded from the start URL plus every sitemap URL |
| Concurrency | fixed-size batches (default 6, max 16) |
| Redirects | followed **manually** up to 10 hops so every hop is recorded per URL |
| robots.txt | Google matching semantics; blocked URLs are still recorded so the "Disallowed by robots.txt" check can fire |
| Scope | same registrable host by default; `includeSubdomains` opt-in; www/non-www treated as one site |
| Page identity | pages are keyed and stored under the **same** normalised URL, so a redirect or trailing-slash alias is one page, not two |
| Resources | up to 400 CSS/JS/image URLs fetched, body discarded after measuring transferred bytes |
| Timeouts | per-request `AbortController`, default 20s, recorded as a `timedOut` finding |
| URL identity | `normalizeUrl` — lowercase host, no fragment, no trailing slash, default ports stripped |
| Probes | soft-404 (random URL), HTTP→HTTPS redirect, www/non-www redirect, TLS certificate via `node:tls` |

Resource fetching overwrites `Content-Length` with the actual transferred byte
count, because that header is frequently absent under chunked encoding.

---

## Traffic: Search Console and GA4

Both integrations share one service-account JWT implementation
(`src/core/gsc/auth.ts`) — the same code the backlink seeder already used, now
extracted so there is one implementation rather than two that drift. Only the
OAuth scope differs.

| | Search Console | GA4 |
|---|---|---|
| Measures | acquisition: who arrived from search | behaviour: what they did next |
| Endpoint | `searchAnalytics/query` | `properties/{id}:runReport` |
| Dimension | `page`, and `query` for top search terms | `pagePath` |
| Metrics | clicks, impressions, CTR, position | sessions, users, pageviews, conversions, bounce rate, duration |
| Window | trailing 28 days, ending 3 days back | trailing 28 days, ending yesterday |
| Cache | indefinite once finalised | 24 hours |
| Env | `GSC_SITE_URL` | `GA4_PROPERTY_ID` (numeric, not the G- measurement id) |

They are shown side by side in the dashboard rather than merged into one
"traffic" number, because where they disagree is usually the interesting part.

### Two details that matter

**Search Console's end date is three days back, deliberately.** GSC finalises
data with a two-to-three day lag, so a window ending today is always incomplete
and its numbers change under you. Defaulting the end date back three days makes
the range final — which is also why a finalised range is cached indefinitely
while a range touching the lag window expires after six hours.

**GA4 reports `/a` and `/a/` as separate rows.** Normalising the path collapses
them, so metrics must be *summed* rather than the second row overwriting the
first — and the rate metrics (bounce, duration) must be re-averaged by session
weight, not summed. There is a test asserting exactly this.

### The search-traffic checks

These were `test: () => false` stubs — the category existed for parity but could
never fire. They are real implementations now, and each joins a technical fact to
a business one:

| Check | Severity | Fires when |
|---|---|---|
| `4xx-with-clicks` | **blocker** | users are clicking through to a page that does not exist |
| `non-indexable-with-impressions` | critical | demand exists and the page is suppressed |
| `blocked-with-impressions` | critical | Google shows a URL it cannot crawl |
| `orphan-with-impressions` | critical | performing despite the site structure, not because of it |
| `high-impressions-missing-title` | critical | Google is writing the headline for a page already earning impressions |
| `canonicalized-with-clicks` | warning | ranking despite being told not to |
| `not-in-sitemap-with-impressions` | warning | performing but not prioritised for crawling |
| `high-impressions-low-ctr` | opportunity | ranks well, rarely clicked — a snippet problem |

Plus six GA4 cross-validation checks:

| Check | Severity | Fires when |
|---|---|---|
| `traffic.ga4.high-traffic-with-blocker` | **blocker** | top-decile traffic on a fundamentally broken page |
| `traffic.ga4.tracking-tag-detected` | critical | GA4 reports sessions but no tag is in the server HTML |
| `traffic.ga4.converting-page-with-defects` | critical | defects on a page that converts |
| `traffic.uncrawlable-urls-with-traffic` | critical | analytics knows URLs the crawl never reached |
| `traffic.ga4.orphaned-with-traffic` | warning | real sessions, zero internal links |
| `traffic.ga4.high-bounce-rate` | opportunity | over 75% bounce *and* slow — either alone is noise |

`traffic.uncrawlable-urls-with-traffic` was not planned. The test fixture
exposed it: a page can carry real traffic and be entirely absent from the crawl,
which the per-page checks structurally cannot report because no `PageData`
exists for it. That absence is itself the finding.

### Verifying

```bash
node scripts/test-traffic.ts    # 40 assertions, both Google APIs mocked
```

Covers path normalisation, duplicate-path summing, every GA4 check, Postgres cache
hits on re-audit, the weighting formula, the score spread above, and graceful
degradation when neither source is configured.

---

## View issue in code

Every failing page-level finding with an identifiable source position gets a
**View in code** button, which opens the exact line of HTML that caused it —
with the offending line highlighted and the matched text underlined.

```
line 13 of 18 · matched second <h1>
  12 │ <p>Representative body copy…</p>
▌ 13 │ <h1>A second H1 which should not exist</h1>
  14 │ <img src="/photo.jpg">
```

### Why locators live outside the checks

The obvious design — have each check report where it found the problem — is the
wrong one. Checks are predicates over a parsed `PageData`; they never touch raw
markup. Threading a source position through all of them would roughly double
their size and couple every one to the HTML string they were designed to avoid.

So position is resolved separately, in `src/core/checks/locate.ts`, keyed by
check id. Each locator is a small search over the stored HTML answering "show me
the thing this check is complaining about":

```ts
'multiple-h1':      (h) => findNth(h, /<h1[^>]*>/i, 2, 'second <h1>'),
'missing-alt-text': (h) => findTagMissingAttr(h, 'img', 'alt', '<img> without alt'),
'title-is-missing': (h) => headOpen(h),   // point at <head>, where it should be
```

Note `multiple-h1` resolving to the **second** heading, not the first — the
locator answers the check's actual complaint rather than pointing at the first
matching tag.

**137 of 332 checks have a locator.** The rest genuinely have no source
position: site-level facts (SSL validity, robots.txt rules), PageSpeed metrics,
Search Console cross-checks. For those the button is hidden rather than opening
an empty panel.

### Storage

Raw HTML is gzipped and stored in `page_snapshots`, keyed by crawl id and
normalized URL. Measured compression on real pages is 10–25%; on repetitive
markup far better.

Snapshots are deliberately **not** attached to `AuditReport`. The report is read
whole on every dashboard view, and megabytes of markup in that payload would
make the page unusable. They are fetched one URL at a time, only when a code
view is actually opened, and dropped with their crawl on delete.

### The endpoint

```
GET /api/crawl/[id]/snapshot?url=<encoded>&checkId=<id>&context=6
```

By default it resolves the position server-side and returns **only the
surrounding lines** — shipping a 700 KB document to render eleven lines would
repeat, per code view, the exact payload problem that keeps HTML out of the
report. `?raw=1` returns the full HTML for callers that want it.

### Offsets are UTF-16 units, not bytes

`getSnippetFromOffset` counts in the same units `String.prototype` uses. Every
offset producer here is a regex or `indexOf` over the same string, so the units
agree end to end. Mixing in a true byte offset would drift silently on any page
containing non-ASCII — there is a test for exactly that.

### Verifying

```bash
node scripts/test-code-view.ts    # 42 assertions
```

Covers line/column resolution, edge clamping, minified single-line documents,
non-ASCII offsets, ten locators against real markup, orphan-locator detection
(a locator whose check id no longer exists), the gzip roundtrip, normalized-URL
lookup, and cascade delete.

---

## JavaScript rendering

Rendering costs 50–100× a raw fetch, so it is a conditional path, not the
default. Raw HTML fetching stays the fast path for SSR/SSG — where rendering
changes nothing — and headless Chromium handles client-rendered SPAs, where it
changes everything.

```bash
node scripts/cli.ts https://spa-example.com 50 --render-js
```

Or the **Enable JavaScript rendering (Playwright)** toggle under crawl settings.

### What it costs, measured

Against a fixture SPA whose links exist only in the bundle:

| Path | Pages found | Title | H1 | Time |
|---|---:|---|---|---:|
| raw | **1** | `Loading…` | none | 0.1s |
| `--render-js` | **3** | `SPA Fixture — Home` | `Client Rendered Home Page` | 2.3s |

The page count is the point. On the raw path the crawler cannot discover
`/about` or `/pricing` at all, because those links do not exist until the bundle
runs. A real Next.js SSG crawl is unaffected: 104 URLs in 10.7s, unchanged.

### How it stays fast

- **One browser and one context per crawl job**, with a page created and closed
  per URL. Launching a browser per URL is the classic mistake.
- **Aggressive request blocking** via `page.route()` — images, fonts, media and
  a blocklist of analytics hosts. None affect the extracted DOM; all dominate
  render time.
- **Guaranteed teardown** in a `finally` that wraps the entire crawl body, so a
  thrown error or an abort still closes Chromium. Verified: process count is
  identical before and after a render crawl, and `close()` is idempotent.

### Browser resolution — no download required

`npm install` deliberately does not fetch browsers; that would turn a 5-second
install into a 300 MB one for a feature most crawls never use. `playwright-core`
is an **optional** dependency, and the pool resolves a binary in order:

1. `PLAYWRIGHT_CHROMIUM_PATH`
2. Playwright's own build, if `npx playwright install chromium` has been run
3. System Chrome (`channel: 'chrome'`)
4. System Edge (`channel: 'msedge'`)

On a machine with Chrome installed this works with no setup at all. If none
resolve, the error names every attempt and how to fix it.

### Auto-detection on the raw path

Even with rendering off, the crawler detects client-rendered shells — empty
`#root`, `#app`, `<app-root>`, `#__next`, `#__nuxt`, `#svelte` — and fires
`spa.client-rendering-detected` as a notice naming the framework.

Detection is deliberately conservative: an empty mount point alone is not
enough, since a perfectly good SSR page can have an empty secondary container.
It must *also* ship essentially no body text, which is the thing that actually
breaks indexing — and, now, the thing that makes a page invisible to answer
engines.

### The five checks

| Check | Severity | Fires on |
|---|---|---|
| `spa.client-rendering-detected` | notice | raw path — rendering would show more |
| `js.empty-root-fallback` | **blocker** | rendered — mount point still empty, the app failed to boot |
| `js.hydration-content-gap` | critical | rendered — most body text appears only after JS |
| `js.console-errors-present` | warning | rendered — uncaught exceptions during load |
| `js.client-injected-meta` | notice | rendered — title/canonical exist only after hydration |

Response headers, status codes and redirect chains always come from the raw
fetch even on the rendered path, because Playwright cannot see the pre-redirect
chain and many checks depend on it. A page that fails to render falls back to
its raw HTML rather than being dropped.

### Verifying

```bash
node scripts/test-render-js.ts    # 31 assertions: raw vs rendered, broken bundle, teardown
```

---

## Core Web Vitals

Core Web Vitals are a confirmed Google ranking factor and cannot be measured
from a crawl — they need field data from real Chrome users. That comes from the
PageSpeed Insights v5 API, which returns two very different things in one
response, and conflating them is the classic mistake:

- **Field data (CrUX)** — what real Chrome users experienced over the trailing
  28 days. *This is what Google ranks on.* Only exists once a URL has enough
  traffic.
- **Lab data (Lighthouse)** — one simulated load on emulated hardware. Always
  available and reproducible, but not the ranking signal.

Every metric records which source it came from, because "LCP 2.1s" means
something quite different depending on the answer. The resolution order is
page-level CrUX → origin-level CrUX → Lighthouse lab, and the UI says which was
used.

| Metric | Source | Good | Poor |
|---|---|---|---|
| **LCP** | field, else lab | ≤ 2.5s | > 4.0s |
| **CLS** | field, else lab | ≤ 0.1 | > 0.25 |
| **INP** | field only | ≤ 200ms | > 500ms |
| TBT | lab — INP's lab proxy | ≤ 200ms | > 600ms |
| FCP | field, else lab | ≤ 1.8s | > 3.0s |
| Speed Index | lab | ≤ 3.4s | > 5.8s |

CrUX reports CLS as an integer scaled by 100, so it is divided back down on
extraction — a detail that silently reports every site as catastrophically
broken if missed.

### Sampling and quota

PSI is slow and rate-limited, so it runs on a sample chosen *after* PageRank:
the homepage at both strategies, then the highest-PageRank pages at mobile only.
`maxPagespeedPages` (default 3) controls the count; 0 disables it.

Responses cache in Postgres (`kv_cache`) for 24 hours — a generic table that
also stands in for anything else that used to be a local disk cache, since
Vercel's filesystem is read-only outside `/tmp` and not shared across
invocations. Set `PAGESPEED_NO_CACHE=1` to bypass — necessary after deploying a
fix, when yesterday's cached number is exactly the wrong answer.

**On keyless requests.** Google permits them, and the client supports them, but
the anonymous quota is shared globally and in practice is usually already
exhausted. Treat keyless as a fallback that reports its own failure clearly, not
a working configuration. A free `PAGESPEED_API_KEY` raises the limit to 25,000
requests/day.

### Failure handling

A PSI outage or exhausted quota must never silently pass — that is how a broken
integration goes unnoticed for months. When no data is returned:

- `pagespeed-data-available` **fails**, carrying the exact API error
- the four threshold checks report **passed** rather than inventing a verdict
- the dashboard card explains what happened and how to fix it

Every request is wrapped in `Promise.allSettled` with a 30-second timeout, so a
hung API cannot abort the audit.

### Verifying

```bash
node scripts/test-pagespeed.ts     # 26 extraction assertions against fixtures
node scripts/test-cwv-checks.ts    # 30 pipeline assertions, PSI mocked end to end
```

---

## Storage — Postgres

Everything lives in one Postgres database — every module, one schema, one
connection string (`POSTGRES_URL`). There is no ORM: `src/db/index.ts` is a
~200-line wrapper around [`pg`](https://node-postgres.com), and every query in
the codebase is still written with SQLite-style `?` placeholders, converted to
`$1, $2, …` in one place so none of the 300+ call sites had to be rewritten by
hand when the driver changed.

```
sites             every monitored / crawled origin
monitor_checks    one row per poll, kept forever
incidents         derived down→up transitions
alerts            every delivery attempt, successful or not
keywords          one row per phrase × engine × device × geo
rank_snapshots    position history
api_usage         monthly SERP quota ledger
backlinks         current state per referring page
backlink_checks   verification history
crawls            audit reports (summary columns + full JSON blob)
crawl_jobs        in-flight crawl progress, polled across serverless instances
page_snapshots    gzipped raw HTML per page, for "view issue in code"
gsc_fetches       Search Console fetch log, one row per date range
gsc_page_metrics  per-URL clicks, impressions, CTR, position
ga4_metrics       per-path sessions, users, conversions, bounce rate
content_grades    one LLM content verdict per (crawl, page)
kv_cache          generic cache (currently: PageSpeed Insights responses)
schema_migrations tracks which migrations have run
```

**Migrations run themselves.** The first query of any kind checks
`schema_migrations`, a single-row table holding the current version, and
applies every migration in `src/db/schema.ts` newer than it — each inside its
own transaction, rolled back whole on failure. There is no `npm run migrate` to
remember and no step in the Vercel build that needs to touch the database:
deploy the app, and the schema catches up the first time anything queries it.

**Why not an ORM.** The schema is small and stable, every check and script
already speaks SQL fluently, and a query builder would have meant rewriting the
300+ call sites this migration already had to touch once. `pg.Pool` plus one
`?`-to-`$n` translation layer was the entire cost of moving off SQLite; an ORM
would have made it larger for no capability this project needs.

**Transactions across a connection pool.** SQLite's single connection made a
transaction trivial: `BEGIN` and every query after it ran on the same handle by
construction. A pool hands out whichever connection is free, so `tx(fn)` checks
out one dedicated client, runs `BEGIN`, and uses `AsyncLocalStorage` to make
every `all`/`get`/`run` call *inside* `fn` transparently reuse that same client
rather than a fresh one from the pool — the only way nested queries stay part
of the same transaction without threading a client argument through every
function that might be called inside one.

**Pool size on serverless.** Each Vercel invocation is its own process, so
`Pool({ max: 5 })` here is deliberately small — it is not what absorbs
concurrent traffic. That job belongs to Postgres' own connection pooler
(PgBouncer, which Vercel Postgres/Neon puts in front of the pooled connection
string it gives you); this pool just avoids one invocation opening more
connections than it needs.

Secrets never go in the database, only in the environment.

---

## Deploying to Vercel

> **Add auth before you share the URL.** The dashboard has none of its own —
> no login, no session, nothing. Locally that's fine; on Vercel the app gets a
> public URL, and anyone who has it can run crawls and read every stored
> report. Turn on [Vercel Authentication](https://vercel.com/docs/security/deployment-protection)
> (Project → Settings → Deployment Protection) before treating this as a real
> deployment rather than a demo only you know the link to.

```bash
vercel link                        # or: New Project -> import this repo
```

**1. Add Postgres.** Project → Storage → Create Database → Postgres. This
provisions a Neon-backed database and adds `POSTGRES_URL` (and a few related
variables) to every environment automatically — nothing to copy by hand.

**2. Add whatever else you use**, under Project → Settings → Environment
Variables — see [`.env.example`](.env.example) for the full list. Everything
except `POSTGRES_URL` is optional and degrades gracefully:

```
GEMINI_API_KEY / GROQ_API_KEY / ANTHROPIC_API_KEY   content grading
SERPAPI_KEY / VALUESERP_KEY / DATAFORSEO_LOGIN+PASSWORD   rank tracking
PAGESPEED_API_KEY                                   Core Web Vitals
GOOGLE_SERVICE_ACCOUNT_JSON + GSC_SITE_URL           Search Console + backlinks
GA4_PROPERTY_ID                                      Google Analytics 4
SENDGRID_API_KEY / RESEND_API_KEY / ALERT_WEBHOOK_URL   uptime + backlink alerts
```

**3. Deploy.** `git push` (with the Vercel GitHub integration) or `vercel
deploy`. The schema migrates itself on first query — there is no build-time
migration step.

**4. Wire up scheduling** — see [Scheduling](#scheduling) below. The dashboard
itself never re-crawls, monitors, or checks ranks on its own; something has to
invoke the scripts. GitHub Actions is the free option and needs the same
`POSTGRES_URL` added as a repository secret.

### Why the original SQLite version couldn't deploy here

Worth stating plainly, since this is what a first deploy attempt runs into:
Vercel's serverless functions have a **read-only filesystem outside `/tmp`**,
and `/tmp` itself is **not shared** across invocations or persisted between
them. A design that opens a local file — `new DatabaseSync('.data/sitechecker.db')`,
or a disk cache under `.data/cache/` — either throws (`EROFS`) the first time it
tries to write, or silently starts from empty on every single request, because
"the file" was never the same file twice. That is not a Vercel misconfiguration
to work around; it is the platform being what it says it is, and it is exactly
why storage moved to Postgres rather than papering over the write.

**A related, subtler gap this migration also had to close:** a crawl runs
detached from the request that starts it, and the client polls a `GET` for
progress. Holding that progress in a process-local `Map` works on a single
long-running server, but two requests to a Vercel deployment are not
guaranteed to land on the same underlying instance — so the poll can go to an
instance that never ran the crawl and has nothing in memory to report. Progress
now lives in the `crawl_jobs` table for exactly this reason, and the crawl's
own background work is registered with Next's `after()` rather than left as an
un-awaited promise, because a serverless function is not guaranteed to keep
running once its response has been sent unless that work is explicitly
registered to outlive it.

### What is still a real constraint on Vercel

- **Function duration.** `export const maxDuration = 900` is set on the crawl
  route, but Vercel enforces its own ceiling per plan (as low as 10s on Hobby;
  higher with Fluid compute or Pro/Enterprise). A crawl large enough to exceed
  whatever your plan actually allows will be killed mid-run, and there is
  currently no queue or resumable-worker path to pick it back up. Size
  `maxPages` to what your plan's duration limit can plausibly finish.
- **JavaScript rendering needs a real Chromium binary.** Playwright's browser
  pool (see [JavaScript rendering](#javascript-rendering)) has nothing to
  resolve to on a standard Vercel function. `--render-js` is a local/self-hosted
  feature only, not something the deployed dashboard can offer.
- **PageSpeed Insights is now read from and written to Postgres**, not a local
  disk cache — no action needed, just noted because it is a behavioural change
  from the original design.

## Uptime monitoring and alerts

```bash
node scripts/monitor.ts --add https://example.com    # register a site
node scripts/monitor.ts                              # one polling pass
node scripts/monitor.ts --status                     # uptime summary
```

A GET to the homepage with `redirect: 'manual'`, so a homepage that 301s is
reported as a 301 rather than silently followed to a 200 somewhere else.
Anything other than exactly 200 is a failure.

**Alerts fire per incident, never per poll.** A site down for three hours on a
15-minute schedule produces 12 failed checks, *one* incident and *two* emails —
down and recovered. Alerting on every poll is how monitoring gets muted, and a
muted monitor is worse than none.

| Transition | Effect |
|---|---|
| first non-200 | open incident, send `DOWN` alert |
| still failing | increment the incident, stay silent |
| back to 200 | resolve incident, send `RECOVERED` with duration and failure count |

Also recorded per poll: response time, redirect target, a SHA-256 prefix of the
body (so silent content changes are visible), and TLS days remaining. A
certificate inside `SSL_WARN_DAYS` alerts once per day.

### Alert channels

Delivered to **every** configured channel, not the first that works: if email is
the only route and the provider is having an outage, a down alert would vanish.

| Channel | Env | Free tier |
|---|---|---|
| SendGrid | `SENDGRID_API_KEY` + `ALERT_EMAIL_TO` | 100 emails/day, forever |
| Resend | `RESEND_API_KEY` + `ALERT_EMAIL_TO` | 100/day, 3,000/month |
| Webhook | `ALERT_WEBHOOK_URL` | Slack / Discord, free |
| Console | — | always on, the fallback |

The webhook payload carries both `text` and `content`, so one body works for
Slack or Discord with no configuration. Every attempt is logged to the `alerts`
table whether it succeeded or not.

---

## Rank tracking

```bash
node scripts/ranks.ts --add https://example.com "seo audit tool" google mobile US "Austin,Texas,United States"
node scripts/ranks.ts --add https://example.com "seo audit tool" yandex desktop RU
node scripts/ranks.ts            # track everything active
node scripts/ranks.ts --list
node scripts/ranks.ts --usage    # remaining monthly budget
```

Four engines — **Google, Bing, Yahoo, Yandex** — with **device** and
**city-level geo** segmentation, plus a **Google local map-pack** mode for the
surface that actually decides local visibility. Segmentation is structural, not a
display filter: `("seo audit tool", google, mobile, Austin)` is a different row
from `("seo audit tool", google, desktop, Austin)`, with its own independent
history, enforced by a `UNIQUE` constraint.

`/ranks` also runs one-off checks from the dashboard without tracking anything.

Search engines block automated scraping, so results come from a SERP API:

| Provider | Env | Engines | Free tier |
|---|---|---|---|
| SerpApi | `SERPAPI_KEY` | all four incl. **Yandex**, and the local pack | ~100 searches/month |
| ValueSERP | `VALUESERP_KEY` | Google, Bing, Yahoo | ~100 searches/month |
| DataForSEO | `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` | Google, Bing, Yahoo | free tier on signup |

Each is a thin adapter behind one interface; whichever is configured is used, and
`SERP_PROVIDER` forces a specific one. Only SerpApi exposes Yandex and the local
pack, so a Yandex keyword with only ValueSERP configured reports that clearly
rather than failing opaquely.

### The quota ledger

Free tiers of 50–100 searches per month are small enough that spending them by
accident is the single most likely way to break this module — one misconfigured
cron schedule burns a month in an hour.

So the budget is enforced **in Postgres before the call is made**, not left to the
provider to reject:

```
serpapi: 100/100 used this month
  [SKIP] seo audit tool  — Monthly budget exhausted for serpapi (100/100 used in 2026-08)
```

Zero network calls happen in that state. A failed call still consumes quota at
most providers, so it is metered either way. Override with
`SERP_MONTHLY_LIMIT` when you upgrade to a paid plan.

This is why the GitHub Actions schedule for ranks is **weekly, not daily**: 20
keywords daily is 600 searches a month against a 100 ceiling.

---

## Backlink tracking

```bash
node scripts/backlinks.ts --import-csv https://example.com links.csv
node scripts/backlinks.ts --import-gsc https://example.com
node scripts/backlinks.ts --add https://example.com https://referring-site.com/post
node scripts/backlinks.ts https://example.com     # verify a batch
node scripts/backlinks.ts --list https://example.com
```

Each referring page is fetched, parsed with cheerio, and searched for a link
pointing at your domain. Records whether it is still present, its anchor text,
and whether it carries `rel="nofollow"` — or `ugc` / `sponsored`, which pass no
equity either.

**A page-level `<meta name="robots" content="nofollow">` is checked too.** It
makes every link on the page nofollow regardless of its own `rel` attribute;
missing this reports a link as dofollow when it passes nothing.

State is a transition, not a snapshot:

| Transition | Meaning | Alerts |
|---|---|---|
| `found` | new link confirmed live | no |
| `lost` | was active, link is gone or page is 4xx | **yes** |
| `became-nofollow` | still there, downgraded | **yes** |
| `broken` | host unreachable or 5xx | no — keeps last known state |

Unreachable is deliberately not the same as removed: a referring host having a
bad day should not be reported as a lost link.

This is **verification**, not **discovery** — an important distinction. It tells
you the truth about links you already know of. It cannot tell you about links you
do not, which is what a licensed backlink index buys. See
[What is still missing](#what-is-still-missing).

### On Google Search Console

An honest limitation worth stating plainly: **the Search Console API does not
expose the Links report.** The API covers search analytics, sitemaps and URL
inspection — referring domains are web-UI only, capped at 1,000 sample links.

So there are two paths, and the CLI supports both:

- `--import-csv` — **the reliable one.** Search Console → Links → Top linking
  pages → Export. Handles quoted CSV and both export shapes.
- `--import-gsc` — service-account OAuth against Search Analytics, which returns
  the pages driving impressions. A useful automated supplement, not the full list.

Auth is a service-account JWT signed with `node:crypto` and exchanged for an
access token — about 40 lines, versus ~50 MB for the `googleapis` package.

---

## Scheduling

The dashboard itself never re-crawls, monitors, or checks ranks on a schedule —
the scripts are one-shot: a scheduler invokes them, they read and write
Postgres directly, and exit. There is no daemon to host, and because every path
(dashboard, cron, GitHub Actions) talks to the same database, results from a
scheduled run show up on the dashboard immediately.

### Option A — your machine

`crontab -e` on macOS/Linux, `schtasks` on Windows. Exact commands are on the
`/schedule` page, generated with your real paths.

Free and completely private, but **it only runs while the machine is on and
awake**. Fine for weekly ranks and daily backlinks. Not adequate on its own for
"24/7" uptime monitoring.

Note that cron runs with a minimal environment and will **not** read
`.env.local`; export `POSTGRES_URL` and everything else in the crontab, or
source them in a wrapper script.

### Option B — GitHub Actions

Three workflows ship in `.github/workflows/`:

| Workflow | Schedule | Why |
|---|---|---|
| `monitor.yml` | every 15 min | ~15s per run |
| `backlinks.yml` | daily 04:00 UTC | batched, oldest-first |
| `ranks.yml` | Mondays 06:00 UTC | weekly, to stay inside the free SERP tier |

Public repos get unlimited Actions minutes; private repos get 2,000/month. Each
run writes straight to the same Postgres database the deployed app uses — add
`POSTGRES_URL` under **Settings → Secrets and variables → Actions** alongside
whatever else that workflow needs (see each file for its exact list). There is
no database file to commit back to the repository and nothing that can race
between two runs at the database layer, so the workflows no longer need the
`concurrency` group or `permissions: contents: write` the SQLite version relied
on for committing.

One limit worth knowing before relying on this: **scheduled workflows are
throttled under load**, so a `*/15` schedule fires roughly every 15–25 minutes,
not exactly on the quarter hour — acceptable for alerting, not an SLA. GitHub
also disables a workflow's schedule after 60 days with no repository activity;
any commit resets that clock.

---

## Comparison to sitechecker.pro

### Reporting model — full parity

| Feature | Sitechecker | This project |
|---|---|---|
| Checks grouped into 15 named categories | ✅ | ✅ same names |
| Failing checks with affected page counts | ✅ | ✅ |
| **Passing checks listed at "0 pages"** | ✅ | ✅ |
| Category descriptions | ✅ | ✅ |
| "Affected pages by category" percentages | ✅ | ✅ |
| Severity tiers | 4 | 5 (adds `blocker`) |
| Per-check how-to-fix guidance | ✅ (179 pages) | ✅ (inline, from the registry) |
| Website Score 0–100 | ✅ | ✅ (different formula, honestly labelled) |
| Per-page score | hidden | ✅ exposed |
| Crawl settings (limits, robots, subdomains) | ✅ | ✅ |
| Page detail table | ✅ | ✅ |

### Check coverage

Sitechecker advertises "300+". The dashboard export used as the reference lists
~288 across 15 categories. This project implements **332**.

| Category | Sitechecker (observed) | This project |
|---|---:|---:|
| Indexability | 57 | 59 |
| Content Relevance | 42 | 43 |
| Links | 36 | 34 |
| Internal | 24 | 25 |
| Localization | 23 | 23 |
| Page Speed | 16 | 22 |
| Search Traffic | 11 | 22 |
| Security | 18 | 18 |
| Duplicate Content | 15 | 17 |
| Redirects | 11 | 12 |
| XML Sitemaps | 8 | 12 |
| Mobile Friendly | 11 | 11 |
| Code Validation | 10 | 11 |
| Social Media | 6 | 8 |
| **Next.js** | **0** | **15** |
| **Total** | **~288** | **332** |

Category counts differ slightly because some Sitechecker checks were merged
where they tested the same condition, and some were split where one label
covered distinct failures.

### Where we are ahead

- **The scoring formula is monotonic.** Theirs is provably not — fixing critical
  errors can lower your score, in 17% of fuzzed cases.
- **`blocker` severity tier**, so an unrankable page cannot score in the 60s.
- **Page importance weighting** via internal PageRank plus real impressions and
  sessions. Theirs is an unweighted mean.
- **The score says what it is.** "Technical health", with a published tiering of
  which checks move rankings and which do not.
- **15 Next.js checks** structurally impossible for a framework-agnostic crawler.
- **Content quality graded by a model**, not inferred from word count.
- **An answer-engine layer** — 10 AI crawlers, per-page JS-dependency proof,
  llms.txt generation.
- **Per-page scores exposed.** Sitechecker computes `OnePageScore` and explicitly
  hides it.
- **Rubric versioning**, so a score change is never an artefact of a silent
  weight change — and trend charts refuse to plot across a rubric boundary.
- **Backlink verification is free**, seeded from Search Console and confirmed by
  actually fetching the referring page.
- **The SERP quota ledger** — free tiers metered in Postgres before a call is made.
- **Self-hostable at cost, not rented.** Runs locally against any Postgres, or
  deployed on Vercel with a free Postgres tier — no subscription, no per-seat
  pricing, no page-count paywall. You own the database either way.

---

## Comparison to MyAIO

MyAIO is the closer competitor for the platform ambition: eight modules covering
audit, content, site metrics, keyword research, Google Business Profile, authority
building and report building. Read from 45 screenshots of a live account; no
authenticated session was scraped.

### Their scoring, off their own screen

Their Domain-level page prints every point value. It is a flat sum of cheap
binary checks:

| Domain check | Points |
|---|---:|
| Sitemap XML present | +10 |
| Robots TXT present | +10 |
| SSL valid & trusted | +2 |
| Server compression | +1.5 |
| HTTP → HTTPS redirect | +1.5 |
| No soft 404s | +1 |
| No mixed content | +1 |
| Protocol / WWW unified | +1 |
| Favicon present | +0.5 |

Plus six CrUX metrics at FCP +0.5, LCP +0.25, CLS +0.25, and Speed Index / TTI /
TBT at **+0**. Page-level "SEO Health" is four binary checks (slug defined, in
sitemap, HTTPS redirect, robots.txt pass).

Not one point for a backlink, a byte of content quality, or a query-level
position. **Both tools' headline scores measure build quality.** Ours is simply
honest about it, and weights a blocker 240× a cosmetic notice instead of pricing
"has a favicon" at half of "Core Web Vitals are good".

Worth noting: the same site reads **65/100 "Optimization Score"** on their
dashboard and **46/100 "Site Health"** on their audit overview, in the same
session. Two different numbers for the same crawl, unexplained.

### Where they are ahead

| Gap | Why it matters | MyAIO | Us |
|---|---|---|---|
| **Off-site authority** | Links remain a top-2 ranking factor. Who links to you, with what anchor, from what authority, is most of why one page outranks another. | Whole Site Metrics module on a licensed feed: backlinks, referring domains and IPs, anchors, domain power, spam score, 92 competitors, new/lost link timelines. | **Verification only.** We confirm links you already know about; we cannot discover one. |
| **Keyword research** | Volume, difficulty and intent decide what is worth chasing. Upstream of everything else. | Keyword Magic Tool — volume, CPC, difficulty, intent classification, clustering, position-distribution histograms, traffic value. | **None.** Needs a keyword-data provider. |
| **Local pack & Google Business Profile** | For a local business the map 3-pack *is* the ranking surface. | Entire GBP Galactic module: profile management, posts, reviews and replies, Q&A, geo-grid heatmaps, citations, KML export, competitor ranking insights. | **Partial** — we can check local-pack *position*; we cannot manage a profile. |
| **Fix generation and deploy** | What turns an auditor into something people pay for monthly. | Per-URL suggested titles/descriptions/alt text with length bars, a Deploy checkbox per row, and a deploy loop for robots.txt and sitemap (WordPress-bound). | **Stage 1** — robots.txt and llms.txt generate-and-copy. No LLM-written metadata, no deploy. |
| **Content production** | Ranking needs pages, not just diagnoses. | Content Genius editor, AI Content Writer, topical maps, content planner, meta generator, ad-copy templates, rewriter. | **Diagnosis only** — we grade content; we do not write it. |
| **Scale and reporting** | Operational, not ranking. | 30k-URL crawls, report builder with history, white-label, press-release distribution. | **None** — in-memory crawl and one JSON blob caps us around 2k pages. |

### Where we are ahead

| | |
|---|---|
| **Answer-engine readiness** | We audit 10 AI crawlers, prove per page what an answer engine can read without JavaScript, and generate an llms.txt. Their robots screen says *"New: LLMs.txt — Coming Soon"*, and no AI-visibility module exists anywhere in their dashboard. |
| **Depth of technical detection** | 332 checks across 15 categories, tiered by real impact. Their Issues page surfaces **five** categories — Page Title, Meta Description, Images Alt Text, OG Meta, Twitter Meta — for a site they say has 174 issues. |
| **Honest scoring** | Monotonic across 2,000 fuzz trials, rubric-versioned, blocker tier, page-importance weighting, and labelled Technical health. Theirs is a flat additive checkbox tally that reads Authority 2% on data it never fetched. |
| **Content grading rigour** | Their Scholar returns 12 metrics with no visible rubric. Ours returns 7 dimensions plus a plain-English verdict, named strengths, and up to five page-specific fixes — with a prompt that explicitly forbids generic advice and refuses to reward length. |
| **Next.js white-box** | 15 framework checks no black-box crawler can produce, and the render-strategy data that makes the AEO analysis possible. |
| **Correctness loop** | We audit our own app. That found a real crawler bug (alias URLs stored twice and reported as duplicates of themselves) polluting findings on every site. Their product shows no evidence of such a loop, and ships two contradictory scores for one crawl. |
| **Cost** | No subscription, no per-seat pricing, no page-count paywall — self-host it or deploy it, at the cost of a database. |

---

## What is still missing

The two things that most decide where a page ranks, ordered by how much they
matter:

**1. Off-site authority — not measured at all.**
Internal PageRank is on-site link equity only. We can verify a backlink you tell
us about; we cannot discover one, score a referring domain, or compare a link
profile to a competitor's. Every incumbent buys this as a data feed rather than
building it, and that is almost certainly the right call here too. Until it
exists, the Authority pillar rests on internal links and Search Console
impressions, and says so rather than showing a confident number.

**2. Content quality is measured but not scored.**
The grader works, stores its verdicts, and feeds the AI-readiness score. It does
**not** feed Technical health — deliberately, because folding a per-page LLM
judgement into a number that is otherwise deterministic and reproducible needs a
decision about what happens on ungraded pages, and re-basing the headline number
on "ranking signal above hygiene" is impossible while authority is still zero.
That is the honest reason it has not happened, not an oversight.

Also unbuilt, in rough order of value:

- **AI mention measurement.** The technical half of AI visibility is shipped;
  the measurement half — are we actually *named* in ChatGPT, Claude or Perplexity
  for a given question — is not.
- **Keyword research.** Needs a provider. Upstream of any content strategy.
- **LLM-written metadata fixes with a deploy path.** MyAIO's most commercially
  obvious feature and our clearest stage-2.
- **Scheduled recrawls.** Audits run from the dashboard only; the cron path
  covers uptime, ranks and backlinks.
- **Scale past ~2k pages.** Everything is in memory and the report is one JSON
  blob.
- **Segments** — URL-pattern page grouping, which starts to matter above ~1k URLs.
- **Ignore/restore UI.** `runAllChecks` accepts an `ignored` set; nothing manages
  it visually.
- **PDF / CSV export**, white-label reports, multi-user access.
- **Structured-data validation.** Formats are detected and mixing is flagged;
  schema contents are not validated.
- **The white-box tier** — reading `next.config`, the `app/` tree and `.next/`
  build manifests to catch regressions *before* merge. Designed in
  `docs/NEXTJS-EDGE.md`, not built. No SEO SaaS can copy it, because none of them
  have repo access.

---

## Known limitations

Things worth knowing before trusting a number:

1. **The score is build quality, not a ranking prediction.** It is called
   Technical health for that reason. See
   [Do these checks actually move rankings?](#do-these-checks-actually-move-rankings).
2. **Check tiering is analysis, not documentation.** Google publishes no
   weightings. The tiers reflect a defensible reading of what it has confirmed,
   not an authoritative source.
3. **Content grades are a model's opinion.** Reproducible enough to compare pages
   within a site and re-runnable per page, but two runs can differ by a few
   points, and the model never sees the SERP it would be competing in.
4. **JS rendering is opt-in, and slower.** The default raw path reasons about
   server HTML, which for Next.js is the right view. Client-rendered sites need
   `--render-js`, roughly 0.7s per page against ~0.05s raw.
5. **Duplicate content detection is coarse** — a normalised first-2000-character
   fingerprint of body text. Template duplicates reliably; near-duplicates not.
6. **Asset checks cap at 400 URLs** per crawl, so on a large site page-speed
   findings sample rather than cover.
7. **Only the first 500 affected URLs per check are stored.** Counts stay
   truthful; the table is capped.
8. **`hostRedirectConsistent` assumes** a non-resolving alternate host is correct
   configuration. A site with no www DNS record passes.
9. **TLS check uses `node:tls` directly** and can report failures for
   certificates a browser would accept via a different trust path.
10. **A crawl killed mid-run by a function-duration limit cannot resume.**
    Progress polling survives across serverless instances (it lives in
    Postgres), but if the platform kills the invocation itself — Vercel's
    per-plan `maxDuration` ceiling — the crawl stops with no queue to pick it
    back up. Size `maxPages` to what your plan can finish; locally there is no
    such ceiling.
11. **Local cron is not 24/7.** A sleeping laptop stops monitoring. Genuine
    round-the-clock coverage needs the GitHub Actions path, itself throttled
    under load and auto-disabled after 60 days of repo inactivity.
12. **The Search Console API cannot list backlinks.** `--import-csv` is the real
    path to a full list.
13. **Rank tracking needs a paid-tier key to be useful at scale.** 100 free
    searches a month is roughly 20 keywords checked weekly.
14. **Alerts are not deduplicated across channels.** Configuring SendGrid *and* a
    webhook sends both, deliberately.
15. **No auth on the dashboard, at all.** Locally this was low-risk — bound to
    localhost, one trusted user. **Deployed on Vercel it is a real exposure**:
    the app gets a public URL and anyone who finds it can run crawls, read
    every stored report, and see whatever Search Console / GA4 data is
    connected. Put it behind [Vercel Authentication](https://vercel.com/docs/security/deployment-protection)
    (password or SSO protection on the project) or your own middleware before
    a real deployment goes anywhere near a URL someone else could guess or
    stumble onto.
16. **Core Web Vitals sample, they don't cover.** PSI runs on the homepage plus
    the top few pages by PageRank, so the CWV verdict is "the pages we measured".
17. **Code view covers 137 of 332 checks.** The remainder have no source position
    by nature. The button is hidden for those.
18. **Snapshots are captured from this version onwards.** Crawls run before the
    feature existed have no stored HTML; re-run the audit to enable code view.
19. **Locators search the stored HTML, not the parsed tree.** A check that fired
    on the rendered DOM whose pattern is absent from the raw snapshot resolves to
    nothing, and the panel reports that honestly.
20. **Keyless PageSpeed is unreliable in practice.** A free `PAGESPEED_API_KEY`
    is effectively required.

---

## Project layout

```
app/                              Next.js App Router — the dashboard
  page.tsx                        dashboard: run an audit, projects, integration status
  nav.tsx                         persistent vertical navigation
  crawl-form.tsx                  client form with advanced settings
  panel.tsx / ui.tsx              score dial, meters, site picker, shared bits
  theme-toggle.tsx                light / dark

  projects/page.tsx               project list + add
  project/[id]/                   project view: trend graphs, latest report embedded
  crawl/[id]/page.tsx             report shell (server)
  crawl/[id]/view.tsx             live progress poller
  crawl/[id]/summary.tsx          tabs: overview / issues / explorer / graph
  crawl/[id]/pillars.tsx          four-pillar rollup + narration
  crawl/[id]/explorer.tsx         page table with importance segments
  crawl/[id]/graph.tsx            force-directed link visualisation
  crawl/[id]/cwv.tsx              Core Web Vitals card
  crawl/[id]/traffic.tsx          GSC/GA4 card + per-check impact
  crawl/[id]/code-viewer.tsx      the code panel, with its own tiny highlighter
  crawl/[id]/compare/             crawl-over-crawl diff
  crawl/[id]/manage/              robots.txt + sitemap generate-and-copy

  insights/                       GSC + GA4 dashboards and setup guides
  ai-visibility/                  AEO readiness, crawlers, llms.txt
  content/                        content grading UI
  ranks/                          rank check + tracked keywords + quota
  backlinks/page.tsx              backlink table + summary
  schedule/page.tsx               setup + configuration status

  api/crawl/route.ts              POST start crawl, GET list
  api/crawl/[id]/route.ts         GET status+report, DELETE
  api/crawl/[id]/snapshot/        stored HTML around a finding
  api/projects/                   project CRUD
  api/content-grade/route.ts      grade one page, persist
  api/rank/ · api/rank/track/     one-off and tracked rank checks

src/core/
  extract.ts                      HTML → PageData, one parse pass per page
  nextjs/detect.ts                Next.js fingerprint from headers + raw HTML
  checks/types.ts                 check DSL, categories, SiteData
  checks/registry.ts              all 332 registered + the runner
  checks/indexability.ts          59
  checks/content.ts               43 content-relevance
  checks/links.ts                 34
  checks/internal.ts              25
  checks/localization.ts          23
  checks/security.ts              18
  checks/duplicate.ts             17
  checks/performance.ts           22 page-speed + 11 mobile
  checks/technical.ts             12 redirects + 8 social + 11 code + 12 sitemaps
  checks/traffic.ts               Search Console checks
  checks/traffic-ga4.ts           GA4 cross-validation checks
  checks/nextjs.ts                15
  checks/javascript.ts            the 5 JS-rendering checks
  checks/locate.ts                source locators — 137 checks → exact offsets
  scoring/model.ts                page + site scoring, rubric 1.1.0
  scoring/pillars.ts              Content / Authority / Technicals / UX rollup
  scoring/pagerank.ts             internal link graph, orphan detection
  scoring/demo.ts                 monotonicity fuzz test vs Sitechecker
  content/grade.ts                the LLM content judge + storage
  llm/provider.ts                 Gemini / Groq / Anthropic, one JSON interface
  aeo/analyze.ts                  AI crawler access, JS gap, llms.txt, quotability
  gsc/auth.ts                     shared service-account JWT (GSC + GA4)
  gsc/client.ts                   Search Analytics query + Postgres cache
  ga4/client.ts                   GA4 Data API runReport + 24h cache
  pagespeed/                      PSI v5 client, Postgres-cached, field/lab resolution
  utils/code.ts                   offset → line number + surrounding source

src/crawler/
  crawl.ts                        frontier, fetching, post-crawl analysis
  robots.ts                       robots.txt fetch + Google matching semantics
  sitemap.ts                      sitemap discovery, index expansion, validation
  browser.ts                      Playwright pool, resource blocking, SPA detection
  audit.ts                        crawl → checks → score → AuditReport
  store.ts                        projects, crawl persistence, job progress, snapshots

src/db/
  index.ts                        pg.Pool, self-running migrations, ? -> $n, tx() via AsyncLocalStorage
  schema.ts                       forward-only migrations, tracked by schema_migrations

src/monitor/check.ts              polling, incidents, uptime reporting
src/alerts/send.ts                SendGrid / Resend / webhook / console delivery
src/ranks/providers.ts            SerpApi / ValueSERP / DataForSEO adapters
src/ranks/track.ts                keywords, tracking runner, quota ledger
src/backlinks/gsc.ts              service-account JWT, CSV parser
src/backlinks/verify.ts           fetch, parse, rel classification, lost detection

docs/
  SCORING.md                      the model and why Sitechecker's is broken
  NEXTJS-EDGE.md                  what we see that competitors cannot
  ARCHITECTURE.md                 pipeline, stack, data model, build order

research/
  COMPETITIVE-ANALYSIS.md         Sitechecker teardown
  scoring-flaw-proof.mjs          runnable proof of the formula defect
  issues/                         179 downloaded how-to-fix guides

scripts/
  cli.ts                          headless audit runner
  monitor.ts · ranks.ts · backlinks.ts     cron entry points
  test-pagespeed.ts               PSI extraction tests (fixtures)
  test-cwv-checks.ts              CWV pipeline tests (mocked PSI, real crawl)
  test-render-js.ts               JS rendering tests (real Chromium, fixture SPA)
  test-code-view.ts               offset resolution, locators, snapshot storage
  test-traffic.ts                 GSC + GA4, mocked APIs, real crawl

.github/workflows/                monitor / ranks / backlinks schedules
.env.example                      every supported environment variable
```

---

## Development

```bash
npm run dev          # dev server with HMR
npm run build        # production build
npm run start        # serve the production build
npm run typecheck    # tsc --noEmit, strict + noUncheckedIndexedAccess
```

### Adding a check

1. Pick the category file in `src/core/checks/`.
2. Add a `pageCheck({...})` or `siteCheck({...})`.
3. Export it from the category array.

That is all — it is picked up by the registry, the runner, the scorer and the
report UI automatically. Duplicate ids throw at load.

If your check needs data the extract layer does not expose yet, add the field to
`PageData` in `src/core/extract.ts` and populate it in the single parse pass —
never re-parse HTML inside a check.

Before adding one, ask which tier it lands in. Another cosmetic notice adds a row
to the report and 0.5 to nobody's decision; the registry does not need more of
those.

### Tuning strictness

Thresholds are grouped and exported so they can be changed in one place:

- `CONTENT_LIMITS` in `checks/content.ts` — title/description/H1 lengths, word count
- `LINK_LIMITS` in `checks/links.ts` — link count ceilings
- `SPEED_LIMITS` in `checks/performance.ts` — payload sizes, DOM metrics
- `URL_LIMITS` in `checks/internal.ts` — URL length
- `SEVERITY_WEIGHT` in `scoring/model.ts` — the rubric itself

Changing `SEVERITY_WEIGHT` requires bumping `RUBRIC_VERSION`, so historical
reports remain interpretable and trend charts refuse to plot across the change.
