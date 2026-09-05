# Architecture

## Shape of the product

Two surfaces over one engine — this is the structural bet, and it is what
Sitechecker cannot copy without becoming a different company.

```
                     ┌───────────────────────┐
                     │  packages/core        │
                     │  fingerprint · checks │
                     │  scoring · pagerank   │
                     └───────────┬───────────┘
              ┌──────────────────┴──────────────────┐
              ▼                                     ▼
    ┌──────────────────┐                  ┌────────────────────┐
    │  BLACK BOX       │                  │  WHITE BOX         │
    │  hosted crawler  │                  │  CLI + GH Action   │
    │  any live URL    │                  │  reads the repo    │
    │  scheduled       │                  │  runs pre-merge    │
    └──────────────────┘                  └────────────────────┘
```

The hosted crawler is table stakes and is what the dashboard shows. The CLI is the
moat: it reads `next.config`, the `app/` tree and `.next/` build manifests, and fails
a PR on regression *before* the bad deploy is live. Same check registry, same rubric,
so a CI finding and a dashboard finding are the same object.

## Crawl pipeline

```
seed ── robots.txt + sitemap.xml + start URL
  │
  ├─▶ frontier      politeness, adaptive concurrency, dedupe on canonical URL
  ├─▶ fetch         undici; record status, headers, timing, full redirect chain
  ├─▶ triage        Next.js fingerprint from raw HTML — decides the next step
  ├─▶ render        Playwright, ONLY when triage says content is client-dependent
  ├─▶ extract       links, assets, meta, structured data, Next.js signals
  ├─▶ persist       Postgres row + raw HTML snapshot to object storage
  │
  ├─▶ [barrier: crawl complete]
  │
  ├─▶ site checks   duplicates, orphans, hreflang reciprocity, sitemap cross-checks
  ├─▶ pagerank      internal link graph
  ├─▶ score         page scores → weighted site score
  └─▶ diff + alert  vs. previous crawl; notify on delta, never on state
```

Two things in there matter more than the rest.

**Conditional rendering.** Browser rendering is 50–100× the cost of a fetch. Running
Playwright on every URL is what makes crawls slow and expensive. The fingerprint runs
on raw HTML first and only escalates to a browser when it has reason to — thin server
HTML, an unresolved Suspense boundary, a client-heavy shell. On a well-built static
Next.js site that is near-zero renders; on a broken one it renders exactly the pages
that need it. The triage step pays for the whole architecture.

**The barrier.** Page-scope checks stream during the crawl. Site-scope checks
(duplicates, orphans, hreflang return-tags, PageRank, build drift) cannot run until
the frontier is empty, because they are defined over the complete page set. This split
is forced by data dependencies, and it is why `types.ts` makes `scope` a
discriminated field rather than a convention.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Dashboard | Next.js 15 App Router, TS, Tailwind, shadcn/ui | dogfood the thing we audit |
| Tables | TanStack Table + virtualisation | 30k-row issue lists |
| API | Route Handlers, server actions | no separate API tier at this size |
| Worker | standalone Node service | crawls outlive a serverless invocation |
| Queue | BullMQ + Redis | retries, backoff, per-project rate limits |
| DB | Postgres | crawl data is relational; JSONB for page snapshots |
| Snapshots | S3/R2 | raw HTML for "view issue in code" and diffing |
| Fetch | undici | connection pooling, HTTP/2 |
| Render | Playwright, pooled | conditional path only |
| Parse | cheerio (fast) / real DOM (render path) | |
| CWV | CrUX API (field) + Lighthouse (lab) | field data first; lab only to explain it |

Postgres over ClickHouse until there is a reason: a 30k-URL crawl is ~30k rows, and
correct indexing handles that comfortably. Revisit when trend queries across hundreds
of crawls get slow, not before.

## Data model sketch

```
projects        (id, origin, next_config_snapshot, crawl_settings)
crawls          (id, project_id, started_at, build_ids[], rubric_version, score)
pages           (id, crawl_id, url, status, headers, strategy, router, bytes,
                 pagerank, impressions, score, snapshot_key)
page_issues     (page_id, check_id, severity, confidence, detail, offset)
site_issues     (crawl_id, check_id, severity, detail)
links           (crawl_id, from_page_id, to_url, anchor, rel, is_internal)
ignored_checks  (project_id, check_id, scope_pattern)
```

`links` is the big table and the one that needs care — it is O(pages × links/page),
so 30k pages at 100 links each is 3M rows per crawl. Partition by `crawl_id` and drop
old partitions on retention.

`rubric_version` lives on `crawls` so the trend chart can refuse to plot across a
rubric change rather than showing a phantom score jump.

## Build order

1. **`packages/core`** — done: fingerprint, check registry, scoring, PageRank.
2. **Crawler worker** — frontier, robots, politeness, conditional render, persistence.
3. **Standard check packs** — ~300 checks for parity, taxonomy already mapped.
4. **Dashboard** — summary, issue list, page detail, view-in-code.
5. **CLI + GitHub Action** — the white-box tier and the pre-merge regression gate.
6. **Integrations** — GSC (page weighting + orphan-with-impressions), CrUX, alerts.

Steps 1 and 2 are the engine. Step 5 is the reason anyone switches. Step 3 is the
reason they can cancel the other subscription — it is unglamorous, high-volume, and
skipping it makes this a linter rather than a replacement.
