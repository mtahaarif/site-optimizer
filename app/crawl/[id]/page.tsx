import { loadReport, getJob } from '@/src/crawler/store.ts';
import { CrawlView } from './view.tsx';
import { pageMeta } from '../../meta.ts';

// Reads live data from Postgres, so there is no static shell to prerender.
export const instant = false;

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components


export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await loadReport(id);
  if (!report) return { title: 'Audit report' };
  const raw = report.origin.replace(/^https?:\/\//, '');
  const host = raw.length > 25 ? raw.slice(0, 25) + '…' : raw; // keep the title under 60 chars
  // Include a short crawl id so each report's title is unique (two crawls of the
  // same site would otherwise share a title). Indexable with a self-canonical.
  return pageMeta({
    title: `Audit of ${host} · ${id.slice(0, 6)}`,
    description: `Technical health ${Math.round(report.score)}/100 for ${host} — ${report.counts?.checksFailed ?? 0} issues found across ${report.counts?.crawled ?? 0} pages.`,
    path: `/crawl/${id}`,
  });
}

export default async function CrawlPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await loadReport(id);
  const job = await getJob(id);

  return (
    <CrawlView
      id={id}
      initialReport={report}
      initialStatus={report ? 'done' : (job?.status ?? 'running')}
    />
  );
}
