import { loadReport, loadSnapshot } from '@/src/crawler/store.ts';
import { gradePage, saveGrade, gradeFor, llmConfigured } from '@/src/core/content/grade.ts';

/** Grading is a paid model call per page, so cap how many one request can spend. */
const MAX_PAGES = 10;

/**
 * Grade the content of one or more pages from a stored crawl.
 * Body: { crawlId, urls: string[], force?: boolean }
 */
export async function POST(req: Request) {
  if (!llmConfigured()) {
    return Response.json({ error: 'No AI key configured. Add ANTHROPIC_API_KEY to .env.local and restart.' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const crawlId = String(body['crawlId'] ?? '').trim();
  const urls = Array.isArray(body['urls']) ? (body['urls'] as unknown[]).map(String).slice(0, MAX_PAGES) : [];
  const force = body['force'] === true;
  if (!crawlId) return Response.json({ error: 'Missing audit id.' }, { status: 400 });
  if (urls.length === 0) return Response.json({ error: 'Pick at least one page to grade.' }, { status: 400 });

  const report = await loadReport(crawlId);
  if (!report) return Response.json({ error: 'That audit could not be found.' }, { status: 404 });

  const byUrl = new Map(report.pages.map((p) => [p.url, p]));
  const results: Array<{ url: string; ok: boolean; error?: string }> = [];

  // Sequential on purpose: it keeps spend predictable and avoids hammering the
  // rate limit when someone selects ten pages at once.
  for (const url of urls) {
    if (!force && await gradeFor(crawlId, url)) { results.push({ url, ok: true }); continue; }

    const page = byUrl.get(url);
    const snap = await loadSnapshot(crawlId, url);
    if (!snap) {
      results.push({ url, ok: false, error: 'No saved copy of this page — re-run the audit to store one.' });
      continue;
    }

    const outcome = await gradePage({
      url,
      title: page?.title ?? null,
      description: page?.description ?? null,
      html: snap.html,
    });

    if (outcome.ok) {
      await saveGrade(crawlId, url, outcome.grade, outcome.words, outcome.model);
      results.push({ url, ok: true });
    } else {
      results.push({ url, ok: false, error: outcome.error });
    }
  }

  return Response.json({ results });
}
