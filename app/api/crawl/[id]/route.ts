import { NextResponse } from 'next/server';
import { getJob, loadReport, deleteReport } from '@/src/crawler/store.ts';


type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const job = getJob(id);

  // A live job reports progress; a finished one may only exist on disk.
  if (job && job.status !== 'done') {
    return NextResponse.json({
      status: job.status,
      progress: job.progress,
      error: job.error,
      report: null,
    });
  }

  const report = await loadReport(id);
  if (!report) return NextResponse.json({ error: 'Crawl not found' }, { status: 404 });

  return NextResponse.json({
    status: 'done',
    progress: job?.progress ?? null,
    error: null,
    report,
  });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteReport(id);
  return NextResponse.json({ ok: true });
}
