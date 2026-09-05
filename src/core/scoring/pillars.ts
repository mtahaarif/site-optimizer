/**
 * Four-pillar rollup — Content / Authority / Technicals / UX.
 *
 * A presentation layer over the same check outcomes the site score is built
 * from, grouped into the four dimensions a non-specialist owner actually reads.
 * Unlike a competitor's flat checklist, each pillar is severity-weighted and,
 * where the data exists, enriched with real Search Console / backlink signal —
 * so "Authority" reflects measured authority, not an empty connector.
 */
import type { Category } from '../checks/types.ts';
import { SEVERITY_WEIGHT, type Severity } from './model.ts';

export type PillarKey = 'content' | 'authority' | 'technicals' | 'ux';

export interface Pillar {
  key: PillarKey;
  label: string;
  score: number; // 0..100
  failed: number;
  passed: number;
  note: string;
}

/** Which check categories feed each pillar. */
const PILLAR_CATEGORIES: Record<PillarKey, Category[]> = {
  content: ['content-relevance', 'duplicate-content', 'social-media'],
  authority: ['links', 'search-traffic'],
  technicals: ['indexability', 'internal', 'redirects', 'xml-sitemaps', 'code-validation', 'security', 'nextjs'],
  ux: ['page-speed', 'mobile-friendly', 'localization'],
};

const PILLAR_LABEL: Record<PillarKey, string> = {
  content: 'Content',
  authority: 'Authority',
  technicals: 'Technicals',
  ux: 'UX Signals',
};

type OutcomeLike = {
  category: Category;
  severity: Severity;
  status: 'failed' | 'passed' | 'skipped';
};

export interface PillarInput {
  outcomes: OutcomeLike[];
  /** optional real-authority enrichment; absent = pillar rests on link checks alone */
  gscConnected?: boolean;
  totalImpressions?: number;
  backlinks?: number;
  referringDomains?: number;
}

export function computePillars(input: PillarInput): Pillar[] {
  const catToPillar = new Map<Category, PillarKey>();
  for (const [pillar, cats] of Object.entries(PILLAR_CATEGORIES) as [PillarKey, Category[]][]) {
    for (const c of cats) catToPillar.set(c, pillar);
  }

  const acc: Record<PillarKey, { failedW: number; totalW: number; failed: number; passed: number }> = {
    content: { failedW: 0, totalW: 0, failed: 0, passed: 0 },
    authority: { failedW: 0, totalW: 0, failed: 0, passed: 0 },
    technicals: { failedW: 0, totalW: 0, failed: 0, passed: 0 },
    ux: { failedW: 0, totalW: 0, failed: 0, passed: 0 },
  };

  for (const o of input.outcomes) {
    if (o.status === 'skipped') continue;
    const pillar = catToPillar.get(o.category);
    if (!pillar) continue;
    // Give every check a floor weight so a page of clean "notice" checks still
    // counts toward the ratio rather than dividing by zero.
    const w = SEVERITY_WEIGHT[o.severity] + 1;
    const a = acc[pillar];
    a.totalW += w;
    if (o.status === 'failed') { a.failedW += w; a.failed++; } else { a.passed++; }
  }

  return (Object.keys(acc) as PillarKey[]).map((key) => {
    const a = acc[key];
    const score = a.totalW > 0 ? Math.round(100 * (1 - a.failedW / a.totalW)) : 100;
    return { key, label: PILLAR_LABEL[key], score, failed: a.failed, passed: a.passed, note: pillarNote(key, score, input) };
  });
}

function pillarNote(key: PillarKey, score: number, input: PillarInput): string {
  if (key === 'authority') {
    if (input.gscConnected && (input.totalImpressions ?? 0) > 0) {
      const bl = input.backlinks ?? 0;
      return `Backed by ${input.totalImpressions!.toLocaleString()} GSC impressions${bl ? ` and ${bl} tracked backlinks` : ''}.`;
    }
    return 'Connect Search Console and track backlinks to ground this in real authority.';
  }
  const band = score >= 90 ? 'excellent' : score >= 75 ? 'solid' : score >= 50 ? 'needs work' : 'weak';
  return `${band[0]!.toUpperCase()}${band.slice(1)} — ${key === 'technicals' ? 'crawl & index health'
    : key === 'content' ? 'metadata, uniqueness, social cards'
      : 'speed, mobile, localization'}.`;
}

/** Deterministic, no-LLM narration. Reads like the "AI Summary" but needs no key. */
export function narratePillars(pillars: Pillar[], siteScore: number): string {
  const sorted = [...pillars].sort((a, b) => a.score - b.score);
  const worst = sorted[0]!;
  const best = sorted[sorted.length - 1]!;
  const band = siteScore >= 75 ? 'in good shape' : siteScore >= 50 ? 'holding, with real gaps' : 'under strain';
  const worstMsg = worst.score >= 75
    ? 'and no dimension is dragging.'
    : `weakest on ${worst.label} (${worst.score}) — that is where the next fixes pay off most.`;
  return `Overall the site is ${band} at ${Math.round(siteScore)}/100. Strongest on ${best.label} (${best.score}), ${worstMsg}`;
}
