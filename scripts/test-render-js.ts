/**
 * Verification for conditional JavaScript rendering.
 *
 * Serves a genuine client-rendered SPA — an empty mount point plus a script
 * that builds the DOM — then crawls it twice: once on the raw path, once with
 * rendering on. The whole point is that the two must see different things.
 *
 *   node scripts/test-render-js.ts
 */
import { createServer } from 'node:http';
import { runAudit } from '../src/crawler/audit.ts';
import type { CheckOutcome } from '../src/core/checks/types.ts';

const PORT = 8793;
const BASE = `http://127.0.0.1:${PORT}`;

/**
 * A CRA/Vite-shaped shell: nothing in <body> but the mount point, no title,
 * no canonical. Everything appears only after the script runs.
 */
const shell = (route: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Loading…</title>
</head>
<body>
  <div id="root"></div>
  <script src="/app.js?route=${route}"></script>
</body>
</html>`;

const APP_JS = (route: string) => {
  const pages: Record<string, { title: string; h1: string; body: string; links: string[] }> = {
    home: {
      title: 'SPA Fixture — Home',
      h1: 'Client Rendered Home Page',
      body: 'This paragraph exists only after JavaScript executes. '.repeat(20),
      links: ['/about', '/pricing'],
    },
    about: {
      title: 'SPA Fixture — About',
      h1: 'About This Client Rendered App',
      body: 'About page content injected by the client bundle. '.repeat(20),
      links: ['/', '/pricing'],
    },
    pricing: {
      title: 'SPA Fixture — Pricing',
      h1: 'Pricing For The Client Rendered App',
      body: 'Pricing details rendered entirely in the browser. '.repeat(20),
      links: ['/', '/about'],
    },
  };
  const p = pages[route] ?? pages['home']!;
  return `
document.title = ${JSON.stringify(p.title)};
var c = document.createElement('link');
c.rel = 'canonical'; c.href = ${JSON.stringify(BASE + (route === 'home' ? '/' : '/' + route))};
document.head.appendChild(c);
var d = document.createElement('meta');
d.name = 'description'; d.content = 'A description injected by client-side JavaScript for testing.';
document.head.appendChild(d);
var root = document.getElementById('root');
root.innerHTML = '<h1>' + ${JSON.stringify(p.h1)} + '</h1>'
  + '<p>' + ${JSON.stringify(p.body)} + '</p>'
  + ${JSON.stringify(p.links.map((l) => `<a href="${l}">Go to ${l}</a>`).join(' '))};
`;
};

/** A page whose bundle throws before mounting: empty root + console error. */
const BROKEN_JS = `
console.error('Failed to load resource: the chunk vendor.js could not be fetched');
throw new TypeError("Cannot read properties of undefined (reading 'mount')");
`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', BASE);
  const path = url.pathname;

  if (path === '/robots.txt') { res.writeHead(404).end(); return; }

  if (path === '/app.js') {
    const route = url.searchParams.get('route') ?? 'home';
    res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
    res.end(route === 'broken' ? BROKEN_JS : APP_JS(route));
    return;
  }

  const route = path === '/' ? 'home' : path.slice(1);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(shell(route));
});

await new Promise<void>((r) => server.listen(PORT, '127.0.0.1', r));

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(54)} ${JSON.stringify(actual)}${ok ? '' : '  expected ' + JSON.stringify(expected)}`);
};
const outcome = (o: CheckOutcome[], id: string) => o.find((x) => x.id === id);

// ---------------------------------------------------------------------------
console.log('\n--- RAW PATH (renderJs: false) ---');
const rawStart = Date.now();
const raw = await runAudit({
  startUrl: BASE + '/', maxPages: 6, checkAssets: false, maxPagespeedPages: 0, renderJs: false,
});
const rawMs = Date.now() - rawStart;

const rawHome = raw.pages.find((p) => p.url.endsWith('/') || p.url === BASE);
check('render disabled', raw.render.enabled, false);
check('zero pages rendered', raw.render.renderedPages, 0);
check('SPA shells detected', raw.render.spaShellsDetected > 0, true);
check('home title is the shell placeholder', rawHome?.title, 'Loading…');
check('home has no H1', rawHome?.h1, null);
check('home word count is tiny', (rawHome?.wordCount ?? 99) < 10, true);

