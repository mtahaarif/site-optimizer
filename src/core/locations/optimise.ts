/**
 * Location content optimisation — one instruction set, two ways to run it.
 *
 * The API path sends the prompt to the configured model and stores a structured
 * draft. The copy path hands you the identical prompt to paste into whatever
 * assistant you already pay for. They are built from the same function on
 * purpose: if "copy the prompt" produced something weaker than the API path,
 * the option would be a trap for anyone trying to avoid per-call costs.
 *
 * Both are grounded in the deterministic coverage analysis rather than asking a
 * model to guess what is missing — the prompt states which of the title, H1,
 * headings, body, URL and structured data already name the place, so the work
 * is targeted instead of a rewrite of everything.
 */
import { z } from 'zod';
import { completeJson } from '../llm/provider.ts';
import { gapsFrom, type PageContent } from './coverage.ts';
import type { ContentDraft, LocationSignals } from './store.ts';

export interface OptimiseInput {
  page: PageContent;
  /** the location being written for */
  location: { label: string; city: string | null; region: string | null };
  signals: LocationSignals;
  coverage: number;
  /** the business, in the user's words — steers tone and claims */
  businessContext?: string;
  /** when true the model writes a full draft; otherwise it only advises */
  wantDraft: boolean;
  /** every location in play, so the model can avoid writing near-duplicates */
  siblingLocations?: string[];
}

// ---------------------------------------------------------------------------
// The instructions, shared by both paths
// ---------------------------------------------------------------------------

const SYSTEM = `You are an SEO editor who writes location pages that a local reader would find genuinely useful.

The single biggest failure in local SEO is the doorway page: one template with the city name swapped, published dozens of times. Google treats that as spam, and it is worthless to the reader. Never produce it. Everything you write for a location must be true of that location specifically — the neighbourhoods, travel times, local landmarks, regional regulations, climate, what people there actually ask.

Where you do not know something specific and true about the place, say so in the rationale and leave a clearly marked [VERIFY: ...] placeholder rather than inventing a detail. A fabricated local fact is worse than a generic sentence, because it destroys trust the moment a local reader sees it.

Never keyword-stuff. Naming the location once in the title, once in the H1 and two or three times naturally in the body is what good looks like. More than that reads as spam to both the reader and the ranking system.`;

/**
 * The prompt.
 *
 * Returned as text so it can be shown, copied, and audited. Nothing about the
 * API path is hidden from it — what you paste is what the model is sent.
 */
export function buildPrompt(input: OptimiseInput): string {
  const { page, location, signals, coverage, wantDraft } = input;
  const gaps = gapsFrom(signals, location.label);

  const lines: string[] = [];

  lines.push(SYSTEM, '', '---', '');
  lines.push(`## The page`, '');
  lines.push(`URL: ${page.url}`);
  lines.push(`Current title: ${page.title ?? '(none)'}`);
  lines.push(`Current meta description: ${page.description ?? '(none)'}`);
  lines.push(`Current H1: ${page.h1 ?? '(none)'}`);
  if (page.headings.length) {
    lines.push(`Current subheadings: ${page.headings.slice(0, 12).join(' | ')}`);
  }
  lines.push('');

  lines.push(`## The location`, '');
  lines.push(`Target: ${location.label}`);
  if (input.siblingLocations?.length) {
    // Quoted, because labels contain commas themselves ("Austin, Texas") and a
    // comma-joined list of them reads as twice as many places as there are.
    lines.push(
      `This site also targets: ${input.siblingLocations.map((s) => `"${s}"`).join(', ')}.`,
      'What you write must not be a template that would read identically for those.',
    );
  }
  if (input.businessContext) lines.push('', `About the business: ${input.businessContext}`);
  lines.push('');

  lines.push(`## What the page already does for ${location.label}`, '');
  lines.push(`Coverage score: ${coverage}/100 (presence of the location, not quality)`);
  lines.push(
    `- title: ${yn(signals.inTitle)}`,
    `- H1: ${yn(signals.inH1)}`,
    `- meta description: ${yn(signals.inDescription)}`,
    `- a subheading: ${yn(signals.inHeadings)}`,
    `- body text: named ${signals.inBody} time(s)`,
    `- URL path: ${yn(signals.inUrl)}`,
    `- LocalBusiness/PostalAddress structured data: ${yn(signals.hasLocalSchema)}`,
    `- an address or postcode on the page: ${yn(signals.hasAddress)}`,
  );
  lines.push('');

  if (gaps.length) {
    lines.push('Gaps to close, in priority order:', '');
    for (const g of gaps) lines.push(`- ${g}`);
    lines.push('');
  }

  lines.push('## The page text', '');
  lines.push('"""');
  lines.push(page.bodyText.slice(0, 6000).trim() || '(the page has no readable body text)');
  lines.push('"""', '');

  lines.push('## What to produce', '');
  if (wantDraft) {
    lines.push(
      `Rewrite this page so it genuinely serves someone in ${location.label}, closing the gaps above.`,
      '',
      'Return exactly this JSON and nothing else:',
      '',
      '```json',
      '{',
      '  "title": "under 60 characters, names the location once",',
      '  "description": "under 155 characters, names the location once",',
      '  "h1": "names the location once, reads naturally",',
      '  "intro": "2-3 sentences that a local reader would recognise as about their area",',
      '  "sections": [{ "heading": "...", "body": "..." }],',
      '  "faqs": [{ "question": "...", "answer": "..." }],',
      '  "rationale": "what you changed, what you left alone, and any [VERIFY: ...] placeholders you left"',
      '}',
      '```',
    );
  } else {
    lines.push(
      `Assess how well this page serves someone searching in ${location.label}, and say what to change.`,
      '',
      'Return exactly this JSON and nothing else:',
      '',
      '```json',
      '{',
      '  "verdict": "one plain sentence a business owner would understand",',
      '  "recommendations": [{ "change": "a specific edit to make", "why": "one short sentence" }]',
      '}',
      '```',
    );
  }

  return lines.join('\n');
}

