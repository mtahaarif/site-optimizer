/**
 * Security — 18 checks.
 * Mixed content, insecure forms, transport security and response headers.
 */
import { pageCheck, siteCheck, type PageCheck, type SiteCheck } from './types.ts';

const isHttps = (u: string) => u.startsWith('https://');

// Only count HTTP references that are actually fetched — a resource in src= or
// href=. This deliberately ignores namespace identifiers (xmlns, itemtype,
// @context, prefix), which legitimately use http:// URLs for w3.org / schema.org
// / ogp.me and are not loaded, so the check no longer fires on standards-correct
// markup (its old, admitted false positive).
const insecureRefTo = (host: RegExp) => (html: string): number =>
  [...html.matchAll(/\b(?:src|href)\s*=\s*["'](http:\/\/[^"']+)["']/gi)]
    .filter((m) => host.test(m[1]!)).length;

const pageChecks: PageCheck[] = [
  pageCheck({
    id: 'http-urls', title: 'HTTP URLs',
    category: 'security', severity: 'critical',
    why: 'Pages served over plain HTTP are marked "Not secure" by browsers, expose visitor data in transit, and rank below their HTTPS equivalents.',
    fix: 'Install a TLS certificate and redirect all HTTP traffic to HTTPS.',
    appliesTo: (p) => p.isHtml,
    test: (p) => p.finalUrl.startsWith('http://'),
  }),
  pageCheck({
    id: 'https-page-internal-links-http', title: 'HTTPS page has internal links to HTTP',
    category: 'security', severity: 'critical',
    why: 'Linking from a secure page to an insecure one on the same site downgrades the visitor and creates duplicate URL variants.',
    fix: 'Update internal links to HTTPS and add a site-wide redirect.',
    test: (p) => {
      if (!isHttps(p.finalUrl)) return false;
      const n = p.links.filter((l) => l.isInternal && l.href?.startsWith('http://')).length;
      return n ? n + ' insecure internal link(s)' : false;
    },
  }),
  pageCheck({
    id: 'https-links-http-css', title: 'HTTPS page links to HTTP CSS',
    category: 'security', severity: 'critical',
    why: 'Browsers block insecure stylesheets on secure pages as mixed content, so the page renders unstyled.',
    fix: 'Serve stylesheets over HTTPS.',
    test: (p) => {
      if (!isHttps(p.finalUrl)) return false;
      const n = p.stylesheets.filter((s) => s.url.startsWith('http://')).length;
      return n ? n + ' insecure stylesheet(s)' : false;
    },
  }),
  pageCheck({
    id: 'https-links-http-javascript', title: 'HTTPS page links to HTTP JavaScript',
    category: 'security', severity: 'critical',
    why: 'Insecure scripts on a secure page are blocked entirely, breaking any functionality that depends on them.',
    fix: 'Serve scripts over HTTPS.',
    test: (p) => {
      if (!isHttps(p.finalUrl)) return false;
      const n = p.scripts.filter((s) => s.url.startsWith('http://')).length;
      return n ? n + ' insecure script(s)' : false;
    },
  }),
  pageCheck({
    id: 'https-form-posts-to-http', title: 'HTTPS URL contains a form posting to HTTP',
    category: 'security', severity: 'critical',
    why: 'Form data submitted from a secure page to an insecure endpoint travels in plaintext. Browsers warn the user before submitting.',
    fix: 'Change the form action to HTTPS.',
    test: (p) => {
      if (!isHttps(p.finalUrl)) return false;
      const n = p.forms.filter((f) => f.postsToHttp).length;
      return n ? n + ' form(s) posting to HTTP' : false;
    },
  }),
  pageCheck({
    id: 'http-url-password-field', title: 'HTTP URL contains a password input field',
    category: 'internal', severity: 'blocker',
    why: 'Credentials entered on an unencrypted page are transmitted in plaintext and can be intercepted. Browsers display an explicit security warning.',
    fix: 'Serve every page containing a login form over HTTPS.',
    test: (p) => p.finalUrl.startsWith('http://') && p.forms.some((f) => f.hasPasswordField),
  }),
  pageCheck({
    id: 'http-link-w3-org', title: 'Page has HTTP link to www.w3.org',
    category: 'security', severity: 'notice',
    why: 'A resource is actually loaded from w3.org over insecure HTTP (in a src or href) — real mixed content. Namespace declarations like an SVG xmlns are ignored, since those are identifiers, not fetched URLs.',
    fix: 'Change the loaded resource to https://www.w3.org.',
    test: (p) => {
      const n = insecureRefTo(/www\.w3\.org/)(p.html);
      return n ? n + ' HTTP w3.org reference(s)' : false;
    },
  }),
  pageCheck({
    id: 'http-link-schema-org', title: 'Page has HTTP link to schema.org',
    category: 'security', severity: 'notice',
    why: 'Structured data vocabularies referenced over HTTP. Functionally a namespace identifier, but flagged for consistency.',
    fix: 'Use https://schema.org in itemtype and @context values.',
    test: (p) => {
      const n = insecureRefTo(/schema\.org/)(p.html);
      return n ? n + ' HTTP schema.org reference(s)' : false;
    },
  }),
  pageCheck({
    id: 'http-link-ogp-me', title: 'Page has HTTP link to ogp.me',
    category: 'security', severity: 'notice',
    why: 'Open Graph namespace referenced over HTTP.',
    fix: 'Use https://ogp.me/ns# in the prefix attribute.',
    test: (p) => {
      const n = insecureRefTo(/ogp\.me/)(p.html);
      return n ? n + ' HTTP ogp.me reference(s)' : false;
    },
  }),
  pageCheck({
    id: 'requires-captcha', title: 'Page requires CAPTCHA authentication method',
    category: 'security', severity: 'notice',
    why: 'A CAPTCHA gate can block search engine crawlers from reaching content, and adds friction for legitimate visitors.',
    fix: 'Confirm crawlers are not being challenged. Restrict CAPTCHA to form submission rather than page load.',
    test: (p) => p.hasCaptcha,
  }),
];

