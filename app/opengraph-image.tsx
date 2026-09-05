import { ImageResponse } from 'next/og';

/**
 * The social preview card, generated rather than checked in as a binary.
 *
 * Needed because the layout advertises `twitter:card: summary_large_image` —
 * a card that promises a large image and then supplies none renders as a bare
 * link — and because `og:image` is one of the four tags this project's own
 * `open-graph-tags-incomplete` check requires.
 *
 * Next serves this for og:image and twitter:image on every route that does not
 * define its own.
 */
export const alt = 'SiteChecker — technical SEO audits, rank tracking and AI visibility';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#15171B',
          padding: '72px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '10px',
              background: '#2340C8',
              display: 'flex',
            }}
          />
          <div style={{ color: '#8A8E97', fontSize: '26px', letterSpacing: '0.18em' }}>
            SITECHECKER
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div
            style={{
              color: '#FBFBFA',
              fontSize: '76px',
              fontWeight: 700,
              lineHeight: 1.05,
              letterSpacing: '-0.03em',
              maxWidth: '900px',
            }}
          >
            Technical SEO audits that say what they measure
          </div>
          <div style={{ color: '#9BA1AC', fontSize: '30px', lineHeight: 1.35, maxWidth: '880px' }}>
            332 checks, content quality graded by a model, and whether AI answer
            engines can read you at all.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '40px', color: '#61656E', fontSize: '24px' }}>
          <div style={{ display: 'flex' }}>332 checks</div>
          <div style={{ display: 'flex' }}>Rank tracking</div>
          <div style={{ display: 'flex' }}>AI visibility</div>
          <div style={{ display: 'flex' }}>Uptime</div>
        </div>
      </div>
    ),
    size,
  );
}
