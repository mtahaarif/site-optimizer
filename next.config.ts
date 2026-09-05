import type { NextConfig } from 'next';

// Security headers the audit checks for (clickjacking, MIME sniffing, XSS,
// referrer leakage, HTTPS enforcement). Applied to every route.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  cacheComponents: true,

  // Playwright is an optional dependency used only by the `--render-js` crawl
  // path, which needs a real Chromium binary and therefore only ever runs
  // locally or self-hosted. Left alone, output tracing follows the dynamic
  // import in src/crawler/browser.ts and packs ~14 MB of it into the crawl
  // function, where it is dead weight against the 250 MB function ceiling.
  // The runtime already degrades cleanly when no browser resolves.
  outputFileTracingExcludes: {
    '**': ['./node_modules/playwright-core/**'],
  },

  async redirects() {
    // The flat crawl list is superseded by the project model. A config-level
    // permanent redirect keeps old links working without rendering a second
    // crawlable page that duplicates /projects.
    return [
      { source: '/crawls', destination: '/projects', permanent: true },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
