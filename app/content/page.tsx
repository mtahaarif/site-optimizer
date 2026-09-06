import { connection } from 'next/server';
import Link from 'next/link';
import { projectCrawls, loadReport, snapshotUrlKeys } from '@/src/crawler/store.ts';
import { gradesForCrawl, llmConfigured, activeProvider } from '@/src/core/content/grade.ts';
import { SitePicker } from '../panel.tsx';
import type { PageRow, GradeRow } from './grader.tsx';
import type { CellRow } from './locations.tsx';
import type { LocationRow } from './places.tsx';
import { ContentWorkbench } from './workbench.tsx';
import { listLocations, locationContentForSite } from '@/src/core/locations/store.ts';
import { normalizeUrl } from '@/src/core/extract.ts';
import { pageMeta } from '../meta.ts';
import { PageNotes } from '../page-notes.tsx';
import { auditedProjects, selectSite, canonicalPath } from '../selected-site.ts';

export const instant = false;

const BASE = '/content';

/** Per website, for the reasons set out in ai-visibility/page.tsx. */
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ site?: string }> },
) {
  const projects = await auditedProjects();
  if (projects.length === 0) {
    return pageMeta({
      title: 'Content quality, page by page',
      description: 'An AI editor reads your pages and scores them on depth, originality and expertise — the things search engines actually reward.',
      path: BASE,
    });
  }
  const sel = selectSite(projects, (await searchParams).site);
  return pageMeta({
    title: `Content quality for ${sel.host}`,
    description: `An AI editor reads every page on ${sel.host} and scores it on depth, originality and expertise — the things search engines actually reward.`,
    path: canonicalPath(BASE, sel),
  });
}

export default async function ContentPage({
  searchParams,
}: { searchParams: Promise<{ site?: string }> }) {
  await connection();
  const { site } = await searchParams;

  const configured = llmConfigured();
  const provider = activeProvider();
  const projects = await auditedProjects();

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

  const { selected, fallback } = selectSite(projects, site);

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
  // Everything below depends only on the crawl id or the site id, both of which
  // are known by now — so it is read in one wave rather than five awaits in a
  // row. Two of these (`snapshotUrlKeys`, `locationContentForSite`) are already
  // single queries for a whole set; the win here is not issuing them one after
  // another. See the note in snapshotUrlKeys about why per-row queries are not
  // an option on a single pooled connection.
  const [snapshots, rawLocations, rawCells, stored] = await Promise.all([
    crawlId ? snapshotUrlKeys(crawlId) : Promise.resolve(new Set<string>()),
    listLocations(selected.siteId),
    locationContentForSite(selected.siteId),
    crawlId ? gradesForCrawl(crawlId) : Promise.resolve([]),
  ]);

  const pages: PageRow[] = candidates.map((p) => ({
    url: p.url, title: p.title, words: p.wordCount, pageRank: p.pageRank,
    hasSnapshot: snapshots.has(normalizeUrl(p.url)),
  }));

  const locations: LocationRow[] = rawLocations.map((l) => ({ id: l.id, label: l.label }));
  const cells: CellRow[] = rawCells.map((c) => ({
    locationId: c.locationId, url: c.url, coverage: c.coverage, signals: c.signals,
    verdict: c.verdict, recommendations: c.recommendations, draft: c.draft,
    analysedAt: c.analysedAt, generatedAt: c.generatedAt,
  }));

  // Worst-first, which is the order the summary and the weakest-page callout
  // both rely on.
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
          Is the writing on {host} worth quoting?
        </h1>
        <p className="mt-2 max-w-[76ch] text-[14px] leading-relaxed text-muted">
          Every other check asks whether a page is <em>built</em> well. This one asks whether it is worth
          reading — depth, originality and evidence of real expertise. It is the biggest single thing search
          engines reward, and the only part a crawler cannot work out from the markup.
        </p>
      </header>

      <SitePicker projects={projects} selectedId={selected.siteId}
        defaultId={fallback.siteId} base={BASE} />

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

      <PageNotes
        title="What a grade here actually measures"
        intro={<>Every other check in this tool inspects markup. This one reads the words, which means it is the
          only score here that a crawler could never produce on its own &mdash; and the only one that maps onto what
          a reader, or a model deciding whether to quote you, is actually reacting to.</>}
        items={[
          { term: 'Depth', body: <>Whether the page answers its question completely or stops at the summary.
            Thin pages are not penalised for being short; they are penalised for leaving the obvious follow-up
            question unanswered, which is what sends a reader back to the results.</> },
          { term: 'Originality', body: <>Whether the page says anything that is not on the ten pages that already
            rank for the same phrase. Reworded consensus is the most common failure mode and the hardest to see
            from the inside, because it reads perfectly well.</> },
          { term: 'Expertise', body: <>Evidence that someone who has actually done the thing wrote it: specifics,
            numbers, named trade-offs, the failure cases. Claims of authority count for nothing here; only the
            detail that would be expensive to fake does.</> },
          { term: 'Structure and readability', body: <>Whether a reader can find the answer by scanning, and
            whether a model can lift a clean passage out of the page. Both come down to headings that describe
            their sections and paragraphs that make one point each.</> },
          { term: 'Location coverage', body: <>How well each page names the places you actually serve. This counts
            mentions across the title, headings, body, URL and local schema &mdash; it does not judge whether the page
            is good. The same copy repeated per city is a doorway page, and search engines penalise it.</> },
          { term: 'Search intent', body: <>Which of the four intents a page reads as &mdash; informational,
            commercial, transactional or navigational &mdash; and whether that matches what the phrase it targets
            actually wants. A buying-guide page competing against product pages is not a writing problem,
            and no amount of rewriting fixes it.</> },
          { term: 'Why word count is not scored', body: <>Length is an output of covering a topic, never an
            input. A 400-word page that answers the question completely outscores a 2,000-word one that
            circles it, and padding to hit a target is the single most common way to make a page worse.</> },
        ]}
        footnote={<>Grades are a second opinion, not a verdict. Read the specific fixes for a page before acting
          on its number, and re-grade after a rewrite: the comparison between two grades of the same page is far
          more informative than either grade on its own.</>}
      />
    </div>
  );
}
