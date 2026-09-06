import { connection } from 'next/server';
import Link from 'next/link';
import { listProjects } from '@/src/crawler/store.ts';
import { scoreBand } from '../ui.tsx';
import { AddProject } from './add-project.tsx';
import { pageMeta } from '../meta.ts';
import { PageNotes } from '../page-notes.tsx';

export const instant = false;
export const metadata = pageMeta({
  title: 'Your website projects',
  description: 'Every website you audit, as one project — with its latest health score and trend across all crawls.',
  path: '/projects',
});

const fmtAgo = (ts: number): string => {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
};

function Delta({ latest, first }: { latest: number; first: number }) {
  const d = Math.round((latest - first) * 10) / 10;
  if (d === 0) return <span className="font-mono text-[11px] text-muted">±0 since first</span>;
  const up = d > 0;
  return (
    <span className={'font-mono text-[11px] ' + (up ? 'text-opportunity' : 'text-blocker')}>
      {up ? '+' : ''}{d} since first audit
    </span>
  );
}

export default async function ProjectsPage() {
  await connection();
  const projects = await listProjects();

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-[30px] font-bold tracking-tight">Your website projects</h1>
        <p className="mt-2 max-w-[68ch] text-[14px] leading-relaxed text-muted">
          Each website is one project. Audit it as many times as you like — every crawl adds to its
          history, so you can watch its health improve over time.
        </p>
      </div>

      <AddProject />

      {projects.length === 0 ? (
        <p className="border border-line bg-surface p-8 text-center text-[14px] text-muted">
          No projects yet. Add a website above to get started.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const band = p.latestScore !== null ? scoreBand(p.latestScore) : null;
            return (
              <Link key={p.siteId} href={`/project/${p.siteId}`}
                className="flex flex-col gap-3 border border-line bg-surface p-5 no-underline transition-colors hover:border-ink">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-medium text-ink">
                      {p.origin.replace(/^https?:\/\//, '')}
                    </div>
                    <div className="mt-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
                      {p.crawlCount} {p.crawlCount === 1 ? 'audit' : 'audits'}
                      {p.isNext && <span className="text-accent"> · Next.js</span>}
                    </div>
                  </div>
                  {band ? (
                    <span className={'tnum shrink-0 text-[30px] font-normal leading-none tracking-tight ' + band.text}>
                      {p.latestScore!.toFixed(0)}
                    </span>
                  ) : (
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted">no audit</span>
                  )}
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
                  {p.latestScore !== null && p.firstScore !== null
                    ? <Delta latest={p.latestScore} first={p.firstScore} />
                    : <span className="font-mono text-[11px] text-muted">Run the first audit →</span>}
                  {p.latestAt && <span className="font-mono text-[10px] text-muted">{fmtAgo(p.latestAt)}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <PageNotes
        title="How projects work"
        intro={<>A project is one website. Every audit you run against it is kept, so the score on each card
          is not a single reading but the latest point on a history you can open and scroll back through.
          That history is the reason to re-audit after a release rather than only when something looks wrong.</>}
        items={[
          { term: 'The score on each card', body: <>Technical health from the most recent crawl, 0&ndash;100, on a
            fixed and versioned rubric. Because the rubric never changes between runs, a difference between two
            audits is a real change in the site rather than a change in how it was measured.</> },
          { term: 'The delta underneath', body: <>Movement since the first audit of that project. It is the number
            worth watching: a site can sit at a middling score for months and still be steadily improving, or
            hold a good score while quietly regressing on the pages that matter.</> },
          { term: 'Adding a website', body: <>Paste any URL. The crawler discovers pages from your sitemaps and
            internal links, respects robots.txt, and detects what the site is built with before deciding which
            checks apply &mdash; so a static marketing site is not marked down for lacking a framework it never used.</> },
          { term: 'How many pages', body: <>Each audit walks up to the page budget you set. Pages are ranked by
            internal link equity first, so a partial crawl still covers the pages that carry the most weight
            rather than whichever ones happened to be found first.</> },
          { term: 'Opening a project', body: <>The project view stacks every crawl into one trend, with the issues
            that opened and closed between any two runs. This is where a regression gets traced back to the
            release that caused it.</> },
          { term: 'What a score does not mean', body: <>This is technical health, not a ranking forecast. It
            measures how well the site is built and how cleanly it can be crawled and indexed &mdash; the part that
            is fully in your control. Ranking also needs content worth reading and links from elsewhere, and
            the tool deliberately does not pretend to score those here.</> },
          { term: 'Comparing two sites', body: <>Scores are comparable across projects because the rubric is
            fixed rather than derived from each crawl. A small brochure site and a large catalogue are still
            different problems, though: the same score on a hundred pages represents far more work than on
            five.</> },
          { term: 'Removing a project', body: <>Deleting a project removes its crawls and the history with them.
            If the goal is only to stop scheduled runs, leave the project and drop it from the schedule instead
            &mdash; the trend is the part that took time to accumulate.</> },
          { term: 'When to re-audit', body: <>After a release, after a migration, and on a slow cadence in
            between. Most regressions arrive with a deploy rather than accumulating gradually, so a crawl
            immediately after one is worth more than a dozen spread across a quiet month. The exception is a
            site with an editorial team, where new pages ship continuously and a weekly crawl catches the
            templates that were copied from a broken example.</> },
        ]}
        footnote={<>Auditing a site you do not control is fine &mdash; the crawler only reads public pages, obeys
          robots.txt and identifies itself. Rank tracking and Search Console data are the parts that need
          access you actually own.</>}
      />
    </div>
  );
}
