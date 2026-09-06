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
/**
 * The generated card from app/opengraph-image.tsx.
 *
 * Referenced explicitly rather than relying on the file convention: Next
 * attaches a generated image automatically only to the segment that declares
 * it, so the root file covered `/` and left the other eleven routes emitting
 * `twitter:card: summary_large_image` with no image to show.
 */
const OG_IMAGE = {
  url: '/opengraph-image',
  width: 1200,
  height: 630,
  alt: 'SiteChecker — technical SEO audits, rank tracking and AI visibility',
};

/**
 * What `title.template` in the root layout appends to a page title. Counted
 * here because the length limit applies to the rendered <title>, not to the
 * fragment a page declares.
 */
const BRAND_SUFFIX = ' \u00b7 SiteChecker';
const TITLE_MAX = 60;

/**
 * Keep the rendered <title> inside the ~60 characters search results show.
 *
 * Site-scoped pages interpolate a hostname they do not control, so a title that
 * fits for one project can overrun for the next. Rather than shortening the
 * wording for everyone, the brand suffix is dropped for the few titles that
 * would exceed the limit with it: the distinguishing words survive, which is
 * the half that has to.
 */
function fitTitle(title: string): Metadata['title'] {
  if (title.length + BRAND_SUFFIX.length <= TITLE_MAX) return title;
  return { absolute: title.length <= TITLE_MAX ? title : title.slice(0, TITLE_MAX - 1).trimEnd() + '\u2026' };
}

export function pageMeta(opts: {
  title: string;
  description: string;
  /** root-relative, e.g. '/ranks' */
  path: string;
}): Metadata {
  const { title, description, path } = opts;
  return {
    title: fitTitle(title),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: 'SiteChecker',
      title,
      description,
      url: path,
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}
