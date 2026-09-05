import type { PageData, LinkRecord } from '../extract.ts';
import type { CoreWebVitalsData } from '../pagespeed/types.ts';
import type { GscData } from '../gsc/client.ts';
import type { Ga4Data } from '../ga4/client.ts';
import type { Severity } from '../scoring/model.ts';

export type { Severity };

/**
 * The 15 categories Sitechecker groups by, plus `nextjs` for the framework pack
 * they cannot populate. Keeping their names verbatim makes parity reports
 * directly comparable side by side.
 */
export type Category =
  | 'links'
  | 'indexability'
  | 'content-relevance'
  | 'duplicate-content'
  | 'security'
  | 'internal'
  | 'page-speed'
  | 'redirects'
  | 'social-media'
  | 'code-validation'
  | 'search-traffic'
  | 'mobile-friendly'
  | 'xml-sitemaps'
  | 'localization'
  | 'nextjs';

export const CATEGORY_LABELS: Record<Category, string> = {
  'links': 'Links',
  'indexability': 'Indexability',
  'content-relevance': 'Content Relevance',
  'duplicate-content': 'Duplicate Content',
  'security': 'Security',
  'internal': 'Internal',
  'page-speed': 'Page Speed',
  'redirects': 'Redirects',
  'social-media': 'Social Media',
  'code-validation': 'Code Validation',
  'search-traffic': 'Search Traffic',
  'mobile-friendly': 'Mobile Friendly',
  'xml-sitemaps': 'XML Sitemaps',
  'localization': 'Localization',
  'nextjs': 'Next.js',
};

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  'links': 'Issues with internal backlinks, internal links and external links, their anchors, HTTP status codes and rel attributes.',
  'indexability': 'Issues that can block or complicate crawling and indexing of website pages by Googlebot.',
  'content-relevance': 'Issues that can reduce the relevance of content to search intent: missing, empty or repeatable content tags, outdated content etc.',
  'duplicate-content': 'Issues that can lead to appearing duplicate pages in Google index and drop in positions of popular pages.',
  'security': 'Issues that can lead to hacking the site by scammers and using it for their own purposes or stealing the data of visitors to your site.',
  'internal': 'Issues related to the correct spelling of URL addresses and the availability of page resources.',
  'page-speed': 'Issues that can lead to slow page loading speed and a decrease in the percentage of conversions as a result.',
  'redirects': 'Issues related to redirects and redirect chains which can degrade the user experience and make it difficult to crawl pages for Googlebot.',
  'social-media': 'Issues that can lead to snippets of pages on social networks looking unattractive and, as a result, their click-through rate will drop.',
  'code-validation': 'Issues that indicate page code is not implemented in compliance with W3C standards and recommendations for the web.',
  'search-traffic': 'Potential issues that exist within the search traffic data and status of pages crawlability and indexability.',
  'mobile-friendly': 'Issues that can lead to bad user experience when visitors view your website on mobile devices.',
  'xml-sitemaps': 'Issues that can lead to crawling of non-200 URLs or missing of pages with search traffic in XML sitemaps.',
  'localization': 'Issues related to implementation of outgoing and incoming hreflang tags that help Googlebot understand language and regional targeting.',
  'nextjs': 'Framework-level issues specific to Next.js rendering, caching and asset pipelines. No general-purpose crawler reports these.',
};

// ---------------------------------------------------------------------------
// Site-wide analysis, computed once after the crawl and shared by every check
// ---------------------------------------------------------------------------

export interface RobotsInfo {
  found: boolean;
  status: number;
  content: string;
  sitemaps: string[];
  /** true when the homepage itself is disallowed for the generic user agent */
  homepageAllowed: boolean;
  isDisallowed: (url: string) => boolean;
}

export interface SitemapInfo {
  url: string;
  status: number;
  /** normalized URLs listed in this sitemap */
  urls: string[];
  isIndex: boolean;
  formatError: string | null;
  bytes: number;
  entryCount: number;
}

export interface SslInfo {
  valid: boolean;
  validTo: string | null;
  daysRemaining: number | null;
  error: string | null;
}

export interface SecurityHeaders {
  xss: boolean;
  frameOptions: boolean;
  contentTypeOptions: boolean;
  hsts: boolean;
  serverVersionExposed: string | null;
  setsCookies: boolean;
}

export interface InboundLink extends LinkRecord {
  fromUrl: string;
}

