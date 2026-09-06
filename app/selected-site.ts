import { cache } from 'react';
import { listProjects } from '@/src/crawler/store.ts';

/**
 * Which website the AI-visibility and content pages are looking at.
 *
 * Both pages take the same `?site=` parameter, and both now need the answer
 * twice per request — once in `generateMetadata`, once in the page body — so
 * the project list is memoised with React's `cache`. Without it every render
 * would run `listProjects`' per-project queries twice.
 */
export const auditedProjects = cache(async () =>
  (await listProjects()).filter((p) => p.crawlCount > 0));

export interface SiteChoice {
  siteId: number;
  origin: string;
  latestAt: number | null;
}

export interface Selection<T extends SiteChoice> {
  selected: T;
  /** The project the bare, parameter-less URL resolves to. */
  fallback: T;
  /** True when `selected` is what the bare URL would have shown anyway. */
  isDefault: boolean;
  /** Hostname of the selected project, for titles and headings. */
  host: string;
}

/**
 * The default view is the most recently crawled project. Anything else is
 * addressed by `?site=`.
 *
 * `isDefault` is what keeps the two URLs for one view from competing: the
 * picker links the default project at the bare path and every page canonicalises
 * to `canonicalPath`, so `/content` and `/content?site=<default>` never both
 * appear in the crawl as separate indexable pages with the same title.
 */
export function selectSite<T extends SiteChoice>(projects: T[], site: string | undefined): Selection<T> {
  const fallback = projects.slice().sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0))[0]!;
  const selected = projects.find((p) => String(p.siteId) === site) ?? fallback;
  return {
    selected,
    fallback,
    isDefault: selected.siteId === fallback.siteId,
    host: selected.origin.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  };
}

/** Root-relative canonical for a site-scoped page. */
export function canonicalPath(base: string, sel: Pick<Selection<SiteChoice>, 'selected' | 'isDefault'>): string {
  return sel.isDefault ? base : `${base}?site=${sel.selected.siteId}`;
}