const spaNotice = outcome(raw.outcomes, 'spa.client-rendering-detected');
check('spa notice FIRED', spaNotice?.status, 'failed');
check('spa notice names the framework', spaNotice?.affected[0]?.detail?.includes('React'), true);
check('js checks skipped on raw path', outcome(raw.outcomes, 'js.console-errors-present')?.status, 'skipped');

// Only the entry page is reachable without JS: links live in the bundle.
check('raw crawl finds only the shell page', raw.counts.htmlPages, 1);

// ---------------------------------------------------------------------------
console.log('\n--- RENDERED PATH (renderJs: true) ---');
const renderStart = Date.now();
const rendered = await runAudit({
  startUrl: BASE + '/', maxPages: 6, checkAssets: false, maxPagespeedPages: 0,
  renderJs: true, jsWaitUntil: 'networkidle', jsTimeoutMs: 15_000,
});
const renderMs = Date.now() - renderStart;

const home = rendered.pages.find((p) => p.url === BASE + '/' || p.url === BASE);
check('render enabled', rendered.render.enabled, true);
check('pages rendered', rendered.render.renderedPages >= 3, true);
check('no render failures', rendered.render.failures.length, 0);

check('title extracted from hydrated DOM', home?.title, 'SPA Fixture — Home');
check('H1 extracted', home?.h1, 'Client Rendered Home Page');
check('description extracted', home?.description?.includes('injected by client-side'), true);
check('body content extracted', (home?.wordCount ?? 0) > 100, true);
check('page marked as rendered', home?.renderedWithJs, true);
check('server text recorded separately', (home?.serverTextLength ?? 99) < 10, true);

// The decisive one: links only exist after hydration, so a raw crawl cannot
// discover them and a rendered crawl must.
check('followed client-rendered links', rendered.counts.htmlPages >= 3, true);
const paths = rendered.pages.map((p) => new URL(p.url).pathname).sort();
check('discovered /about and /pricing', paths.includes('/about') && paths.includes('/pricing'), true);

const gap = outcome(rendered.outcomes, 'js.hydration-content-gap');
check('hydration gap check FIRED', gap?.status, 'failed');
check('gap detail quantifies it', gap?.affected[0]?.detail?.includes('% of body text'), true);

const injected = outcome(rendered.outcomes, 'js.client-injected-meta');
check('client-injected meta FIRED', injected?.status, 'failed');
check('names title and canonical', injected?.affected[0]?.detail?.includes('title'), true);

check('spa notice does NOT fire on rendered path', outcome(rendered.outcomes, 'spa.client-rendering-detected')?.status, 'skipped');

// ---------------------------------------------------------------------------
console.log('\n--- BROKEN BUNDLE (empty mount + console error) ---');
const broken = await runAudit({
  startUrl: BASE + '/broken', maxPages: 2, checkAssets: false, maxPagespeedPages: 0,
  renderJs: true, jsTimeoutMs: 15_000,
});

const emptyRoot = outcome(broken.outcomes, 'js.empty-root-fallback');
check('empty mount FIRED as blocker', emptyRoot?.status, 'failed');
check('severity is blocker', emptyRoot?.severity, 'blocker');
check('detail includes the console error', emptyRoot?.affected[0]?.detail?.includes('chunk'), true);

const consoleErr = outcome(broken.outcomes, 'js.console-errors-present');
check('console errors FIRED', consoleErr?.status, 'failed');
check('captured the uncaught TypeError',
  broken.render.consoleErrors >= 2, true);

// ---------------------------------------------------------------------------
console.log('\n--- COST ---');
console.log(`  raw path      ${(rawMs / 1000).toFixed(1)}s for ${raw.counts.htmlPages} page(s)`);
console.log(`  rendered path ${(renderMs / 1000).toFixed(1)}s for ${rendered.counts.htmlPages} page(s)`);

server.close();
console.log(failures === 0 ? '\nAll JavaScript-rendering assertions passed.\n' : `\n${failures} assertion(s) FAILED.\n`);
process.exitCode = failures === 0 ? 0 : 1;
