/**
 * The check registry and runner.
 *
 * Every check in the product is registered here. The runner evaluates *all* of
 * them against every applicable page and reports pass/fail with affected counts,
 * which is what lets the UI show "Title too long: 56 pages" alongside
 * "Checks passed: 37" — the Sitechecker reporting model.
 */
import type {
  Check, PageCheck, SiteCheck, CheckOutcome, AffectedPage, Category, SiteData,
} from './types.ts';
import { CATEGORY_LABELS, CATEGORY_DESCRIPTIONS, isIndexableHtml } from './types.ts';
import { normalizeUrl } from '../extract.ts';

import { INDEXABILITY_CHECKS } from './indexability.ts';
import { CONTENT_CHECKS } from './content.ts';
import { LINK_CHECKS } from './links.ts';
import { DUPLICATE_CHECKS } from './duplicate.ts';
import { SECURITY_CHECKS } from './security.ts';
import { INTERNAL_CHECKS } from './internal.ts';
import { PAGESPEED_CHECKS, MOBILE_CHECKS } from './performance.ts';
import { REDIRECT_CHECKS, SOCIAL_CHECKS, CODE_VALIDATION_CHECKS, SITEMAP_CHECKS } from './technical.ts';
import { LOCALIZATION_CHECKS } from './localization.ts';
import { SEARCH_TRAFFIC_CHECKS } from './traffic.ts';
import { NEXTJS_CHECKS } from './nextjs.ts';
import { JS_CHECKS } from './javascript.ts';

export const ALL_CHECKS: Check[] = [
  ...INDEXABILITY_CHECKS,
  ...CONTENT_CHECKS,
  ...LINK_CHECKS,
  ...DUPLICATE_CHECKS,
  ...SECURITY_CHECKS,
  ...INTERNAL_CHECKS,
  ...PAGESPEED_CHECKS,
  ...MOBILE_CHECKS,
  ...REDIRECT_CHECKS,
  ...SOCIAL_CHECKS,
  ...CODE_VALIDATION_CHECKS,
  ...SITEMAP_CHECKS,
  ...LOCALIZATION_CHECKS,
  ...SEARCH_TRAFFIC_CHECKS,
  ...NEXTJS_CHECKS,
  ...JS_CHECKS,
];

export const PAGE_CHECKS = ALL_CHECKS.filter((c): c is PageCheck => c.scope === 'page');
export const SITE_CHECKS = ALL_CHECKS.filter((c): c is SiteCheck => c.scope === 'site');

// Duplicate ids would silently shadow each other in the UI, so fail loudly at load.
{
  const seen = new Set<string>();
  for (const c of ALL_CHECKS) {
    if (seen.has(c.id)) throw new Error('Duplicate check id: ' + c.id);
    seen.add(c.id);
  }
}

export function getCheck(id: string): Check | undefined {
  return ALL_CHECKS.find((c) => c.id === id);
}

export interface CheckStats {
  total: number;
  byCategory: Record<string, number>;
  bySeverity: Record<string, number>;
}

export function checkStats(): CheckStats {
  const byCategory: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  for (const c of ALL_CHECKS) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1;
  }
  return { total: ALL_CHECKS.length, byCategory, bySeverity };
}

// ---------------------------------------------------------------------------

const MAX_AFFECTED_STORED = 500;

export interface RunOptions {
  /** check ids the user has chosen to ignore for this project */
  ignored?: Set<string>;
}

/**
 * Evaluate every check against the crawl.
 *
 * A page check runs once per applicable page; a site check runs once. Checks
 * that throw are reported as skipped rather than aborting the audit — one bad
 * regex must not lose an entire report.
 */
