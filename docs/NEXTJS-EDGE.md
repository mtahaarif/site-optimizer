# The Next.js Edge

Sitechecker, Ahrefs, Semrush, Screaming Frog and Sitebulb are all black-box crawlers:
they fetch a URL and reason about the HTML that comes back. That ceiling is what we
build above.

The rule that generates every idea below: **a generic crawler can see the symptom;
only we can name the cause.** "Text-to-code ratio is low" is a symptom. "473 KB of
RSC flight payload is 64% of your HTML because you forward whole CMS objects across
the server/client boundary" is the cause, and it comes with a fix.

## Tier 1 — Black-box, Next.js-aware (works on any deployed URL, no repo access)

Implemented in `packages/core/src/nextjs/detect.ts`, verified against live sites.

### Rendering strategy per route

The single most important SEO fact about a Next.js page, and no general-purpose tool
reports it. Recovered from:

| Signal | Meaning |
|---|---|
| `__NEXT_DATA__.gssp` | getServerSideProps — SSR, definitive |
| `__NEXT_DATA__.gsp` | getStaticProps — SSG/ISR, definitive |
| `x-nextjs-cache: HIT/STALE` | ISR, served from the Next data cache |
| `x-vercel-cache: HIT/STALE/PRERENDER` | prerendered and edge-cached |
| `cache-control: s-maxage=N, stale-while-revalidate` | ISR with an N-second window |
| `cache-control: no-store` with no cache hit | force-dynamic or an uncached fetch |
| `self.__next_f.push` present | App Router |
| unresolved `<template id="B:n">` | streaming SSR that never finished |

Careful with the last one. React opens a pending boundary as `<!--$?-->` plus
`<template id="B:n">`, then flushes content and calls `$RC("B:n","S:n")` to swap it
in. Testing for `<!--$?-->` alone reports **every** streamed page as broken. Only a
`B:n` with no matching `$RC` is a real finding — that is the difference between
"this page streams" and "Googlebot indexed your loading skeleton". Verified: on a
live crawl nextjs.org has 3 genuinely unresolved boundaries while vercel.com and
ui.shadcn.com resolve all of theirs.

### Everything else recoverable without the repo

- **next/image misuse** — `data-nimg` marks optimizer-managed images. Detect raw
  `<img>` bypassing the optimizer, `fill` without `sizes` (browser picks the largest
  srcset candidate — a 3840px file inside a 400px card), missing width/height (CLS),
  `unoptimized`, and a lazy-loaded LCP candidate with no `priority`.
- **next/font vs external fonts** — a `<link>` to fonts.googleapis.com is two extra
  round trips before first render; next/font self-hosts from `/_next/static/media`
  and emits hashed `__className_*` classes. Caveat: fonts declared inside an external
  stylesheet need that stylesheet fetched to be seen, so this check needs the asset
  pass to be complete.
- **RSC payload weight** — sum of inline `self.__next_f.push` strings as a share of
  the document. This *is* the "low text-to-code ratio" finding, with a cause attached.
- **`__NEXT_DATA__` props weight** — everything returned from getStaticProps ships to
  every visitor whether rendered or not.
- **Middleware** — `x-middleware-rewrite`, `x-matched-path`. Locale-detection
  middleware is a notorious source of redirect chains and soft 404s.
- **Build identity** — `__NEXT_DATA__.buildId`, `x-nextjs-deployment-id`, or the
  `?dpl=` asset stamp. Two build ids in one crawl means the report mixes deployments.
  It also enables **deploy-triggered recrawls**, which is a feature, not a check.
- **next/script blocking** — a `<head>` script with neither defer nor async is
  usually `strategy="beforeInteractive"` used where `afterInteractive` belongs.

## Tier 2 — White-box (the actual moat)

No SEO SaaS reads your repository, because none of them have access. A CLI and a
GitHub Action do. This is where the product stops being a better Sitechecker and
starts being something they cannot copy without changing what they are.

### `.next/` build manifests — ground truth, zero inference

After `next build`, these files state outright what Tier 1 has to infer:

| File | What it gives |
|---|---|
| `prerender-manifest.json` | exactly which routes are SSG/ISR and their revalidate values |
| `routes-manifest.json` | every redirect, rewrite, header rule, dynamic route, i18n config |
| `app-build-manifest.json` | JS shipped per route |
| `app-path-routes-manifest.json` | the full App Router route table |
| `build-manifest.json` | shared and per-page chunks |

### Source analysis

- `generateMetadata` / `metadata` exports — missing `metadataBase` (relative OG image
  URLs, a very common production bug), missing `alternates.canonical`, and the classic
  metadata export inside a `'use client'` component, which silently does nothing.
- `'use client'` boundary placement — a client component high in the tree pulls its
  whole subtree out of server rendering.
- Route segment config — `dynamic`, `revalidate`, `fetchCache`, `runtime` per segment.
- `next.config` — `trailingSlash` versus the links actually emitted (this is exactly
  the "Internal redirects from trailing slash mismatch" finding on the user's own
  dashboard, 4 pages), `images.remotePatterns`, `redirects()`, `i18n`.
- `app/sitemap.ts` and `app/robots.ts` — present, and consistent with what is served.
- `not-found.tsx` reachable via a catch-all that returns 200 — the classic soft 404.

### The feature that only white-box makes possible

**Pre-deploy regression detection.** Diff this build's manifests against the last
green build and fail the PR on a real regression:

```
✗ /blog/[slug] changed from ISR(3600) to force-dynamic
  4,182 URLs lose edge caching. Cause: cookies() added in app/blog/[slug]/page.tsx:12
✗ /products route JS +180 KB (recharts pulled into a client component)
✓ 0 new metadata regressions
```

Every competitor reports this after the bad deploy is live and indexed. We report it
before merge. That is the product.

## Check inventory

| Pack | Count | Status |
|---|---:|---|
| Next.js black-box (Tier 1) | 13 | implemented, verified on live sites |
| Next.js white-box (Tier 2) | ~35 | designed, not yet built |
| Standard SEO parity (Sitechecker's 15 categories) | ~300 | designed, not yet built |

Parity matters: without the standard checks this is a niche linter, not a replacement
for the tool being paid for. But parity is commodity work — the taxonomy is fully
mapped in `research/COMPETITIVE-ANALYSIS.md` and the checks are mostly mechanical.
The Next.js packs are what make anyone switch.
