import type { MetadataRoute } from 'next';

const SITE_URL = process.env['SITE_URL'] ?? 'http://localhost:3000';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const routes = ['', '/crawls', '/checks', '/monitor', '/ranks', '/backlinks', '/schedule'];
  return routes.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: now,
    changeFrequency: 'weekly',
    priority: path === '' ? 1 : 0.7,
  }));
}
