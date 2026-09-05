/**
 * PageSpeed Insights / Core Web Vitals types.
 *
 * PSI returns two very different things in one response and conflating them is
 * the classic mistake:
 *
 *   Field data (CrUX)  — what real Chrome users actually experienced over the
 *                        trailing 28 days. This is what Google ranks on. Only
 *                        exists once a URL has enough traffic.
 *   Lab data (Lighthouse) — a single simulated load on emulated hardware.
 *                        Always available, reproducible, and useful for
 *                        debugging — but not the ranking signal.
 *
 * Each metric below records which source it came from, because "LCP 2.1s" means
 * something quite different depending on the answer.
 */

export type Strategy = 'mobile' | 'desktop';
export type MetricScore = 'GOOD' | 'NEEDS_IMPROVEMENT' | 'POOR';
export type MetricSource = 'field' | 'lab';

export interface Metric {
  valueMs: number;
  score: MetricScore;
  source: MetricSource;
}

/** CLS is unitless, so it gets its own shape rather than a misleading valueMs. */
export interface ClsMetric {
  value: number;
  score: MetricScore;
  source: MetricSource;
}

export interface CoreWebVitalsData {
  url: string;
  strategy: Strategy;
  /** Lighthouse performance category, 0-100 */
  performanceScore: number;
  metrics: {
    lcp: Metric;
    cls: ClsMetric;
    /** Field-only. Lighthouse has no INP; TBT is its lab proxy. */
    inp?: Metric;
    tbt: Metric;
    fcp: Metric;
    speedIndex: Metric;
  };
  /** true when page-level field data was unavailable and origin data was used */
  cruxOriginFallback: boolean;
  /** true when CrUX had no data at all and every metric is lab-derived */
  fieldDataAvailable: boolean;
  fetchedAt: number;
  fromCache: boolean;
  /** DOM selector / snippet of the element Lighthouse measured as LCP */
  lcpElement?: string;
  /** Lighthouse opportunities worth surfacing, largest saving first */
  opportunities?: Array<{ id: string; title: string; savingsMs: number }>;
  rawAuditRef?: Record<string, unknown>;
}

export interface PagespeedError {
  url: string;
  strategy: Strategy;
  error: string;
}

export type PagespeedOutcome =
  | { ok: true; data: CoreWebVitalsData }
  | { ok: false; error: PagespeedError };

// ---------------------------------------------------------------------------
// Official Google Core Web Vitals thresholds.
// https://web.dev/articles/defining-core-web-vitals-thresholds
// ---------------------------------------------------------------------------

export const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  cls: { good: 0.1, poor: 0.25 },
  inp: { good: 200, poor: 500 },
  tbt: { good: 200, poor: 600 },
  fcp: { good: 1800, poor: 3000 },
  speedIndex: { good: 3400, poor: 5800 },
} as const;

export function classify(value: number, threshold: { good: number; poor: number }): MetricScore {
  if (value <= threshold.good) return 'GOOD';
  if (value <= threshold.poor) return 'NEEDS_IMPROVEMENT';
  return 'POOR';
}

export const SCORE_COLOR: Record<MetricScore, string> = {
  GOOD: 'rgb(var(--accent))',
  NEEDS_IMPROVEMENT: 'rgb(var(--warning))',
  POOR: 'rgb(var(--blocker))',
};

export const SCORE_LABEL: Record<MetricScore, string> = {
  GOOD: 'Good',
  NEEDS_IMPROVEMENT: 'Needs work',
  POOR: 'Poor',
};

/** Human-readable metric value: seconds for timings, 3dp for CLS. */
export function formatMetric(name: string, value: number): string {
  if (name === 'cls') return value.toFixed(3);
  if (value >= 1000) return (value / 1000).toFixed(2) + ' s';
  return Math.round(value) + ' ms';
}
