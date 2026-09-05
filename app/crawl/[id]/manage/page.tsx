import { connection } from 'next/server';
import Link from 'next/link';
import { loadReport } from '@/src/crawler/store.ts';
import { Manage } from './manage.tsx';
import { pageMeta } from '../../../meta.ts';

export const instant = false;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await loadReport(id);
  const raw = report ? report.origin.replace(/^https?:\/\//, '') : 'site';
  const host = raw.length > 25 ? raw.slice(0, 25) + '…' : raw; // keep the title under 60 chars
  return pageMeta({
    title: `Robots & sitemap · ${host}`,
    description: `Review and clean up the robots file and XML sitemaps for ${host} — problems are detected and a corrected file is generated for you to copy.`,
    path: `/crawl/${id}/manage`,
  });
}

async function fetchRobots(origin: string): Promise<{ text: string | null; error: string | null }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(origin.replace(/\/$/, '') + '/robots.txt', {
      signal: ctrl.signal,
      headers: { 'user-agent': 'SiteCheckerBot/1.0' },
      cache: 'no-store',
    });
    clearTimeout(t);
    if (!res.ok) return { text: null, error: `robots.txt returned HTTP ${res.status}.` };
    const text = await res.text();
    return { text: text.slice(0, 20000), error: null };
  } catch (e) {
    return { text: null, error: `Could not fetch robots.txt: ${(e as Error).message}` };
  }
}

export default async function ManagePage({ params }: { params: Promise<{ id: string }> }) {
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

  const robots = await fetchRobots(report.origin);

  return (
    <Manage
      crawlId={id}
      origin={report.origin}
      robotsText={robots.text}
      robotsError={robots.error}
      sitemaps={report.sitemaps ?? []}
    />
  );
}
