import { connection } from 'next/server';
import Link from 'next/link';
import { loadReport, crawlHistory, previousCrawlId } from '@/src/crawler/store.ts';
import type { AuditReport } from '@/src/crawler/audit.ts';
import { Compare, type IssueRef } from './compare.tsx';
import { pageMeta } from '../../../meta.ts';

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await loadReport(id);
  const raw = report ? report.origin.replace(/^https?:\/\//, '') : 'site';
  const host = raw.length > 25 ? raw.slice(0, 25) + '…' : raw; // keep the title under 60 chars
  return pageMeta({
    title: `Compare audits · ${host}`,
    description: `How ${host} changed between audits: score, pages and issues over time, plus the checks fixed or newly broken since the previous crawl.`,
    path: `/crawl/${id}/compare`,
  });
}

const failing = (r: AuditReport): IssueRef[] =>
  r.outcomes
    .filter((o) => o.status === 'failed')
    .map((o) => ({ id: o.id, title: o.title, severity: o.severity, count: o.affectedCount }));

export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;

  const report = await loadReport(id);
  if (!report) {
    return (
      <div className="py-16">
        <Link href="/projects" className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted hover:text-ink">← Projects</Link>
        <p className="mt-6 text-[15px] text-muted">Report not found.</p>
      </div>
    );
  }

  const history = await crawlHistory(id);
  const prevId = await previousCrawlId(id);
  const prev = prevId ? await loadReport(prevId) : null;

  return (
    <Compare
      origin={report.origin}
      createdAt={report.createdAt}
      history={history}
      current={failing(report)}
      previous={prev ? failing(prev) : null}
    />
  );
}