const siteChecks: SiteCheck[] = [
  siteCheck({
    id: 'ssl-certificate-valid', title: 'SSL certificate is valid',
    category: 'security', severity: 'blocker',
    why: 'An invalid or expired certificate triggers a full-page browser interstitial. Traffic effectively stops.',
    fix: 'Renew the certificate and verify the full chain is served.',
    test: (site) => !site.ssl.valid ? (site.ssl.error ?? 'certificate invalid') : false,
  }),
  siteCheck({
    id: 'ssl-expiry-date', title: 'SSL certificate expiry',
    category: 'security', severity: 'warning',
    why: 'A certificate close to expiry risks an outage if automated renewal fails.',
    fix: 'Verify auto-renewal is working and alerting is in place.',
    test: (site) => site.ssl.daysRemaining !== null && site.ssl.daysRemaining < 30
      ? 'expires in ' + site.ssl.daysRemaining + ' days' : false,
  }),
  siteCheck({
    id: 'redirect-to-https-header', title: 'Redirect to HTTPS is implemented in response header',
    category: 'security', severity: 'critical',
    why: 'Without a server-level HTTP to HTTPS redirect, insecure URLs remain reachable and indexable.',
    fix: 'Configure a 301 from HTTP to HTTPS at the server or edge.',
    test: (site) => !site.httpsRedirectWorks,
  }),
  siteCheck({
    id: 'xss-protection', title: 'Defence against cross-site scripting attacks is implemented',
    category: 'security', severity: 'warning',
    why: 'A Content-Security-Policy constrains which scripts may execute, which is the primary structural defence against XSS.',
    fix: 'Add a Content-Security-Policy header. In Next.js this is straightforward from middleware.',
    test: (site) => !site.security.xss,
  }),
  siteCheck({
    id: 'clickjacking-protection', title: 'Defence against click-jacking attacks is implemented',
    category: 'security', severity: 'warning',
    why: 'Without frame protection the site can be embedded invisibly on an attacker page to hijack clicks.',
    fix: 'Send X-Frame-Options: SAMEORIGIN, or a CSP frame-ancestors directive.',
    test: (site) => !site.security.frameOptions,
  }),
  siteCheck({
    id: 'mime-sniffing-protection', title: 'Defence against MIME type sniffing is implemented',
    category: 'security', severity: 'warning',
    why: 'Without nosniff, browsers may reinterpret an uploaded file as executable script.',
    fix: 'Send X-Content-Type-Options: nosniff.',
    test: (site) => !site.security.contentTypeOptions,
  }),
  siteCheck({
    id: 'server-hides-version', title: 'Web server hides its version',
    category: 'security', severity: 'notice',
    why: 'Exposing exact server and framework versions tells an attacker which published vulnerabilities to try first.',
    fix: 'Suppress the Server and X-Powered-By headers. In Next.js set poweredByHeader: false in next.config.',
    test: (site) => site.security.serverVersionExposed
      ? 'exposes: ' + site.security.serverVersionExposed : false,
  }),
  siteCheck({
    id: 'no-cookies-sent', title: 'No cookies are sent by the website',
    category: 'security', severity: 'notice',
    why: 'Cookies set before consent can breach privacy regulation, and cookies on static pages defeat CDN caching.',
    fix: 'Defer non-essential cookies until consent, and keep cacheable routes cookie-free.',
    test: (site) => site.security.setsCookies,
  }),
  siteCheck({
    id: 'site-is-safe', title: 'Site is safe',
    category: 'security', severity: 'blocker',
    why: 'Malware indicators or unexpected redirects to third-party hosts suggest compromise, which leads to browser warnings and removal from search results.',
    fix: 'Audit for injected scripts and unexpected outbound redirects.',
    test: (site) => {
      const suspicious = site.pages.filter((p) =>
        p.redirectChain.some((h) => {
          try {
            return new URL(h.location, p.url).hostname.replace(/^www\./, '')
              !== new URL(site.origin).hostname.replace(/^www\./, '');
          } catch { return false; }
        }));
      return suspicious.length > 3
        ? suspicious.length + ' pages redirect off-domain' : false;
    },
  }),
];

export const SECURITY_CHECKS = [...pageChecks, ...siteChecks];
