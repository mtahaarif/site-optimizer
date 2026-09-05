import { NextResponse, after } from 'next/server';
import { runAudit } from '@/src/crawler/audit.ts';
import { DEFAULT_OPTIONS } from '@/src/crawler/crawl.ts';
import {
  createJob, updateProgress, completeJob, failJob, listReports, saveSnapshots,
  type PageSnapshot,
} from '@/src/crawler/store.ts';

// A large crawl outlives the default handler budget.
export const maxDuration = 900;

export async function GET() {
  return NextResponse.json({ reports: await listReports() });
}

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const raw = String(body['url'] ?? '').trim();
  if (!raw) return NextResponse.json({ error: 'Enter a URL to crawl' }, { status: 400 });

  let startUrl: string;
  try {
    const u = new URL(raw.includes('://') ? raw : 'https://' + raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('bad protocol');
    startUrl = u.toString();
  } catch {
    return NextResponse.json({ error: 'That does not look like a valid http(s) URL' }, { status: 400 });
  }

  const clamp = (v: unknown, min: number, max: number, dflt: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
  };

  const options = {
    startUrl,
    maxPages: clamp(body['maxPages'], 1, 5000, DEFAULT_OPTIONS.maxPages),
    maxDepth: clamp(body['maxDepth'], 1, 20, DEFAULT_OPTIONS.maxDepth),
    concurrency: clamp(body['concurrency'], 1, 16, DEFAULT_OPTIONS.concurrency),
    timeoutMs: clamp(body['timeoutMs'], 2000, 60_000, DEFAULT_OPTIONS.timeoutMs),
    checkAssets: body['checkAssets'] !== false,
    respectRobots: body['respectRobots'] !== false,
    includeSubdomains: body['includeSubdomains'] === true,
    maxPagespeedPages: clamp(body['maxPagespeedPages'], 0, 10, DEFAULT_OPTIONS.maxPagespeedPages),
    renderJs: body['renderJs'] === true,
    jsWaitUntil: (['load', 'domcontentloaded', 'networkidle'] as const)
      .find((w) => w === body['jsWaitUntil']) ?? DEFAULT_OPTIONS.jsWaitUntil,
    jsTimeoutMs: clamp(body['jsTimeoutMs'], 3000, 60_000, DEFAULT_OPTIONS.jsTimeoutMs),
    jsBlockResources: body['jsBlockResources'] !== false,
  };

  const id = crypto.randomUUID();
  await createJob(id, startUrl);

  // The response returns immediately and the client polls /status; the crawl
  // itself keeps running via after(), which is what actually keeps a
  // serverless function alive past the point its response has been sent —
  // an un-awaited promise alone is not a guarantee of that on Vercel.
  after(async () => {
    try {
      // Snapshots are buffered, not written as they arrive: page_snapshots has a
      // foreign key to crawls(id), and that row does not exist until the report
      // is saved below.
      let snapshots: PageSnapshot[] = [];
      const report = await runAudit(
        options,
        (p) => { void updateProgress(id, p); },
        { onSnapshots: (s) => { snapshots = s; } },
      );
      report.id = id;
      await completeJob(id, report);
      await saveSnapshots(id, snapshots);
    } catch (err) {
      await failJob(id, (err as Error).message);
    }
  });

  return NextResponse.json({ id });
}
