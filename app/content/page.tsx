import { connection } from 'next/server';
import Link from 'next/link';
import { listProjects, projectCrawls, loadReport, snapshotUrlKeys } from '@/src/crawler/store.ts';
import { gradesForCrawl, llmConfigured, activeProvider } from '@/src/core/content/grade.ts';
import { SitePicker } from '../panel.tsx';
import type { PageRow, GradeRow } from './grader.tsx';
import type { CellRow } from './locations.tsx';
import type { LocationRow } from './places.tsx';
import { ContentWorkbench } from './workbench.tsx';
import { listLocations, locationContentForSite } from '@/src/core/locations/store.ts';
import { normalizeUrl } from '@/src/core/extract.ts';
import { pageMeta } from '../meta.ts';

export const instant = false;
export const metadata = pageMeta({
  title: 'Content quality, page by page',
  description: 'An AI editor reads your pages and scores them on depth, originality and expertise — the things search engines actually reward.',
  path: '/content',
});

export default async function ContentPage({
  searchParams,
}: { searchParams: Promise<{ site?: string }> }) {
  await connection();
  const { site } = await searchParams;

  const configured = llmConfigured();
  const provider = activeProvider();
  const projects = (await listProjects()).filter((p) => p.crawlCount > 0);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[32px] font-bold tracking-tight">Content quality</h1>
        <p className="border border-line bg-surface p-8 text-center text-[14px] text-muted">
          Audit a website first — grading reads the pages it saved.{' '}
          <Link href="/projects" className="text-accent hover:underline">Go to projects →</Link>
        </p>
      </div>
    );
  }

  const selected = projects.find((p) => String(p.siteId) === site)
    ?? projects.slice().sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0))[0]!;

  const crawls = await projectCrawls(selected.siteId);
  const crawlId = crawls.length ? crawls[crawls.length - 1]!.id : null;
  const report = crawlId ? await loadReport(crawlId) : null;

  // Reports crawled before the alias-dedupe fix can list the same URL twice.
  const seen = new Set<string>();
  const candidates = report && crawlId
    ? report.pages
      .filter((p) => p.isHtml && p.status === 200)
      .filter((p) => (seen.has(p.url) ? false : (seen.add(p.url), true)))
      .sort((a, b) => b.pageRank - a.pageRank)
      .slice(0, 60)
    : [];
  // One query for the whole set, not one per page: the pool holds a single
  // connection, so sixty round trips to a remote database is a timeout.
  const snapshots = crawlId ? await snapshotUrlKeys(crawlId) : new Set<string>();
  const pages: PageRow[] = candidates.map((p) => ({
    url: p.url, title: p.title, words: p.wordCount, pageRank: p.pageRank,
    hasSnapshot: snapshots.has(normalizeUrl(p.url)),
  }));

  const locations: LocationRow[] = (await listLocations(selected.siteId))
    .map((l) => ({ id: l.id, label: l.label }));
  const cells: CellRow[] = (await locationContentForSite(selected.siteId))
    .map((c) => ({
      locationId: c.locationId, url: c.url, coverage: c.coverage, signals: c.signals,
      verdict: c.verdict, recommendations: c.recommendations, draft: c.draft,
      analysedAt: c.analysedAt, generatedAt: c.generatedAt,
    }));

  // Worst-first, which is the order the summary and the weakest-page callout
  // both rely on.
  const stored = crawlId ? await gradesForCrawl(crawlId) : [];
  const grades: GradeRow[] = stored.map((g) => ({
    url: g.url, overall: g.overall, depth: g.depth, relevance: g.relevance,
    readability: g.readability, originality: g.originality, trust: g.trust,
    structure: g.structure, verdict: g.verdict, intent: g.intent,
    strengths: g.strengths, fixes: g.fixes, gradedAt: g.gradedAt, words: g.words,
    locations: g.locations, localFit: g.localFit ?? [],
  }));

  const host = selected.origin.replace(/^https?:\/\//, '');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-muted">Content quality</p>
        <h1 className="mt-2 max-w-[24ch] text-[32px] font-bold leading-[1.08] tracking-tight">
          Is your writing worth quoting?
        </h1>
        <p className="mt-2 max-w-[76ch] text-[14px] leading-relaxed text-muted">
          Every other check asks whether a page is <em>built</em> well. This one asks whether it is worth
          reading — depth, originality and evidence of real expertise. It is the biggest single thing search
          engines reward, and the only part a crawler cannot work out from the markup.
        </p>
      </header>

      <SitePicker projects={projects} selectedId={selected.siteId} base="/content" />

      <ContentWorkbench
        siteId={selected.siteId}
        crawlId={crawlId}
        host={host}
        pages={pages}
        grades={grades}
        cells={cells}
        locations={locations}
        aiConfigured={configured}
      />

      <p className="text-[12.5px] leading-relaxed text-muted">
        The places above are the same list{' '}
        <Link href="/ranks" className="text-accent hover:underline">search rankings</Link> uses — check
        where you actually place in each city, then come back and fix the pages that fall short.
        Re-run an audit and grade again to see whether a rewrite improved a page.
        {provider && <> Grading with <span className="font-mono text-ink">{provider.model}</span> via {provider.label}.</>}
      </p>
    </div>
  );
}
