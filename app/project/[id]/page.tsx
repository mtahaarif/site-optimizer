import { connection } from 'next/server';
import Link from 'next/link';
import { getSite } from '@/src/db/index.ts';
import { projectCrawls, loadReport } from '@/src/crawler/store.ts';
import type { Severity } from '@/src/core/scoring/model.ts';
import { CrawlForm } from '../../crawl-form.tsx';
import { Summary } from '../../crawl/[id]/summary.tsx';
import {
  ProjectScoreCard, ScoreTrend, IssuesTrend, ProjectAudits, ProjectDiff,
  type ProjectCrawl, type IssueRef,
} from './project-view.tsx';
import { DeleteProject } from './delete-project.tsx';
import { pageMeta } from '../../meta.ts';

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await getSite(Number(id));
  const raw = site ? site.origin.replace(/^https?:\/\//, '') : 'Project';
  const host = raw.length > 25 ? raw.slice(0, 25) + '…' : raw; // keep the title under 60 chars
  return pageMeta({
    title: `Audit history for ${host}`,
    description: `Audit history for ${host}: health over time, every failing check across crawls, and what changed since the first audit.`,
    path: `/project/${id}`,
  });
}

type OutcomeLike = { id: string; title: string; severity: Severity; status: string };
const failingIds = (outcomes: OutcomeLike[]): Map<string, IssueRef> => {
  const m = new Map<string, IssueRef>();
  for (const o of outcomes) if (o.status === 'failed') m.set(o.id, { id: o.id, title: o.title, severity: o.severity });
  return m;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 border-b border-line pb-2 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  const siteId = Number(id);
  const site = await getSite(siteId);

  if (!site) {
    return (
      <div className="py-16">
        <Link href="/projects" className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink">← Projects</Link>
        <p className="mt-6 text-[15px] text-muted">Project not found.</p>
      </div>
    );
  }

  const history = await projectCrawls(siteId); // oldest → newest
  const host = site.origin.replace(/^https?:\/\//, '');

  // Only the first and latest reports are needed: the latest drives the full
  // report view below, the first is the baseline for the since-first diff.
  const latestReport = history.length ? await loadReport(history[history.length - 1]!.id) : null;
  const firstReport = history.length > 1 ? await loadReport(history[0]!.id) : null;

  let fixedSinceFirst: IssueRef[] = [];
  let appearedSinceFirst: IssueRef[] = [];
  if (firstReport && latestReport) {
    const a = failingIds(firstReport.outcomes);
    const b = failingIds(latestReport.outcomes);
    fixedSinceFirst = [...a.values()].filter((r) => !b.has(r.id));
    appearedSinceFirst = [...b.values()].filter((r) => !a.has(r.id));
  }

  const crawls: ProjectCrawl[] = history.map((c) => ({
    id: c.id, created_at: c.created_at, score: c.score,
    issues: c.checks_failed, blockers: c.blockers, criticals: c.criticals, warnings: c.warnings,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/projects" className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink">← Projects</Link>
          <h1 className="mt-3 text-[28px] font-normal tracking-tight">Audit history for {host}</h1>
          <p className="mt-1 font-mono text-[11.5px] text-muted">
            {history.length} {history.length === 1 ? 'audit' : 'audits'}
            {history.length > 0 && <> · since {new Date(history[0]!.created_at).toLocaleDateString()}</>}
          </p>
        </div>
        <DeleteProject siteId={siteId} origin={host} />
      </div>

      {crawls.length === 0 ? (
        <p className="border border-line bg-surface p-8 text-center text-[14px] text-muted">
          No audits yet for this website. Run the first one below.
        </p>
      ) : (
        <>
          <ProjectScoreCard crawls={crawls} />
          <div className="grid gap-3 lg:grid-cols-2">
            <ScoreTrend crawls={crawls} />
            <IssuesTrend crawls={crawls} />
          </div>
        </>
      )}

      <Section title="Run a new audit">
        <CrawlForm initialUrl={site.origin} lockUrl />
      </Section>

      {crawls.length > 0 && (
        <Section title="All audits">
          <ProjectAudits crawls={crawls} />
        </Section>
      )}

      {crawls.length > 1 && (
        <ProjectDiff fixed={fixedSinceFirst} appeared={appearedSinceFirst} />
      )}

      {latestReport && (
        <Section title={`Latest audit · ${new Date(history[history.length - 1]!.created_at).toLocaleString()}`}>
          <Summary report={latestReport} embedded />
        </Section>
      )}
    </div>
  );
}
