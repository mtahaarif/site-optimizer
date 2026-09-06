/**
 * PageSpeed Insights v5 API client.
 *
 * Keyless requests are allowed by Google but heavily rate-limited (roughly one
 * request per second, and 429s under any concurrency), so the client is
 * deliberately serial and cached rather than parallel and fast. With a free API
 * key the quota is 25,000 requests/day, which is far more than a local tool will
 * ever use.
 */
import { createHash } from 'node:crypto';
import { get, run } from '../../db/index.ts';
import { pagespeedSettings } from '../integrations/store.ts';
import {
  classify, CWV_THRESHOLDS,
  type CoreWebVitalsData, type Metric, type ClsMetric,
  type PagespeedOutcome, type Strategy, type MetricScore,
} from './types.ts';

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 30_000;

export async function hasApiKey(): Promise<boolean> {
  return (await pagespeedSettings()) !== null;
}

/**
 * Bypass the 24-hour cache.
 *
 * Needed whenever the cached number would be misleading rather than merely
 * stale — most obviously re-auditing straight after deploying a performance
 * fix, where yesterday's measurement is exactly the wrong answer.
 */
function cacheDisabled(): boolean {
  const v = process.env['PAGESPEED_NO_CACHE']?.trim().toLowerCase();
  return v === '1' || v === 'true';
}

function cacheKey(url: string, strategy: Strategy): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 20);
  return `pagespeed:${hash}-${strategy}`;
}

async function readCache(url: string, strategy: Strategy): Promise<CoreWebVitalsData | null> {
  try {
    const row = await get<{ value: string; fetched_at: number }>(
      'SELECT value, fetched_at FROM kv_cache WHERE cache_key = ?', cacheKey(url, strategy),
    );
    if (!row) return null;
    if (Date.now() - row.fetched_at > CACHE_TTL_MS) return null;
    return { ...JSON.parse(row.value) as CoreWebVitalsData, fromCache: true };
  } catch {
    return null;
  }
}