const yn = (v: boolean): string => (v ? 'yes' : 'NO');

// ---------------------------------------------------------------------------
// The API path
// ---------------------------------------------------------------------------

const AdviceSchema = z.object({
  verdict: z.string(),
  recommendations: z.array(z.object({ change: z.string(), why: z.string() })),
});

const DraftSchema = AdviceSchema.extend({
  title: z.string(),
  description: z.string(),
  h1: z.string(),
  intro: z.string(),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })),
  rationale: z.string(),
});

const ADVICE_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'recommendations'],
  properties: {
    verdict: { type: 'string', description: 'One plain-English sentence.' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['change', 'why'],
        properties: { change: { type: 'string' }, why: { type: 'string' } },
      },
    },
  },
};

const DRAFT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'recommendations', 'title', 'description', 'h1', 'intro', 'sections', 'faqs', 'rationale'],
  properties: {
    ...(ADVICE_JSON_SCHEMA['properties'] as Record<string, unknown>),
    title: { type: 'string' },
    description: { type: 'string' },
    h1: { type: 'string' },
    intro: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['heading', 'body'],
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
      },
    },
    faqs: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['question', 'answer'],
        properties: { question: { type: 'string' }, answer: { type: 'string' } },
      },
    },
    rationale: { type: 'string' },
  },
};

export type OptimiseOutcome =
  | {
      ok: true;
      verdict: string;
      recommendations: Array<{ change: string; why: string }>;
      draft: ContentDraft | null;
      model: string;
    }
  | { ok: false; error: string };

/** Run the prompt through the configured model. Never throws. */
export async function optimiseForLocation(input: OptimiseInput): Promise<OptimiseOutcome> {
  const prompt = buildPrompt(input);

  const outcome = await completeJson({
    system: SYSTEM,
    user: prompt,
    schema: input.wantDraft ? DRAFT_JSON_SCHEMA : ADVICE_JSON_SCHEMA,
    schemaName: input.wantDraft ? 'location_content_draft' : 'location_content_advice',
    maxTokens: input.wantDraft ? 4000 : 1200,
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };

  // Branch rather than narrow: the two schemas are separate shapes, and
  // asking TypeScript to discriminate them by a property test reads worse
  // than simply handling each case where it is asked for.
  if (input.wantDraft) {
    const parsed = DraftSchema.safeParse(outcome.data);
    if (!parsed.success) {
      return { ok: false, error: 'The model returned an unexpected shape. Try again.' };
    }
    const d = parsed.data;
    return {
      ok: true,
      verdict: d.verdict,
      recommendations: d.recommendations,
      draft: {
        title: d.title, description: d.description, h1: d.h1, intro: d.intro,
        sections: d.sections, faqs: d.faqs, rationale: d.rationale,
      },
      model: outcome.model,
    };
  }

  const parsed = AdviceSchema.safeParse(outcome.data);
  if (!parsed.success) {
    return { ok: false, error: 'The model returned an unexpected shape. Try again.' };
  }
  return {
    ok: true,
    verdict: parsed.data.verdict,
    recommendations: parsed.data.recommendations,
    draft: null,
    model: outcome.model,
  };
}