export interface SiteData {
  origin: string;
  homepageUrl: string;
  startUrl: string;
  pages: PageData[];
  /** normalized URL -> page */
  byUrl: Map<string, PageData>;

  robots: RobotsInfo;
  sitemaps: SitemapInfo[];
  /** every normalized URL found across all sitemaps */
  sitemapUrls: Set<string>;
  /** normalized URL -> how many sitemaps list it */
  sitemapMembership: Map<string, string[]>;

  /** normalized URL -> internal links pointing at it */
  inbound: Map<string, InboundLink[]>;
  /** normalized URL -> internal PageRank, max-normalized to 1 */
  pageRank: Map<string, number>;
  orphans: Set<string>;

  /** value -> normalized URLs sharing it, only entries with 2+ members */
  duplicateTitles: Map<string, string[]>;
  duplicateH1s: Map<string, string[]>;
  duplicateDescriptions: Map<string, string[]>;
  duplicateContent: Map<string, string[]>;

  ssl: SslInfo;
  security: SecurityHeaders;
  httpsRedirectWorks: boolean;
  hostRedirectConsistent: boolean;
  notFoundStatus: number | null;
  homepageIndexable: boolean;
  faviconFound: boolean;

  /** true when GSC is connected; gates the search-traffic pack */
  hasSearchConsole: boolean;
  /** per-URL clicks and impressions from Search Console, null when unavailable */
  gsc: GscData | null;
  /** per-path sessions and engagement from GA4, null when unavailable */
  ga4: Ga4Data | null;
  hasGa4: boolean;

  /**
   * Core Web Vitals for a sample of URLs, populated after PageRank so the
   * sample can be chosen by importance. Empty when PSI was disabled, quota was
   * exhausted, or every request failed — `pagespeedErrors` says which.
   */
  pagespeed: CoreWebVitalsData[];
  pagespeedErrors: Array<{ url: string; strategy: string; error: string }>;
  /** false when PSI never ran at all, so its checks report skipped not passed */
  pagespeedAttempted: boolean;

  /** true when pages were rendered in headless Chromium before extraction */
  renderJs: boolean;
  /** URLs where rendering failed and the raw HTML was used instead */
  renderFailures: Array<{ url: string; error: string }>;

  /** normalized URL of every page that returned a redirect, to its target */
  redirectTargets: Map<string, string>;
}

// ---------------------------------------------------------------------------
// Check definitions
// ---------------------------------------------------------------------------

/**
 * A check returns:
 *   false | null   -> the page passes
 *   true           -> the page fails, no extra detail
 *   string         -> the page fails, with detail shown in the UI
 */
export type CheckVerdict = boolean | string | null | undefined;

export interface PageCheck {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  scope: 'page';
  why: string;
  fix: string;
  requiresNext?: boolean;
  /** gates the check on data we may not have, e.g. Search Console */
  requires?: 'search-console';
  /**
   * Restricts the denominator. Default: HTML pages that returned 200.
   * Checks about status codes override this to see every response.
   */
  appliesTo?: (p: PageData, site: SiteData) => boolean;
  test: (p: PageData, site: SiteData) => CheckVerdict;
}

export interface SiteCheck {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  scope: 'site';
  why: string;
  fix: string;
  requiresNext?: boolean;
  requires?: 'search-console';
  test: (site: SiteData) => CheckVerdict;
}

export type Check = PageCheck | SiteCheck;

export interface AffectedPage {
  url: string;
  detail: string | null;
}

export interface CheckOutcome {
  id: string;
  title: string;
  category: Category;
  severity: Severity;
  scope: 'page' | 'site';
  why: string;
  fix: string;
  status: 'failed' | 'passed' | 'skipped';
  /** why it was skipped, e.g. "requires Google Search Console" */
  skipReason: string | null;
  affected: AffectedPage[];
  affectedCount: number;
  /** how many pages the check was actually evaluated against */
  applicableCount: number;
}

// ---- authoring helpers ----------------------------------------------------

export function pageCheck(c: Omit<PageCheck, 'scope'>): PageCheck {
  return { ...c, scope: 'page' };
}

export function siteCheck(c: Omit<SiteCheck, 'scope'>): SiteCheck {
  return { ...c, scope: 'site' };
}

/** Default denominator: a real HTML page that actually rendered. */
export function isIndexableHtml(p: PageData): boolean {
  return p.isHtml && p.status === 200 && !p.fetchError;
}
