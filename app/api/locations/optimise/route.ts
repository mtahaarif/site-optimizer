import { NextResponse } from 'next/server';
import { loadReport, loadSnapshot } from '@/src/crawler/store.ts';
import { listLocations, saveCoverage, saveGeneration } from '@/src/core/locations/store.ts';
import { analyseCoverage, type PageContent } from '@/src/core/locations/coverage.ts';
import { buildPrompt, optimiseForLocation } from '@/src/core/locations/optimise.ts';
import { llmConfigured } from '@/src/core/llm/provider.ts';
import { pageText } from '@/src/core/content/grade.ts';
import * as cheerio from 'cheerio';

/** Model calls cost money per (page x location); cap what one request can spend. */
const MAX_CELLS = 12;

type Mode = 'coverage' | 'prompt' | 'generate';

/** Subheadings, which the report summary does not carry but coverage looks at. */
function subheadings(html: string): string[] {
  const $ = cheerio.load(html);
  $('nav, header, footer').remove();
  return $('h2, h3').map((_, el) => $(el).text().replace(/\s+/g, ' ').trim())
    .get().filter(Boolean).slice(0, 30);
}

/**
 * POST { crawlId, siteId, urls[], locationIds[], mode, wantDraft?, businessContext? }
 *
 * Three modes, deliberately separate so cost is never a surprise:
 *
 *   coverage  free. Deterministic presence analysis for every (page, location)
 *             pair — the pass that tells you which cells are worth paying for.
 *   prompt    free. Returns the exact prompt for each pair, to paste into your
 *             own assistant. Runs the coverage pass first so the prompt is
 *             grounded in real analysis rather than a generic template.
 *   generate  spends one model call per pair.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const siteId = Number(body['siteId']);
  const crawlId = String(body['crawlId'] ?? '').trim();
  const mode = String(body['mode'] ?? 'coverage') as Mode;
  const wantDraft = body['wantDraft'] === true;
  const businessContext = String(body['businessContext'] ?? '').trim().slice(0, 600) || undefined;

  const urls = Array.isArray(body['urls']) ? (body['urls'] as unknown[]).map(String) : [];
  const locationIds = Array.isArray(body['locationIds'])
    ? (body['locationIds'] as unknown[]).map(Number).filter(Number.isFinite) : [];

  if (!Number.isFinite(siteId) || siteId <= 0) {
    return NextResponse.json({ error: 'A siteId is required.' }, { status: 400 });
  }
  if (!crawlId) return NextResponse.json({ error: 'Run an audit first — the page text comes from it.' }, { status: 400 });
  if (urls.length === 0) return NextResponse.json({ error: 'Pick at least one page.' }, { status: 400 });
  if (locationIds.length === 0) return NextResponse.json({ error: 'Pick at least one location.' }, { status: 400 });

  if (mode === 'generate' && !llmConfigured()) {
    return NextResponse.json({
      error: 'No AI key configured. Add GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY — '
        + 'or use "Copy prompt" to run this in your own assistant instead.',
    }, { status: 400 });
  }

  const report = await loadReport(crawlId);
  if (!report) return NextResponse.json({ error: 'That audit could not be found.' }, { status: 404 });

  const allLocations = await listLocations(siteId);
  const locations = allLocations.filter((l) => locationIds.includes(l.id));
  if (locations.length === 0) {
    return NextResponse.json({ error: 'Those locations are no longer saved.' }, { status: 400 });
  }

  const byUrl = new Map(report.pages.map((p) => [p.url, p]));
  const cells = urls.length * locations.length;
  if (mode === 'generate' && cells > MAX_CELLS) {
    return NextResponse.json({
      error: `That is ${cells} model calls (${urls.length} pages x ${locations.length} locations). `
        + `Generate at most ${MAX_CELLS} at a time so the spend stays visible.`,
    }, { status: 400 });
  }

  const results: Array<{
    url: string; locationId: number; locationLabel: string;
    coverage: number; ok: boolean; error?: string;
    prompt?: string; verdict?: string;
  }> = [];

  for (const url of urls) {
    const summary = byUrl.get(url);
    // Body text comes from the stored snapshot, which is the page as served.
    const snap = await loadSnapshot(crawlId, url);
    const { text } = snap ? pageText(snap.html, 12_000) : { text: '' };

    const page: PageContent = {
      url,
      title: summary?.title ?? null,
      description: summary?.description ?? null,
      h1: summary?.h1 ?? null,
      headings: snap ? subheadings(snap.html) : [],
      bodyText: text,
      ...(snap ? { html: snap.html } : {}),
    };

    for (const loc of locations) {
      const { coverage, signals } = analyseCoverage(page, loc);
      await saveCoverage({ siteId, locationId: loc.id, url, crawlId, coverage, signals });

      if (mode === 'coverage') {
        results.push({ url, locationId: loc.id, locationLabel: loc.label, coverage, ok: true });
        continue;
      }

      const input = {
        page,
        location: { label: loc.label, city: loc.city, region: loc.region },
        signals,
        coverage,
        wantDraft,
        siblingLocations: allLocations.filter((l) => l.id !== loc.id).map((l) => l.label),
        ...(businessContext ? { businessContext } : {}),
      };

      if (mode === 'prompt') {
        results.push({
          url, locationId: loc.id, locationLabel: loc.label, coverage, ok: true,
          prompt: buildPrompt(input),
        });
        continue;
      }

      if (!snap) {
        results.push({
          url, locationId: loc.id, locationLabel: loc.label, coverage, ok: false,
          error: 'No saved copy of this page — re-run the audit to store one.',
        });
        continue;
      }

      const outcome = await optimiseForLocation(input);
      if (!outcome.ok) {
        results.push({ url, locationId: loc.id, locationLabel: loc.label, coverage, ok: false, error: outcome.error });
        continue;
      }
      await saveGeneration({
        siteId, locationId: loc.id, url,
        verdict: outcome.verdict, recommendations: outcome.recommendations,
        draft: outcome.draft, model: outcome.model,
      });
      results.push({
        url, locationId: loc.id, locationLabel: loc.label, coverage, ok: true,
        verdict: outcome.verdict,
      });
    }
  }

  return NextResponse.json({ results });
}
