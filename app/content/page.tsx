import { connection } from 'next/server';
import Link from 'next/link';
import { listProjects, projectCrawls, loadReport, hasSnapshot } from '@/src/crawler/store.ts';
import { gradesForCrawl, llmConfigured, activeProvider } from '@/src/core/content/grade.ts';
import { ScoreDial } from '../ui.tsx';
import { Section, MeterBar, SitePicker } from '../panel.tsx';
import { ContentGrader, type PageRow, type GradeRow } from './grader.tsx';
import { pageMeta } from '../meta.ts';

export const instant = false;
export const metadata = pageMeta({
  title: 'Content quality',
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
  const pages: PageRow[] = crawlId
    ? await Promise.all(candidates.map(async (p) => ({
        url: p.url, title: p.title, words: p.wordCount, pageRank: p.pageRank,
        hasSnapshot: await hasSnapshot(crawlId, p.url),
      })))
    : [];

  const stored = crawlId ? await gradesForCrawl(crawlId) : [];
  const grades: Record<string, GradeRow> = {};
  for (const g of stored) {
    grades[g.url] = {
      url: g.url, overall: g.overall, depth: g.depth, relevance: g.relevance,
      readability: g.readability, originality: g.originality, trust: g.trust,
      structure: g.structure, verdict: g.verdict, intent: g.intent,
      strengths: g.strengths, fixes: g.fixes, gradedAt: g.gradedAt, words: g.words,
    };
  }

  const avg = stored.length ? Math.round(stored.reduce((s, g) => s + g.overall, 0) / stored.length) : null;
  const weakest = stored.length ? stored[0]! : null; // sorted worst-first
  const host = selected.origin.replace(/^https?:\/\//, '');

  // Average of each dimension, so you can see what the site is systematically bad at.
  const dim = (pick: (g: typeof stored[number]) => number) =>
    stored.length ? Math.round(stored.reduce((s, g) => s + pick(g), 0) / stored.length) : 0;

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

      {/* ---- summary ---- */}
      {stored.length > 0 && avg !== null && (
        <div className="flex flex-col gap-8 border border-line bg-surface p-6 lg:flex-row lg:items-center">
          <div className="flex items-center gap-5">
            <ScoreDial score={avg} />
            <div className="lg:hidden">
              <div className="text-[15px] font-medium text-ink">{host}</div>
              <div className="text-[12.5px] text-muted">Average quality</div>
            </div>
          </div>
          <div className="flex-1">
            <div className="hidden lg:block">
              <h2 className="text-[15px] font-medium text-ink">Average quality · {host}</h2>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Across {stored.length} graded {stored.length === 1 ? 'page' : 'pages'}. Feeds the score on{' '}
                <Link href="/ai-visibility" className="text-accent hover:underline">AI visibility</Link>.
              </p>
            </div>
            <div className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-3">
              <MeterBar label="Depth" got={dim((g) => g.depth)} max={100} />
              <MeterBar label="Originality" got={dim((g) => g.originality)} max={100} />
              <MeterBar label="Expertise" got={dim((g) => g.trust)} max={100} />
              <MeterBar label="Relevance" got={dim((g) => g.relevance)} max={100} />
              <MeterBar label="Readability" got={dim((g) => g.readability)} max={100} />
              <MeterBar label="Structure" got={dim((g) => g.structure)} max={100} />
            </div>
            {weakest && (
              <p className="mt-4 text-[12.5px] leading-relaxed text-muted">
                <span className="text-ink">Weakest page ({weakest.overall}/100):</span>{' '}
                {weakest.url.replace(/^https?:\/\/[^/]+/, '') || '/'} — {weakest.verdict}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ---- grader ---- */}
      <Section
        title="Grade your pages"
        question="Each page is read once and scored on six dimensions, with specific fixes. Results are saved, so re-opening never re-spends."
        status={stored.length ? `${stored.length} of ${pages.length} graded` : 'None graded yet'}
        tone={stored.length ? 'good' : 'neutral'}
      >
        <div className="px-6 py-5">
          {!configured ? (
            <div className="border border-warning bg-ground p-5">
              <h3 className="text-[14px] font-medium text-ink">Connect an AI key to grade your writing</h3>
              <p className="mt-1.5 max-w-[76ch] text-[13px] leading-relaxed text-muted">
                Add one key to <span className="font-mono text-ink">.env.local</span> and restart. It stays on this
                machine and is only sent to the provider you choose.
              </p>
              <pre className="scroll-x mt-3 border border-line bg-surface p-3 font-mono text-[11.5px] text-ink">
{`GEMINI_API_KEY=…        # best free allowance
GROQ_API_KEY=gsk_…      # fastest per page
ANTHROPIC_API_KEY=sk-…  # strongest judgement (paid)`}
              </pre>
            </div>
          ) : pages.length === 0 ? (
            <p className="text-[13.5px] text-muted">No pages to grade in the latest audit for this website.</p>
          ) : (
            <ContentGrader crawlId={crawlId!} pages={pages} grades={grades} configured={configured} />
          )}
        </div>
      </Section>

      <p className="text-[12.5px] leading-relaxed text-muted">
        Re-run an audit and grade again to see whether a rewrite actually improved a page.
        {provider && <> Grading with <span className="font-mono text-ink">{provider.model}</span> via {provider.label}.</>}
      </p>
    </div>
  );
}
