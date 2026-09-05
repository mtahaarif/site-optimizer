import type { MetadataRoute } from 'next';
import { siteUrl } from './site-url.ts';

/**
 * /crawl/ and /project/ hold one user's audit reports.
 *
 * They are excluded for the same reason a shop excludes its cart: they are
 * per-record, unbounded, and near-identical to each other by construction —
 * every audit of the same site produces another page with the same title, the
 * same H1 and the same shape, so leaving them crawlable means the site's own
 * duplicate-content profile gets worse every time the tool is used. Their URLs
 * also stop resolving as soon as a project is deleted.
 *
 * The honest caveat, which this project's own `disallowed-by-robots-txt` check
 * makes: Disallow stops crawling, not indexing — a blocked URL can still be
 * indexed from a link, as a result with no content. The complete fix is to put
 * the dashboard behind authentication, at which point none of this is reachable
 * by a crawler at all.
 */
export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/crawl/', '/project/'],
    }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
