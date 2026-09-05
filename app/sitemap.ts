import type { MetadataRoute } from 'next';
import { siteUrl } from './site-url.ts';

/**
 * The eight routes that exist and are worth indexing.
 *
 * Deliberately not the per-crawl and per-project routes: those are one user's
 * data, they are unbounded, and listing them would need a database read to
 * build a file that is fetched by robots. Deliberately not /crawls, /checks or
 * /monitor either — the first is a permanent redirect and the other two no
 * longer exist, and a sitemap that lists redirects and 404s is exactly what
 * this project's own `sitemap-3xx` and `sitemap-4xx` checks exist to catch.
 */
const ROUTES = [
  '',
  '/projects',
  '/insights',
  '/ai-visibility',
  '/content',
  '/ranks',
  '/backlinks',
  '/schedule',
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  return ROUTES.map((path) => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: 'weekly' as const,
    priority: path === '' ? 1 : 0.7,
  }));
}
