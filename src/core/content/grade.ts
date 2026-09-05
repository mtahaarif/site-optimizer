/**
 * Content quality judge.
 *
 * Every other check in this project measures whether a page is *built* well.
 * This one measures whether it is *worth reading* — the thing search engines
 * actually rank on and the one signal the rest of the audit cannot infer from
 * markup. A model reads the page's real text and scores it on six dimensions,
 * returning a strict JSON verdict via structured outputs.
 *
 * Grades are stored per (crawl, page): a model call costs money, so re-opening
 * a report must never re-spend.
 */
import { z } from 'zod';
import { completeJson, activeProvider, llmConfigured } from '../llm/provider.ts';
import * as cheerio from 'cheerio';
import { all, get, run } from '../../db/index.ts';
import { normalizeUrl } from '../extract.ts';

export { llmConfigured, activeProvider };

/** JSON Schema handed to the model, kept in step with GradeSchema below. */
const GRADE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'depth', 'relevance', 'readability', 'originality', 'trust', 'structure', 'overall', 'verdict', 'strengths', 'fixes'],
  properties: {
    intent: { type: 'string', description: 'One short phrase: the question this page answers.' },
    depth: { type: 'integer', minimum: 0, maximum: 100 },
    relevance: { type: 'integer', minimum: 0, maximum: 100 },
    readability: { type: 'integer', minimum: 0, maximum: 100 },
    originality: { type: 'integer', minimum: 0, maximum: 100 },
    trust: { type: 'integer', minimum: 0, maximum: 100 },
    structure: { type: 'integer', minimum: 0, maximum: 100 },
    overall: { type: 'integer', minimum: 0, maximum: 100 },
    verdict: { type: 'string', description: 'One plain-English sentence.' },
    strengths: { type: 'array', items: { type: 'string' }, description: 'Up to 3 things done well.' },
    fixes: {
      type: 'array',
      description: 'Up to 5 prioritised improvements, most valuable first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fix', 'why'],
        properties: { fix: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Shape of a verdict
// ---------------------------------------------------------------------------

const GradeSchema = z.object({
  intent: z.string().describe('In one short phrase, the question or need this page is trying to answer.'),
  depth: z.number().describe('0-100. Does it actually answer the question, with specifics, or is it filler?'),
  relevance: z.number().describe('0-100. How well the content matches the intent its title and headings promise.'),
  readability: z.number().describe('0-100. Clear sentences, sensible structure, scannable.'),
  originality: z.number().describe('0-100. Information gain — does it say anything a competitor page would not?'),
  trust: z.number().describe('0-100. Evidence of first-hand expertise: specifics, data, named people, citations.'),
  structure: z.number().describe('0-100. Headings, lists and direct answers a search engine can lift.'),
  overall: z.number().describe('0-100 overall content quality, weighted toward depth and originality.'),
  verdict: z.string().describe('One plain-English sentence a business owner would understand.'),
  strengths: z.array(z.string()).describe('Up to 3 things the page genuinely does well.'),
  fixes: z.array(z.object({
    fix: z.string().describe('A specific, concrete change to make to this page.'),
    why: z.string().describe('The reason it matters, in one short sentence.'),
  })).describe('Up to 5 prioritised improvements, most valuable first.'),
});

export type Grade = z.infer<typeof GradeSchema>;

export interface StoredGrade extends Grade {
  url: string;
  gradedAt: number;
  model: string;
  words: number;
}

// ---------------------------------------------------------------------------
// Getting the words off the page
// ---------------------------------------------------------------------------

/** Readable body text, with chrome stripped, capped so one page can't blow the budget. */
export function pageText(html: string, maxChars = 18_000): { text: string; words: number } {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, header, footer, form').remove();
  const raw = $('main').text() || $('article').text() || $('body').text();
  const text = raw.replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  return { text: text.slice(0, maxChars), words };
}

// ---------------------------------------------------------------------------
// The judge
// ---------------------------------------------------------------------------

const SYSTEM = `You are a demanding editor grading web page content the way a search engine's helpful-content system would.

Judge only the text you are given. Score honestly and use the full range: most pages on the web are mediocre and should land in the 40s and 50s. Reserve 80+ for content that is genuinely thorough, specific and hard to replace, and score below 30 when a page is thin, generic or padded.

Never reward length on its own. A short page that answers the question completely beats a long one that circles it. Judge marketing copy on whether a real customer could make a decision from it.

Your fixes must be concrete and specific to this page — name the section or the missing fact. Never give generic advice like "add more keywords" or "improve SEO".`;

export interface GradeInput {
  url: string;
  title: string | null;
  description: string | null;
  html: string;
}

export type GradeOutcome =
  | { ok: true; grade: Grade; words: number; model: string }
  | { ok: false; error: string };

/** Grade one page. Never throws — failures come back as a readable message. */
export async function gradePage(input: GradeInput): Promise<GradeOutcome> {
  if (!llmConfigured()) {
    return { ok: false, error: 'No AI key configured. Add GEMINI_API_KEY, GROQ_API_KEY or ANTHROPIC_API_KEY to .env.local.' };
  }

  const { text, words } = pageText(input.html);
  if (words < 40) {
    return { ok: false, error: `Too little text to judge (${words} words).` };
  }

  const outcome = await completeJson({
    system: SYSTEM,
    schema: GRADE_JSON_SCHEMA,
    schemaName: 'content_grade',
    maxTokens: 2000,
    user: [
      `URL: ${input.url}`,
      `Title: ${input.title ?? '(none)'}`,
      `Meta description: ${input.description ?? '(none)'}`,
      `Word count: ${words}`,
      '',
      'Page text:',
      text,
    ].join('\n'),
  });

  if (!outcome.ok) return { ok: false, error: outcome.error };

  // JSON mode guarantees valid JSON, not the right shape — validate before use.
  const parsed = GradeSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { ok: false, error: 'The model returned an unexpected shape. Try grading again.' };
  }
  return { ok: true, grade: parsed.data, words, model: outcome.model };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

interface GradeRow {
  url: string; graded_at: number; model: string; words: number;
  overall: number; depth: number; relevance: number; readability: number;
  originality: number; trust: number; structure: number;
  verdict: string; strengths: string; fixes: string; intent: string | null;
}

const toStored = (r: GradeRow): StoredGrade => ({
  url: r.url,
  gradedAt: r.graded_at,
  model: r.model,
  words: r.words,
  intent: r.intent ?? '',
  overall: r.overall, depth: r.depth, relevance: r.relevance,
  readability: r.readability, originality: r.originality,
  trust: r.trust, structure: r.structure,
  verdict: r.verdict,
  strengths: JSON.parse(r.strengths) as string[],
  fixes: JSON.parse(r.fixes) as Grade['fixes'],
});

export async function saveGrade(crawlId: string, url: string, grade: Grade, words: number, model: string): Promise<void> {
  await run(
    `INSERT INTO content_grades
       (crawl_id, url, url_key, graded_at, model, overall, depth, relevance,
        readability, originality, trust, structure, verdict, strengths, fixes, intent, words)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(crawl_id, url_key) DO UPDATE SET
       graded_at = excluded.graded_at, model = excluded.model, overall = excluded.overall,
       depth = excluded.depth, relevance = excluded.relevance, readability = excluded.readability,
       originality = excluded.originality, trust = excluded.trust, structure = excluded.structure,
       verdict = excluded.verdict, strengths = excluded.strengths, fixes = excluded.fixes,
       intent = excluded.intent, words = excluded.words`,
    crawlId, url, normalizeUrl(url), Date.now(), model,
    Math.round(grade.overall), Math.round(grade.depth), Math.round(grade.relevance),
    Math.round(grade.readability), Math.round(grade.originality), Math.round(grade.trust),
    Math.round(grade.structure), grade.verdict,
    JSON.stringify(grade.strengths), JSON.stringify(grade.fixes), grade.intent, words,
  );
}

export async function gradesForCrawl(crawlId: string): Promise<StoredGrade[]> {
  const rows = await all<GradeRow>(
    `SELECT url, graded_at, model, words, overall, depth, relevance, readability,
            originality, trust, structure, verdict, strengths, fixes, intent
     FROM content_grades WHERE crawl_id = ? ORDER BY overall ASC`,
    crawlId,
  );
  return rows.map(toStored);
}

export async function gradeFor(crawlId: string, url: string): Promise<StoredGrade | null> {
  const row = await get<GradeRow>(
    `SELECT url, graded_at, model, words, overall, depth, relevance, readability,
            originality, trust, structure, verdict, strengths, fixes, intent
     FROM content_grades WHERE crawl_id = ? AND url_key = ?`,
    crawlId, normalizeUrl(url),
  );
  return row ? toStored(row) : null;
}
