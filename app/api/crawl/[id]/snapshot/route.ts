import { NextResponse } from 'next/server';
import { loadSnapshot, snapshotStats } from '@/src/crawler/store.ts';
import { locateFinding } from '@/src/core/checks/locate.ts';
import { getSnippetFromOffset } from '@/src/core/utils/code.ts';

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/crawl/[id]/snapshot?url=<encoded>&checkId=<id>&context=5
 *
 * By default this resolves the finding's position and returns *only* the
 * surrounding lines. Shipping the whole document to render eleven lines would
 * repeat, on every code view, exactly the payload problem that keeps raw HTML
 * out of the main report.
 *
 * `?raw=1` returns the full HTML for callers that genuinely want it.
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const q = new URL(req.url).searchParams;

  const url = q.get('url');
  if (!url) return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });

  const snapshot = loadSnapshot(id, url);
  if (!snapshot) {
    const stats = snapshotStats(id);
    return NextResponse.json(
      {
        error: stats.count === 0
          ? 'No HTML snapshots were stored for this crawl. Snapshots are captured from the crawl onwards — re-run the audit to enable code view.'
          : 'No snapshot stored for this URL.',
      },
      { status: 404 },
    );
  }

  if (q.get('raw') === '1') {
    return new NextResponse(snapshot.html, {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const checkId = q.get('checkId');
  const contextLines = Math.max(0, Math.min(40, Number(q.get('context') ?? 6)));

  const location = checkId ? locateFinding(checkId, snapshot.html) : null;
  if (!location) {
    return NextResponse.json({
      url: snapshot.url,
      rendered: snapshot.rendered,
      rawBytes: snapshot.rawBytes,
      gzipBytes: snapshot.gzipBytes,
      located: false,
      reason: checkId
        ? 'This check has no identifiable position in the source, or its pattern was not found in the stored HTML.'
        : 'No checkId supplied.',
      snippet: null,
    });
  }

  const snippet = getSnippetFromOffset(snapshot.html, location.offset, contextLines, location.length);

  return NextResponse.json({
    url: snapshot.url,
    rendered: snapshot.rendered,
    rawBytes: snapshot.rawBytes,
    gzipBytes: snapshot.gzipBytes,
    located: true,
    label: location.label,
    offset: location.offset,
    snippet,
  });
}
