import Link from 'next/link';
import { loadReport } from '@/src/crawler/store.ts';
import { PrintableReport } from './printable.tsx';

// Reads a stored report from Postgres, so there is no static shell to prerender.
export const instant = false;

/**
 * The print/PDF view of a stored audit.
 *
 * Deliberately `noindex`: it is the same audit as /crawl/[id] in a different
 * shape, and letting both into the index is the duplicate-content pattern this
 * tool exists to report. `follow` stays on so the link back to the interactive
 * report still passes equity.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await loadReport(id);
  const host = report?.origin.replace(/^https?:\/\//, '') ?? 'this site';
  return {
    title: { absolute: `Audit of ${host} — printable report` },
    description: `A printable, PDF-ready version of the technical SEO audit of ${host}.`,
    robots: { index: false, follow: true },
    alternates: { canonical: `/crawl/${id}` },
  };
}

export default async function PrintReportPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ print?: string }>;
}) {
  const [{ id }, { print }] = await Promise.all([params, searchParams]);
  const report = await loadReport(id);

  if (!report) {
    return (
      <div className="mx-auto max-w-[640px] py-16 text-center">
        <h1 className="text-[22px] font-bold tracking-tight">Report not found</h1>
        <p className="mt-2 text-[14px] text-muted">
          This audit has no stored report — it may still be running, or it may have been deleted.
        </p>
        <Link href="/projects" className="mt-4 inline-block text-accent hover:underline">
          Back to projects →
        </Link>
      </div>
    );
  }

  return <PrintableReport report={report} autoPrint={print === '1'} />;
}
