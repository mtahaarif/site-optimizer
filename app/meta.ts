import type { Metadata } from 'next';

/**
 * One page's metadata, built so the social tags cannot drift from the canonical.
 *
 * Next merges metadata per top-level key rather than deeply, so a page that
 * declares its own `openGraph` *replaces* the layout's — set one field there by
 * hand and you silently drop og:title, og:description, og:site_name and
 * og:type from that page. Routing every page through this helper is what keeps
 * the set complete, and keeps `og:url` equal to the canonical rather than
 * merely near it.
 *
 * Paths stay relative: Next resolves them against `metadataBase`, so canonical
 * and og:url resolve from the same origin and agree by construction.
 */
export function pageMeta(opts: {
  title: string;
  description: string;
  /** root-relative, e.g. '/ranks' */
  path: string;
}): Metadata {
  const { title, description, path } = opts;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: 'SiteChecker',
      title,
      description,
      url: path,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  };
}