export function runAllChecks(site: SiteData, opts: RunOptions = {}): CheckOutcome[] {
  const ignored = opts.ignored ?? new Set<string>();
  const outcomes: CheckOutcome[] = [];

  for (const check of ALL_CHECKS) {
    const base = {
      id: check.id,
      title: check.title,
      category: check.category,
      severity: check.severity,
      scope: check.scope,
      why: check.why,
      fix: check.fix,
    };

    if (ignored.has(check.id)) {
      outcomes.push({ ...base, status: 'skipped', skipReason: 'Ignored for this project', affected: [], affectedCount: 0, applicableCount: 0 });
      continue;
    }
    if (check.requires === 'search-console' && !site.hasSearchConsole) {
      outcomes.push({ ...base, status: 'skipped', skipReason: 'Requires a connected Google Search Console property', affected: [], affectedCount: 0, applicableCount: 0 });
      continue;
    }
    if (check.requiresNext && !site.pages.some((p) => p.next.isNext)) {
      outcomes.push({ ...base, status: 'skipped', skipReason: 'Not a Next.js site', affected: [], affectedCount: 0, applicableCount: 0 });
      continue;
    }

    if (check.scope === 'site') {
      let verdict;
      try {
        verdict = check.test(site);
      } catch (err) {
        outcomes.push({ ...base, status: 'skipped', skipReason: 'Check error: ' + (err as Error).message, affected: [], affectedCount: 0, applicableCount: 1 });
        continue;
      }
      const failed = verdict !== false && verdict !== null && verdict !== undefined;
      outcomes.push({
        ...base,
        status: failed ? 'failed' : 'passed',
        skipReason: null,
        affected: failed ? [{ url: site.origin, detail: typeof verdict === 'string' ? verdict : null }] : [],
        affectedCount: failed ? 1 : 0,
        applicableCount: 1,
      });
      continue;
    }

    const applies = check.appliesTo ?? ((p) => isIndexableHtml(p));
    const affected: AffectedPage[] = [];
    let applicableCount = 0;
    let trueCount = 0;
    let errored: string | null = null;

    for (const page of site.pages) {
      let inScope: boolean;
      try {
        inScope = applies(page, site);
      } catch { continue; }
      if (!inScope) continue;
      applicableCount++;

      let verdict;
      try {
        verdict = check.test(page, site);
      } catch (err) {
        errored ??= (err as Error).message;
        continue;
      }
      if (verdict === false || verdict === null || verdict === undefined) continue;

      // Count every failure, but only store the first N rows so a site-wide
      // issue on 30k pages does not blow up the persisted report.
      trueCount++;
      if (affected.length < MAX_AFFECTED_STORED) {
        affected.push({ url: page.finalUrl, detail: typeof verdict === 'string' ? verdict : null });
      }
    }

    if (applicableCount === 0) {
      outcomes.push({ ...base, status: 'skipped', skipReason: 'No pages in scope for this check', affected: [], affectedCount: 0, applicableCount: 0 });
      continue;
    }

    outcomes.push({
      ...base,
      status: trueCount > 0 ? 'failed' : 'passed',
      skipReason: errored ? 'Partial: ' + errored : null,
      affected,
      affectedCount: trueCount,
      applicableCount,
    });
  }

  return outcomes;
}

/** Per-page rollup, used by the page detail view and by scoring. */
export function issuesByPage(outcomes: CheckOutcome[]): Map<string, CheckOutcome[]> {
  const map = new Map<string, CheckOutcome[]>();
  for (const o of outcomes) {
    if (o.status !== 'failed' || o.scope !== 'page') continue;
    for (const a of o.affected) {
      const key = normalizeUrl(a.url);
      const list = map.get(key) ?? [];
      list.push(o);
      map.set(key, list);
    }
  }
  return map;
}

/**
 * A category rollup.
 *
 * The three lists hold check **ids**, not the outcome objects themselves.
 * Every outcome belongs to exactly one category, so embedding them here meant
 * the whole set was serialised twice — once in `AuditReport.outcomes` and
 * again in full under `categories`. On a real report that was ~160 KB of
 * duplication, most of an inline RSC payload. Callers resolve ids against
 * `outcomes` with `byId()` below.
 */
export interface CategorySummary {
  category: Category;
  label: string;
  description: string;
  failed: string[];
  passed: string[];
  skipped: string[];
  /** share of crawled pages touched by any failing check in this category */
  affectedPageShare: number;
}

/** Index outcomes by check id, for resolving the id lists on CategorySummary. */
export function byId(outcomes: CheckOutcome[]): Map<string, CheckOutcome> {
  return new Map(outcomes.map((o) => [o.id, o]));
}

/**
 * @param countableUrls normalized URLs of the crawled HTML pages. Page checks
 *   also fire against fetched assets (a 404 stylesheet is a real finding), so
 *   without this filter the affected set can exceed the page count and the
 *   percentage runs past 100.
 */
export function summarizeByCategory(
  outcomes: CheckOutcome[],
  pageCount: number,
  countableUrls?: Set<string>,
): CategorySummary[] {
  const order: Category[] = [
    'nextjs', 'links', 'indexability', 'content-relevance', 'duplicate-content',
    'security', 'internal', 'page-speed', 'redirects', 'social-media',
    'code-validation', 'search-traffic', 'mobile-friendly', 'xml-sitemaps', 'localization',
  ];

  return order.map((category) => {
    const mine = outcomes.filter((o) => o.category === category);
    const failed = mine.filter((o) => o.status === 'failed')
      .sort((a, b) => b.affectedCount - a.affectedCount);

    const touched = new Set<string>();
    for (const o of failed) {
      for (const a of o.affected) {
        const key = normalizeUrl(a.url);
        if (countableUrls && !countableUrls.has(key)) continue;
        touched.add(key);
      }
    }

    return {
      category,
      label: CATEGORY_LABELS[category],
      description: CATEGORY_DESCRIPTIONS[category],
      // Ids only — the outcomes themselves live once, in AuditReport.outcomes.
      failed: failed.map((o) => o.id),
      passed: mine.filter((o) => o.status === 'passed').map((o) => o.id),
      skipped: mine.filter((o) => o.status === 'skipped').map((o) => o.id),
      affectedPageShare: pageCount > 0 ? touched.size / pageCount : 0,
    };
  }).filter((c) => c.failed.length + c.passed.length + c.skipped.length > 0);
}
