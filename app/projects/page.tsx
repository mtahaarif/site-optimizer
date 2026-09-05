import { connection } from 'next/server';
import Link from 'next/link';
import { listProjects } from '@/src/crawler/store.ts';
import { scoreBand } from '../ui.tsx';
import { AddProject } from './add-project.tsx';
import { pageMeta } from '../meta.ts';

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
    <span className="font-mono text-[11px]" style={{ color: up ? 'rgb(var(--opportunity))' : 'rgb(var(--blocker))' }}>
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
        <h1 className="text-[30px] font-bold tracking-tight">Projects</h1>
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
                    <span className="tnum shrink-0 text-[30px] font-normal leading-none tracking-tight" style={{ color: band.color }}>
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
    </div>
  );
}
