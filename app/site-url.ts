/**
 * The absolute origin this deployment is served from.
 *
 * Everything canonical-shaped depends on getting this right: `metadataBase`,
 * every page's canonical link, `og:url`, robots.txt's Host and Sitemap lines,
 * and every `<loc>` in sitemap.xml. A wrong value here is not cosmetic — a
 * canonical pointing at localhost tells Google the real page is somewhere it
 * cannot fetch, which is an instruction to drop the page from the index.
 *
 * Resolution order:
 *   1. SITE_URL                        — an explicit custom domain, wins always
 *   2. VERCEL_PROJECT_PRODUCTION_URL   — the project's stable production
 *                                        domain, set automatically by Vercel.
 *                                        Deliberately not VERCEL_URL, which is
 *                                        per-deployment and would canonicalise
 *                                        every page to a preview build.
 *   3. localhost                       — development
 */
export function siteUrl(): string {
  const explicit = process.env['SITE_URL']?.trim();
  if (explicit) return normalize(explicit);

  const production = process.env['VERCEL_PROJECT_PRODUCTION_URL']?.trim();
  if (production) return normalize(production);

  return 'http://localhost:3000';
}

/** Add a scheme if the platform gave a bare host, and drop any trailing slash. */
function normalize(value: string): string {
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withScheme.replace(/\/+$/, '');
}
