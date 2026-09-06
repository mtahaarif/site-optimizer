import { loadReport, loadSnapshot } from '@/src/crawler/store.ts';
import { gradePage, saveGrade, gradeFor, llmConfigured } from '@/src/core/content/grade.ts';
import { listLocations } from '@/src/core/locations/store.ts';

/** Grading is a paid model call per page, so cap how many one request can spend. */
const MAX_PAGES = 10;

/**
 * Grade the content of one or more pages from a stored crawl.
 * Body: { crawlId, urls: string[], force?: boolean, siteId?: number, locationIds?: number[] }
 *
 * Locations are optional context. With none, this is a plain quality grade —
 * the behaviour every existing caller gets. With some, the model is also asked
 * how well each page serves those places, which is the same list the optimiser
 * and rank tracking work from.
 */
export async function POST(req: Request) {
  if (!llmConfigured()) {
    return Response.json({ error: 'No AI key configured. Add GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY to .env.local and restart.' }, { status: 400 });
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

  const siteId = Number(body['siteId']);
  const locationIds = Array.isArray(body['locationIds'])
    ? (body['locationIds'] as unknown[]).map(Number).filter(Number.isFinite)
    : [];

  // Labels are resolved from the site's own list rather than taken from the
  // request, so the place a grade was made against is always one the user
  // actually saved — and the stored label matches what rank tracking uses.
  let locations: string[] = [];
  if (locationIds.length > 0 && Number.isFinite(siteId) && siteId > 0) {
    locations = (await listLocations(siteId))
      .filter((l) => locationIds.includes(l.id))
      .map((l) => l.label);
  }

  const report = await loadReport(crawlId);
  if (!report) return Response.json({ error: 'That audit could not be found.' }, { status: 404 });

  const byUrl = new Map(report.pages.map((p) => [p.url, p]));
  const results: Array<{ url: string; ok: boolean; error?: string }> = [];

  // Sequential on purpose: it keeps spend predictable and avoids hammering the
  // rate limit when someone selects ten pages at once.
  for (const url of urls) {
    // A stored grade is reused only when it was made against the same places.
    // Skipping that check would silently answer a location question with a
    // grade that never considered one.
    if (!force) {
      const existing = await gradeFor(crawlId, url);
      if (existing && sameLocations(existing.locations, locations)) {
        results.push({ url, ok: true });
        continue;
      }
    }

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
      locations,
    });

    if (outcome.ok) {
      await saveGrade(crawlId, url, outcome.grade, outcome.words, outcome.model, locations);
      results.push({ url, ok: true });
    } else {
      results.push({ url, ok: false, error: outcome.error });
    }
  }

  return Response.json({ results });
}

/** Order is not meaningful — the same places ticked in a different sequence is the same request. */
function sameLocations(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((v, i) => v === right[i]);
}