async function writeCache(data: CoreWebVitalsData): Promise<void> {
  try {
    await run(
      `INSERT INTO kv_cache (cache_key, value, fetched_at) VALUES (?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
      cacheKey(data.url, data.strategy), JSON.stringify(data), data.fetchedAt,
    );
  } catch { /* caching is best-effort; a failed write must not fail the audit */ }
}

// ---------------------------------------------------------------------------
// Response shapes. Only the fields actually read are typed.
// ---------------------------------------------------------------------------

interface CruxMetric { percentile?: number; category?: string }
interface LoadingExperience {
  metrics?: Record<string, CruxMetric>;
  origin_fallback?: boolean;
}
interface Audit { numericValue?: number; details?: unknown; title?: string }
interface PsiResponse {
  loadingExperience?: LoadingExperience;
  originLoadingExperience?: LoadingExperience;
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, Audit>;
  };
  error?: { message?: string; code?: number };
}

const CRUX_TO_SCORE: Record<string, MetricScore> = {
  FAST: 'GOOD',
  AVERAGE: 'NEEDS_IMPROVEMENT',
  SLOW: 'POOR',
};

/** CrUX ships its own verdict per metric; prefer it over re-deriving one. */
function cruxScore(category: string | undefined): MetricScore | undefined {
  return category ? CRUX_TO_SCORE[category] : undefined;
}

/**
 * Prefer field data, fall back to lab.
 *
 * CrUX is what Google actually ranks on, so when a URL has enough real traffic
 * its field numbers are the truth and Lighthouse is only a debugging aid. Most
 * pages on a small site have no CrUX data at all, which is why the fallback
 * exists rather than the check simply reporting "unknown".
 */
function pickMetric(
  field: CruxMetric | undefined,
  labValueMs: number | undefined,
  threshold: { good: number; poor: number },
): Metric {
  if (field?.percentile !== undefined) {
    return {
      valueMs: field.percentile,
      score: cruxScore(field.category) ?? classify(field.percentile, threshold),
      source: 'field',
    };
  }
  const value = labValueMs ?? 0;
  return { valueMs: value, score: classify(value, threshold), source: 'lab' };
}

function pickCls(
  field: CruxMetric | undefined,
  labValue: number | undefined,
): ClsMetric {
  if (field?.percentile !== undefined) {
    // CrUX reports CLS scaled by 100 as an integer.
    const value = field.percentile / 100;
    return {
      value,
      score: cruxScore(field.category) ?? classify(value, CWV_THRESHOLDS.cls),
      source: 'field',
    };
  }
  const value = labValue ?? 0;
  return { value, score: classify(value, CWV_THRESHOLDS.cls), source: 'lab' };
}

function extractLcpElement(audits: Record<string, Audit>): string | undefined {
  const details = audits['largest-contentful-paint-element']?.details as
    | { items?: Array<{ items?: Array<{ node?: { selector?: string; snippet?: string } }> }> }
    | undefined;
  const node = details?.items?.[0]?.items?.[0]?.node;
  return node?.selector ?? node?.snippet;
}

function extractOpportunities(audits: Record<string, Audit>): CoreWebVitalsData['opportunities'] {
  const ids = [
    'render-blocking-resources', 'unused-javascript', 'unused-css-rules',
    'modern-image-formats', 'offscreen-images', 'unminified-javascript',
    'efficient-animated-content', 'server-response-time', 'uses-responsive-images',
  ];
  const out: NonNullable<CoreWebVitalsData['opportunities']> = [];
  for (const id of ids) {
    const audit = audits[id];
    const details = audit?.details as { overallSavingsMs?: number } | undefined;
    const savings = details?.overallSavingsMs ?? 0;
    if (savings >= 100) out.push({ id, title: audit?.title ?? id, savingsMs: Math.round(savings) });
  }
  return out.sort((a, b) => b.savingsMs - a.savingsMs).slice(0, 5);
}

// ---------------------------------------------------------------------------

/**
 * Fetch one URL at one strategy. Never throws — failures come back as
 * `{ ok: false }` so a PSI outage degrades the audit rather than aborting it.
 */
export async function fetchPagespeed(
  url: string,
  strategy: Strategy,
  opts: { skipCache?: boolean } = {},
): Promise<PagespeedOutcome> {
  if (!opts.skipCache && !cacheDisabled()) {
    const cached = await readCache(url, strategy);
    if (cached) return { ok: true, data: cached };
  }

  const params = new URLSearchParams({ url, strategy, category: 'PERFORMANCE' });
  const key = (await pagespeedSettings())?.apiKey;
  if (key) params.set('key', key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(ENDPOINT + '?' + params.toString(), { signal: controller.signal });
    const body = await res.json() as PsiResponse;

    if (!res.ok || body.error) {
      const msg = body.error?.message ?? `HTTP ${res.status}`;
      return {
        ok: false,
        error: {
          url, strategy,
          error: res.status === 429
            ? `Rate limited by PageSpeed Insights${key ? '' : ' — connect an API key on the Insights page to raise the quota'}: ${msg}`
            : msg,
        },
      };
    }

    const lh = body.lighthouseResult;
    const audits = lh?.audits ?? {};
    const num = (id: string) => audits[id]?.numericValue;

    // Page-level CrUX if present, otherwise origin-level, otherwise lab only.
    const pageField = body.loadingExperience?.metrics;
    const originField = body.originLoadingExperience?.metrics;
    const usedOriginFallback = !pageField && !!originField;
    const field = pageField ?? originField;

    const inpField = field?.['INTERACTION_TO_NEXT_PAINT'];

    const data: CoreWebVitalsData = {
      url,
      strategy,
      performanceScore: Math.round((lh?.categories?.performance?.score ?? 0) * 100),
      metrics: {
        lcp: pickMetric(field?.['LARGEST_CONTENTFUL_PAINT_MS'], num('largest-contentful-paint'), CWV_THRESHOLDS.lcp),
        cls: pickCls(field?.['CUMULATIVE_LAYOUT_SHIFT_SCORE'], num('cumulative-layout-shift')),
        tbt: { // lab only — Lighthouse's proxy for interactivity
          valueMs: num('total-blocking-time') ?? 0,
          score: classify(num('total-blocking-time') ?? 0, CWV_THRESHOLDS.tbt),
          source: 'lab',
        },
        fcp: pickMetric(field?.['FIRST_CONTENTFUL_PAINT_MS'], num('first-contentful-paint'), CWV_THRESHOLDS.fcp),
        speedIndex: {
          valueMs: num('speed-index') ?? 0,
          score: classify(num('speed-index') ?? 0, CWV_THRESHOLDS.speedIndex),
          source: 'lab',
        },
        ...(inpField?.percentile !== undefined
          ? {
              inp: {
                valueMs: inpField.percentile,
                score: cruxScore(inpField.category) ?? classify(inpField.percentile, CWV_THRESHOLDS.inp),
                source: 'field' as const,
              },
            }
          : {}),
      },
      cruxOriginFallback: usedOriginFallback || body.loadingExperience?.origin_fallback === true,
      fieldDataAvailable: !!field,
      fetchedAt: Date.now(),
      fromCache: false,
      ...(extractLcpElement(audits) ? { lcpElement: extractLcpElement(audits) } : {}),
      opportunities: extractOpportunities(audits),
    };

    await writeCache(data);
    return { ok: true, data };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return {
      ok: false,
      error: { url, strategy, error: aborted ? `timed out after ${TIMEOUT_MS / 1000}s` : (err as Error).message },
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface PagespeedRun {
  results: CoreWebVitalsData[];
  errors: Array<{ url: string; strategy: Strategy; error: string }>;
  usedApiKey: boolean;
}

/**
 * Run PSI over a sample of URLs.
 *
 * Serial with a delay, not parallel: keyless PSI 429s immediately under any
 * concurrency, and even with a key the audit is not waiting on this to finish
 * quickly — it is waiting on it to finish *reliably*.
 */
export async function runPagespeedBatch(
  targets: Array<{ url: string; strategy: Strategy }>,
  onProgress?: (done: number, total: number, url: string) => void,
): Promise<PagespeedRun> {
  const results: CoreWebVitalsData[] = [];
  const errors: PagespeedRun['errors'] = [];
  const keyed = await hasApiKey();
  const gapMs = keyed ? 250 : 1500;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    onProgress?.(i, targets.length, t.url);

    // Promise.allSettled around a single call still gives uniform handling of a
    // rejection that escapes fetchPagespeed's own try/catch.
    const [settled] = await Promise.allSettled([fetchPagespeed(t.url, t.strategy)]);

    if (settled.status === 'rejected') {
      errors.push({ url: t.url, strategy: t.strategy, error: String(settled.reason) });
    } else if (settled.value.ok) {
      results.push(settled.value.data);
    } else {
      errors.push(settled.value.error);
    }

    if (i < targets.length - 1 && !results.at(-1)?.fromCache) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }

  onProgress?.(targets.length, targets.length, '');
  return { results, errors, usedApiKey: keyed };
}
